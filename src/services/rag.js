/**
 * RAG knowledge base — stub, to be implemented later.
 *
 * Planned design:
 *  1. Ingest: split documents (PDF/TXT/HTML) into chunks.
 *  2. Embed: vectorize chunks with a multilingual embedding model that
 *     covers Gujarati (e.g. Gemini `gemini-embedding-001`, Google
 *     `text-embedding-004`, or multilingual-e5).
 *  3. Store: keep vectors in a vector DB (Chroma, Qdrant, pgvector, LanceDB).
 *  4. Retrieve: embed the user query, fetch top-k similar chunks, and return
 *     them here — `generateReply()` already injects them into the prompt.
 *
 * @param {object} params
 * @param {string} params.query - User's transcribed message.
 * @param {number} [params.topK] - Number of chunks to return.
 * @returns {Promise<string[]>} Knowledge-base chunks (empty until implemented).
 */
export async function retrieveContext({ query, topK = 5 }) {
  void query;
  void topK;
  return [];
}
