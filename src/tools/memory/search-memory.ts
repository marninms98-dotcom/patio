// ════════════════════════════════════════════════════════════
// MCP Tool: search-memory
//
// Hybrid search: pgvector cosine similarity + tsvector keyword
// search, fused via Reciprocal Rank Fusion (RRF).
//
// Always runs corrections_check against active corrections.
// Pre-filters by entity_id, date range, observation_type.
// Returns top 5 results per query type.
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { generateEmbedding } from '../../utils/embeddings.js';

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const RRF_K = 60; // RRF constant
const TOP_N = 5;

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    _sb = createClient(url, key);
  }
  return _sb;
}

// ── Tool Definition (MCP format) ──
export const definition = {
  name: 'search_memory',
  description:
    'Search JARVIS memory for observations about entities, clients, jobs, suburbs. ' +
    'Uses hybrid vector + keyword search with correction checking.',
  input_schema: {
    type: 'object' as const,
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query',
      },
      entity_id: {
        type: 'string',
        description: 'Filter to a specific entity UUID',
      },
      observation_type: {
        type: 'string',
        enum: ['preference', 'behaviour', 'feedback', 'fact', 'interaction', 'issue', 'compliment', 'pattern'],
        description: 'Filter by observation type',
      },
      date_from: {
        type: 'string',
        description: 'ISO date string — only observations after this date',
      },
      date_to: {
        type: 'string',
        description: 'ISO date string — only observations before this date',
      },
    },
  },
};

export interface SearchParams {
  query: string;
  entity_id?: string;
  observation_type?: string;
  date_from?: string;
  date_to?: string;
}

interface SearchResult {
  id: string;
  entity_id: string;
  entity_name: string;
  entity_type: string;
  observation_type: string;
  content: string;
  confidence: number;
  observed_at: string;
  score: number;
  source: 'vector' | 'keyword' | 'fused';
}

interface CorrectionNote {
  correction_type: string;
  original_value: string;
  corrected_value: string;
  explanation: string;
}

export interface SearchOutput {
  results: SearchResult[];
  corrections: CorrectionNote[];
  query: string;
  result_count: number;
}

/**
 * Execute the search-memory tool.
 */
export async function execute(params: SearchParams): Promise<SearchOutput> {
  const sb = getSupabase();

  // Run vector search, keyword search, and corrections check in parallel
  const [vectorResults, keywordResults, corrections] = await Promise.all([
    vectorSearch(sb, params),
    keywordSearch(sb, params),
    correctionsCheck(sb, params.query),
  ]);

  // Fuse results via Reciprocal Rank Fusion
  const fused = reciprocalRankFusion(vectorResults, keywordResults);

  return {
    results: fused.slice(0, TOP_N),
    corrections,
    query: params.query,
    result_count: fused.length,
  };
}

// ════════════════════════════════════════════════════════════
// VECTOR SEARCH (pgvector cosine similarity)
// ════════════════════════════════════════════════════════════

async function vectorSearch(
  sb: SupabaseClient,
  params: SearchParams,
): Promise<SearchResult[]> {
  // Generate embedding for the query
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(params.query);
  } catch {
    // If embedding fails, skip vector search gracefully
    return [];
  }

  // Build the vector similarity query via RPC
  // We need a raw SQL function for this since Supabase JS doesn't support
  // pgvector operators natively. Use the match_observations RPC if available,
  // otherwise fall back to raw query.
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  let query = sb.rpc('match_observations', {
    query_embedding: embeddingStr,
    match_threshold: 0.3,
    match_count: TOP_N * 2,
    p_org_id: DEFAULT_ORG_ID,
    p_entity_id: params.entity_id || null,
    p_observation_type: params.observation_type || null,
    p_date_from: params.date_from || null,
    p_date_to: params.date_to || null,
  });

  const { data, error } = await query;

  if (error) {
    // RPC may not exist yet — return empty gracefully
    console.warn('Vector search RPC error (may not be deployed yet):', error.message);
    return [];
  }

  return (data || []).map((row: any, index: number) => ({
    id: row.id,
    entity_id: row.entity_id,
    entity_name: row.entity_name || '',
    entity_type: row.entity_type || '',
    observation_type: row.observation_type,
    content: row.content,
    confidence: row.confidence,
    observed_at: row.observed_at,
    score: 1 - (row.distance || 0), // cosine distance → similarity
    source: 'vector' as const,
  }));
}

