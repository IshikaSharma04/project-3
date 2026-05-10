import "dotenv/config";
import express from "express";
import multer from "multer";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { OpenAI } from "openai";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });

// In-memory session tracking for Qdrant collection names
const sessions = {};

app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const filePath = req.file.path;
        const sessionId = uuidv4();
        const collectionName = `notebooklm-${sessionId}`;

        // 1. Ingestion
        const loader = new PDFLoader(filePath);
        const docs = await loader.load();

        // 2. Chunking
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
        });
        const chunkedDocs = await textSplitter.splitDocuments(docs);

        // Add metadata to chunks
        chunkedDocs.forEach((doc, idx) => {
            doc.metadata = {
                ...doc.metadata,
                chunkIndex: idx,
                source: req.file.originalname,
            };
        });

        // 3. Embedding & Storage
        const embeddings = new OpenAIEmbeddings({
            model: "text-embedding-3-small", // Using small for cost efficiency
        });

        await QdrantVectorStore.fromDocuments(chunkedDocs, embeddings, {
            url: process.env.QDRANT_URL || "http://localhost:6333",
            apiKey: process.env.QDRANT_API_KEY,
            collectionName: collectionName,
        });

        sessions[sessionId] = collectionName;
        
        // Cleanup temp file
        fs.unlinkSync(filePath);

        res.json({
            sessionId,
            message: "Document indexed successfully",
            totalChunks: chunkedDocs.length,
        });

    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: error.message });
    }
});

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

        // 4. Retrieval
        const embeddings = new OpenAIEmbeddings({
            model: "text-embedding-3-small",
        });

        const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
            url: process.env.QDRANT_URL || "http://localhost:6333",
            apiKey: process.env.QDRANT_API_KEY,
            collectionName: collectionName,
        });

        const retriever = vectorStore.asRetriever({ k: 4 });
        const searchedChunks = await retriever.invoke(query);

        // 5. Generation
        const client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        const system_prompt = `You are NotebookLM, an AI Assistant that helps answer the user query based ONLY on the provided context from the uploaded PDF document.

Rules:
- Only answer based on the available context from the file.
- If the answer is not in the context, explicitly say: "I couldn't find that in the uploaded document."
- Cite your sources by referencing the chunk index or content if applicable.
- Do not use external knowledge to answer the question.

Context:
${JSON.stringify(searchedChunks.map(doc => ({ text: doc.pageContent, metadata: doc.metadata })))}
`;

        const response = await client.chat.completions.create({
            model: "gpt-4o-mini", // Cost efficient model
            messages: [
                { role: "system", content: system_prompt },
                { role: "user", content: query }
            ],
            temperature: 0.2,
        });

        res.json({
            answer: response.choices[0].message.content,
            sources: searchedChunks.map(doc => ({
                text: doc.pageContent,
                metadata: doc.metadata
            }))
        });

    } catch (error) {
        console.error("Chat error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(\`NotebookLM RAG app listening on port \${port}\`);
});
