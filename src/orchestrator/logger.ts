// ════════════════════════════════════════════════════════════
// Intention Logger — Append-only logging with hash chain
//
// Every intention is logged with a SHA-256 hash of its content,
// chained to the previous hash for tamper detection.
// ════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

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

export interface IntentionRecord {
  org_id?: string;
  user_id?: string | null;
  channel: string;
  raw_input: string;
  detected_intent: string;
  confidence: number;
  parsed_params?: Record<string, unknown>;
  entity_type?: string | null;
  entity_id?: string | null;
  authority_check?: Record<string, unknown>;
  authorised: boolean;
  status: string;
  result_summary?: string | null;
  error_detail?: string | null;
  duration_ms?: number;
}

/**
 * Compute SHA-256 hash of intention content.
 */
function computeHash(record: IntentionRecord): string {
  const payload = JSON.stringify({
    channel: record.channel,
    raw_input: record.raw_input,
    detected_intent: record.detected_intent,
    confidence: record.confidence,
    authorised: record.authorised,
    status: record.status,
    timestamp: new Date().toISOString(),
  });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Fetch the hash of the most recent intention for chain linking.
 */
async function getPreviousHash(sb: SupabaseClient, orgId: string): Promise<string | null> {
  const { data } = await sb
    .from('intention_log')
    .select('hash')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return data?.hash ?? null;
}

/**
 * Log an intention to the intention_log table with hash chain.
 */
export async function logIntention(
  record: IntentionRecord,
  result?: { summary?: string; error?: string },
): Promise<string> {
  const sb = getSupabase();
  const orgId = record.org_id || DEFAULT_ORG_ID;

  const hash = computeHash(record);
  const previousHash = await getPreviousHash(sb, orgId);

  const row = {
    org_id: orgId,
    user_id: record.user_id || null,
    channel: record.channel,
    raw_input: record.raw_input,
    detected_intent: record.detected_intent,
    confidence: record.confidence,
    parsed_params: record.parsed_params || {},
    entity_type: record.entity_type || null,
    entity_id: record.entity_id || null,
    authority_check: record.authority_check || {},
    authorised: record.authorised,
    status: record.status,
    result_summary: result?.summary || record.result_summary || null,
    error_detail: result?.error || record.error_detail || null,
    duration_ms: record.duration_ms || null,
    hash,
    previous_hash: previousHash,
    started_at: new Date().toISOString(),
  };

  const { data, error } = await sb
    .from('intention_log')
    .insert(row)
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/**
 * Update an existing intention log record (e.g. when completed).
 */
export async function updateIntention(
  intentionId: string,
  updates: {
    status?: string;
    result_summary?: string;
    error_detail?: string;
    completed_at?: string;
    duration_ms?: number;
    confirmation_token?: string;
    confirmed_at?: string;
  },
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from('intention_log')
    .update(updates)
    .eq('id', intentionId);

  if (error) throw error;
}
