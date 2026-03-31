// ════════════════════════════════════════════════════════════
// MCP Tool: store-observation
//
// Stores a new observation about an entity.
// - Auto-generates embedding via OpenAI text-embedding-3-small
// - Auto-links to entity via fuzzy name matching (pg_trgm)
// - Sets visibility_scope based on observation type
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { generateEmbedding } from '../../utils/embeddings.js';

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

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
  name: 'store_observation',
  description:
    'Store a new observation about a client, supplier, suburb, or other entity. ' +
    'Auto-generates embedding and links to entity via fuzzy name matching.',
  input_schema: {
    type: 'object' as const,
    required: ['entity_name', 'entity_type', 'observation_type', 'content'],
    properties: {
      entity_name: {
        type: 'string',
        description: 'Name of the entity (client, supplier, suburb, etc.)',
      },
      entity_type: {
        type: 'string',
        enum: ['client', 'supplier', 'installer', 'suburb', 'product', 'material', 'staff_member'],
        description: 'Type of entity',
      },
      observation_type: {
        type: 'string',
        enum: ['preference', 'behaviour', 'feedback', 'fact', 'interaction', 'issue', 'compliment', 'pattern'],
        description: 'Type of observation',
      },
      content: {
        type: 'string',
        description: 'The observation text',
      },
      source_channel: {
        type: 'string',
        enum: ['telegram', 'web', 'api', 'system', 'manual'],
        description: 'Where this observation came from',
      },
      source_job_id: {
        type: 'string',
        description: 'Related job UUID if applicable',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Confidence score (0-1), defaults to 0.80',
      },
    },
  },
};

export interface StoreParams {
  entity_name: string;
  entity_type: string;
  observation_type: string;
  content: string;
  source_channel?: string;
  source_job_id?: string;
  confidence?: number;
}

export interface StoreOutput {
  observation_id: string;
  entity_id: string;
  entity_name: string;
  entity_matched: 'exact' | 'fuzzy' | 'created';
  visibility_scope: string;
  embedding_generated: boolean;
}

/**
 * Execute the store-observation tool.
 */
export async function execute(params: StoreParams): Promise<StoreOutput> {
  const sb = getSupabase();

  // ── Step 1: Resolve entity via fuzzy matching ──
  const { entityId, matchType, resolvedName } = await resolveEntity(
    sb,
    params.entity_type,
    params.entity_name,
  );

  // ── Step 2: Determine visibility scope ──
  const visibilityScope = getVisibilityScope(params.observation_type);

  // ── Step 3: Generate embedding ──
  let embedding: number[] | null = null;
  let embeddingGenerated = false;
  try {
    embedding = await generateEmbedding(params.content);
    embeddingGenerated = true;
  } catch (err) {
    console.warn('Embedding generation failed, storing without vector:', err);
  }

  // ── Step 4: Store observation ──
  const row: Record<string, unknown> = {
    org_id: DEFAULT_ORG_ID,
    entity_id: entityId,
    observation_type: params.observation_type,
    content: params.content,
    source_channel: params.source_channel || 'system',
    source_job_id: params.source_job_id || null,
    confidence: params.confidence ?? 0.80,
    visibility_scope: visibilityScope,
    visible_to_roles: visibilityScope === 'role_restricted' ? ['admin', 'estimator'] : [],
  };

  if (embedding) {
    row.embedding = `[${embedding.join(',')}]`;
  }

  const { data, error } = await sb
    .from('entity_observations')
    .insert(row)
    .select('id')
    .single();

  if (error) throw error;

  return {
    observation_id: data.id,
    entity_id: entityId,
    entity_name: resolvedName,
    entity_matched: matchType,
    visibility_scope: visibilityScope,
    embedding_generated: embeddingGenerated,
  };
}

// ════════════════════════════════════════════════════════════
// ENTITY RESOLUTION
// ════════════════════════════════════════════════════════════

async function resolveEntity(
  sb: SupabaseClient,
  entityType: string,
  entityName: string,
): Promise<{ entityId: string; matchType: 'exact' | 'fuzzy' | 'created'; resolvedName: string }> {
  // Try exact match first
  const { data: exact } = await sb
    .from('entity_profiles')
    .select('id, name')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('entity_type', entityType)
    .ilike('name', entityName)
    .limit(1)
    .single();

  if (exact) {
    return { entityId: exact.id, matchType: 'exact', resolvedName: exact.name };
  }

  // Try fuzzy match via pg_trgm
  const { data: fuzzy } = await sb.rpc('search_entities', {
    p_org_id: DEFAULT_ORG_ID,
    p_query: entityName,
    p_entity_type: entityType,
    p_limit: 1,
  });

  if (fuzzy && fuzzy.length > 0 && fuzzy[0].similarity_score > 0.4) {
    return { entityId: fuzzy[0].id, matchType: 'fuzzy', resolvedName: fuzzy[0].name };
  }

  // Create new entity
  const { data: created, error } = await sb
    .from('entity_profiles')
    .insert({
      org_id: DEFAULT_ORG_ID,
      entity_type: entityType,
      name: entityName,
    })
    .select('id, name')
    .single();

  if (error) throw error;
  return { entityId: created.id, matchType: 'created', resolvedName: created.name };
}

// ════════════════════════════════════════════════════════════
// VISIBILITY SCOPE MAPPING
// ════════════════════════════════════════════════════════════

/**
 * Determine visibility_scope based on observation type.
 * - 'issue', 'feedback' → role_restricted (internal staff only)
 * - 'preference', 'fact', 'compliment' → public
 * - 'behaviour', 'pattern' → private (admin only)
 */
function getVisibilityScope(observationType: string): 'public' | 'role_restricted' | 'private' {
  switch (observationType) {
    case 'issue':
    case 'feedback':
    case 'interaction':
      return 'role_restricted';
    case 'behaviour':
    case 'pattern':
      return 'private';
    case 'preference':
    case 'fact':
    case 'compliment':
    default:
      return 'public';
  }
}
