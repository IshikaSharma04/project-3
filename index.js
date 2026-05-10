import "dotenv/config";
import express from "express";
import multer from "multer";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { QdrantClient } from "@qdrant/js-client-rest";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ dest: "uploads/" });

// In-memory session tracking
const sessions = {};

// ── HuggingFace Embedding (API) ──────────────────────────────────────────────
// Uses sentence-transformers/all-MiniLM-L6-v2 → 384-dim vectors
const HF_API_URL =
  "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction";

async function embedText(text) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.HF_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.HF_TOKEN}`;
  }

  const res = await fetch(HF_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ inputs: text }),
  });

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    throw new Error(
      "HuggingFace model unavailable. Check HF_TOKEN in your .env for reliable access."
    );
  }

  const data = await res.json();

  if (data.estimated_time) {
    const wait = Math.ceil(data.estimated_time * 1000) + 3000;
    await new Promise((r) => setTimeout(r, wait));
    return embedText(text);
  }

  if (!res.ok) throw new Error(`HuggingFace embed error: ${JSON.stringify(data)}`);

  return Array.isArray(data[0]) ? data[0] : data;
}

async function embedBatch(texts) {
  const results = [];
  for (const text of texts) {
    results.push(await embedText(text));
    await new Promise((r) => setTimeout(r, 120)); // small delay to avoid rate limit
  }
  return results;
}

// ── Qdrant Client ─────────────────────────────────────────────────────────────
function getQdrant() {
  return new QdrantClient({
    url: process.env.QDRANT_URL || "http://localhost:6333",
    apiKey: process.env.QDRANT_API_KEY || undefined,
  });
}

async function ensureCollection(client, name) {
  try {
    await client.getCollection(name);
  } catch {
    await client.createCollection(name, {
      vectors: { size: 384, distance: "Cosine" },
    });
  }
}

// ── OpenRouter fallback models (all free tier) ────────────────────────────────
const OPENROUTER_MODELS = [
  "openrouter/free",
];

// ── Generation: Gemini first → OpenRouter fallback ───────────────────────────
async function generateAnswer(query, chunks) {
  const contextBlock = chunks
    .map((c, i) => `[Chunk ${i + 1}]\n${c.text}`)
    .join("\n\n---\n\n");

  const systemPrompt = `You are NotebookLM, an AI assistant that answers questions ONLY from the document context provided below.

STRICT RULES:
1. Answer ONLY using the context below — never use outside knowledge.
2. If the answer is not in the context, say: "I couldn't find that in the uploaded document."
3. Cite chunk numbers like [Chunk 2] when referencing content.
4. Be concise and accurate.

=== DOCUMENT CONTEXT ===
${contextBlock}
========================`;

  // ── Try Gemini first (free tier) ────────────────────────────────────────────
  if (process.env.GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(`${systemPrompt}\n\nUser Question: ${query}`);
      console.log("✅ Answered via Gemini");
      return result.response.text();
    } catch (err) {
      console.warn("⚠️  Gemini failed, trying OpenRouter:", err.message);
    }
  }

  // ── Fallback: OpenRouter free models ────────────────────────────────────────
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("No LLM available. Set GEMINI_API_KEY or OPENROUTER_API_KEY in your .env");
  }

  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": process.env.SITE_URL || "http://localhost:3000",
      "X-Title": "NotebookLM RAG",
    },
  });

  let lastError;
  for (const model of OPENROUTER_MODELS) {
    try {
      const response = await client.chat.completions.create({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: query },
        ],
      });
      console.log(`✅ Answered via OpenRouter (${model})`);
      return response.choices[0].message.content;
    } catch (err) {
      console.warn(`⚠️ OpenRouter model ${model} failed:`, err.message);
      lastError = err;
      continue;
    }
  }

  throw lastError || new Error("All LLM providers failed. Please try again.");
}

// ── Upload Route ──────────────────────────────────────────────────────────────
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const sessionId = uuidv4();
    const collectionName = `notebooklm-${sessionId}`;

    // 1. Ingestion — parse PDF
    const loader = new PDFLoader(filePath);
    const docs = await loader.load();

    // 2. Chunking — RecursiveCharacterTextSplitter
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const chunks = await splitter.splitDocuments(docs);

    const chunkTexts = chunks.map((c, i) => ({
      text: c.pageContent,
      chunkIndex: i,
      source: req.file.originalname,
    }));

    // 3. Embedding — HuggingFace (free)
    const vectors = await embedBatch(chunkTexts.map((c) => c.text));

    // 4. Storage — Qdrant
    const client = getQdrant();
    await ensureCollection(client, collectionName);

    const points = chunkTexts.map((chunk, idx) => ({
      id: idx,
      vector: vectors[idx],
      payload: {
        text: chunk.text,
        source: chunk.source,
        chunkIndex: chunk.chunkIndex,
      },
    }));

    await client.upsert(collectionName, { points, wait: true });

    sessions[sessionId] = collectionName;

    // Cleanup temp file
    fs.unlinkSync(filePath);

    res.json({
      sessionId,
      message: "Document indexed successfully",
      totalChunks: chunkTexts.length,
    });

  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ── Chat Route ────────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  try {
    const { query, sessionId } = req.body;

    if (!query || !sessionId) {
      return res.status(400).json({ error: "Missing query or sessionId" });
    }

    const collectionName = sessions[sessionId];
    if (!collectionName) {
      return res.status(400).json({ error: "Invalid or expired session" });
    }

    // 5. Retrieval — embed query and search Qdrant
    const queryVector = await embedText(query);
    const client = getQdrant();

    const hits = await client.search(collectionName, {
      vector: queryVector,
      limit: 4,
      with_payload: true,
    });

    const retrievedChunks = hits.map((hit) => ({
      text: hit.payload.text,
      source: hit.payload.source,
      chunkIndex: hit.payload.chunkIndex,
      score: parseFloat((hit.score * 100).toFixed(1)),
    }));

    // 6. Generation — Gemini (free)
    const answer = await generateAnswer(query, retrievedChunks);

    res.json({
      answer,
      sources: retrievedChunks,
    });

  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`NotebookLM RAG app listening on http://localhost:${port}`);
});
