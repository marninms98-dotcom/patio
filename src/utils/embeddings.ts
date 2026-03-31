// ════════════════════════════════════════════════════════════
// Embeddings — OpenAI text-embedding-3-small wrapper
//
// Generates 1536-dimension embeddings for vector search.
// ════════════════════════════════════════════════════════════

import OpenAI from 'openai';

const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY must be set');
    }
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

/**
 * Generate an embedding for a single text string.
 * Returns a 1536-dimension float array.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getClient();
  const response = await client.embeddings.create({
    model: MODEL,
    input: text.trim(),
    dimensions: DIMENSIONS,
  });
  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in a single API call.
 * Returns an array of 1536-dimension float arrays, in the same order as input.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = getClient();
  const response = await client.embeddings.create({
    model: MODEL,
    input: texts.map((t) => t.trim()),
    dimensions: DIMENSIONS,
  });

  // Sort by index to guarantee order matches input
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}