// ════════════════════════════════════════════════════════════
// KEYWORD SEARCH (tsvector + pg_trgm)
// ════════════════════════════════════════════════════════════

async function keywordSearch(
  sb: SupabaseClient,
  params: SearchParams,
): Promise<SearchResult[]> {
  // Use textSearch on content column
  let query = sb
    .from('entity_observations')
    .select(`
      id,
      entity_id,
      observation_type,
      content,
      confidence,
      observed_at,
      entity_profiles!inner(name, entity_type)
    `)
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('is_active', true)
    .textSearch('content', params.query, { type: 'websearch' })
    .order('observed_at', { ascending: false })
    .limit(TOP_N * 2);

  if (params.entity_id) {
    query = query.eq('entity_id', params.entity_id);
  }
  if (params.observation_type) {
    query = query.eq('observation_type', params.observation_type);
  }
  if (params.date_from) {
    query = query.gte('observed_at', params.date_from);
  }
  if (params.date_to) {
    query = query.lte('observed_at', params.date_to);
  }

  const { data, error } = await query;

  if (error) {
    console.warn('Keyword search error:', error.message);
    return [];
  }

  return (data || []).map((row: any, index: number) => ({
    id: row.id,
    entity_id: row.entity_id,
    entity_name: row.entity_profiles?.name || '',
    entity_type: row.entity_profiles?.entity_type || '',
    observation_type: row.observation_type,
    content: row.content,
    confidence: row.confidence,
    observed_at: row.observed_at,
    score: 1.0 / (index + 1), // positional score
    source: 'keyword' as const,
  }));
}

// ════════════════════════════════════════════════════════════
// RECIPROCAL RANK FUSION
// ════════════════════════════════════════════════════════════

function reciprocalRankFusion(
  vectorResults: SearchResult[],
  keywordResults: SearchResult[],
): SearchResult[] {
  const scores = new Map<string, { score: number; result: SearchResult }>();

  // Score vector results
  vectorResults.forEach((r, rank) => {
    const rrfScore = 1 / (RRF_K + rank + 1);
    const existing = scores.get(r.id);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(r.id, { score: rrfScore, result: { ...r, source: 'fused' } });
    }
  });

  // Score keyword results
  keywordResults.forEach((r, rank) => {
    const rrfScore = 1 / (RRF_K + rank + 1);
    const existing = scores.get(r.id);
    if (existing) {
      existing.score += rrfScore;
      existing.result.source = 'fused'; // appeared in both
    } else {
      scores.set(r.id, { score: rrfScore, result: { ...r } });
    }
  });

  // Sort by fused score descending
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({ ...entry.result, score: entry.score }));
}

// ════════════════════════════════════════════════════════════
// CORRECTIONS CHECK
// ════════════════════════════════════════════════════════════

async function correctionsCheck(
  sb: SupabaseClient,
  query: string,
): Promise<CorrectionNote[]> {
  // Find active corrections that might apply to the current query context
  const { data, error } = await sb
    .from('corrections')
    .select('correction_type, original_value, corrected_value, explanation')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('applied', false)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data) return [];

  // Filter corrections relevant to the query (simple keyword overlap)
  const queryWords = query.toLowerCase().split(/\s+/);
  return data.filter((c: any) => {
    const corrWords = [
      c.original_value || '',
      c.corrected_value || '',
      c.explanation || '',
    ]
      .join(' ')
      .toLowerCase();
    return queryWords.some((w) => w.length > 2 && corrWords.includes(w));
  });
}
