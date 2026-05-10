# Assignment 03 — Google NotebookLM RAG Clone

A full Retrieval-Augmented Generation (RAG) pipeline allowing users to upload a PDF document and have grounded conversations with it. Built with Node.js, Express, LangChain, OpenAI, and Qdrant.

## Architecture

This application consists of a backend Express server and a vanilla JavaScript frontend.

### The Pipeline End to End
1. **Ingestion**: Uploaded PDFs are parsed using LangChain's `PDFLoader`.
2. **Chunking**: See [Chunking Strategy](#chunking-strategy).
3. **Embedding**: Text chunks are embedded using OpenAI's `text-embedding-3-small`.
4. **Storage**: Vectors and metadata are stored in **Qdrant Vector Database**.
5. **Retrieval**: When the user queries, the top 4 most relevant chunks are retrieved via Cosine Similarity.
6. **Generation**: The context is injected into an OpenAI `gpt-4o-mini` prompt enforcing grounded answers.

## Chunking Strategy

This project uses the **RecursiveCharacterTextSplitter** from LangChain.

- **Strategy**: Recursive Character Splitting
- **Chunk Size**: 1000 characters
- **Chunk Overlap**: 200 characters

### Why this strategy?
Recursive character splitting is ideal for documents like PDFs. It attempts to split text at natural semantic boundaries (paragraphs, then sentences, then words). By retaining an overlap of 200 characters, we ensure that context isn't lost between chunks (e.g., if a sentence or idea spans across the boundary of two chunks).

## Setup & Running Locally

### Prerequisites
- Node.js (v18+)
- An OpenAI API Key
- A Qdrant URL and API Key (can use Qdrant Cloud free tier)

### Installation

1. Clone the repository and install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

2. Create a \`.env\` file in the root directory:
   \`\`\`env
   OPENAI_API_KEY=your_openai_key
   QDRANT_URL=your_qdrant_url
   QDRANT_API_KEY=your_qdrant_api_key
   PORT=3000
   \`\`\`

3. Start the server:
   \`\`\`bash
   npm start
   \`\`\`

4. Open your browser and navigate to \`http://localhost:3000\`

## Features Built
✅ Clean, modern UI with drag-and-drop support
✅ Live indexing progress
✅ LangChain + Qdrant Integration
✅ Source Citations on bot answers
✅ No Hallucination System Prompt (strictly grounded)
