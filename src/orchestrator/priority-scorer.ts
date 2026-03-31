// ════════════════════════════════════════════════════════════
// Priority Scorer — Weighted multi-factor scoring
//
// Priority = urgency(0.3) * time_sensitivity
//          + impact(0.25) * financial_value
//          + relationship(0.2) * entity_importance
//          + decay(0.15) * time_since_last_attention
//          + commitment(0.1) * creates_obligation
//
// Returns 0-100 (0 = highest priority).
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

const WEIGHTS = {
  urgency: 0.30,
  impact: 0.25,
  relationship: 0.20,
  decay: 0.15,
  commitment: 0.10,
};

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

export interface PriorityContext {
  event_type?: string;
  job_id?: string;
  entity_id?: string;
  has_commitment?: boolean;
  custom_urgency?: number;
}

/**
 * Calculate priority score (0=highest, 100=lowest).
 */
export async function calculatePriority(context: PriorityContext): Promise<number> {
  const [urgency, impact, relationship, decay, commitment] = await Promise.all([
    context.custom_urgency !== undefined
      ? Promise.resolve(context.custom_urgency)
      : Promise.resolve(getTimeSensitivity(context.event_type)),
    getFinancialValue(context.job_id),
    getEntityImportance(context.entity_id),
    getDecayScore(context.entity_id),
    Promise.resolve(context.has_commitment ? 1.0 : 0.1),
  ]);

  // Weighted sum produces 0-1 (higher = more important)
  const rawScore =
    WEIGHTS.urgency * urgency +
    WEIGHTS.impact * impact +
    WEIGHTS.relationship * relationship +
    WEIGHTS.decay * decay +
    WEIGHTS.commitment * commitment;

  // Invert to 0-100 scale where 0 = highest priority
  return Math.round((1 - rawScore) * 100);
}

/**
 * Time sensitivity by event type (0-1, higher = more urgent).
 */
export function getTimeSensitivity(eventType?: string): number {
  switch (eventType) {
    case 'invoice_overdue':
    case 'complaint':
    case 'escalate_complaint':
      return 1.0;
    case 'quote_expired':
    case 'send_stage3_chase':
    case 'send_stage4_chase':
      return 0.8;
    case 'email_inbound':
    case 'webhook_ghl':
    case 'send_stage1_chase':
    case 'send_quote':
      return 0.6;
    case 'schedule_trigger':
    case 'thread_due':
      return 0.3;
    case 'status_change':
      return 0.4;
    default:
      return 0.1;
  }
}

/**
 * Financial value normalised to 0-1 based on Perth patio/fencing range.
 * $0-5K:0.2, $5-15K:0.4, $15-30K:0.6, $30-50K:0.8, $50K+:1.0
 */
export async function getFinancialValue(jobId?: string): Promise<number> {
  if (!jobId) return 0.2; // unknown = low

  const sb = getSupabase();
  const { data } = await sb
    .from('jobs')
    .select('pricing_json')
    .eq('id', jobId)
    .single();

  if (!data?.pricing_json) return 0.2;

  const total = parseFloat(data.pricing_json.totalIncGST || data.pricing_json.total || '0');

  if (total >= 50_000) return 1.0;
  if (total >= 30_000) return 0.8;
  if (total >= 15_000) return 0.6;
  if (total >= 5_000) return 0.4;
  return 0.2;
}

/**
 * Entity importance: repeat client > active > lead > unknown.
 */
export async function getEntityImportance(entityId?: string): Promise<number> {
  if (!entityId) return 0.1;

  const sb = getSupabase();
  const { data } = await sb
    .from('entity_profiles')
    .select('facts, observation_count, linked_job_ids')
    .eq('id', entityId)
    .single();

  if (!data) return 0.1;

  // Repeat client: multiple jobs
  const jobCount = data.linked_job_ids?.length || 0;
  if (jobCount >= 2) return 0.8;

  // Active client: has observations
  if (data.observation_count >= 5) return 0.6;

  // Lead: some interaction
  if (data.observation_count >= 1) return 0.3;

  return 0.1;
}

/**
 * Decay score: how long since last attention to this entity.
 * >14 days: 1.0, 7-14: 0.7, 3-7: 0.4, <3: 0.1
 */
export async function getDecayScore(entityId?: string): Promise<number> {
  if (!entityId) return 0.5;

  const sb = getSupabase();
  const { data } = await sb
    .from('entity_profiles')
    .select('last_observed_at')
    .eq('id', entityId)
    .single();

  if (!data?.last_observed_at) return 1.0; // Never observed = high decay

  const daysSince = (Date.now() - new Date(data.last_observed_at).getTime()) / (1000 * 60 * 60 * 24);

  if (daysSince > 14) return 1.0;
  if (daysSince > 7) return 0.7;
  if (daysSince > 3) return 0.4;
  return 0.1;
}
