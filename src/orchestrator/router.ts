// ════════════════════════════════════════════════════════════
// Intention Router — Routes by authority level
//
// L1: Auto-execute + silent (read-only, reports)
// L2: Execute + notify owner via Telegram
// L3: Create action card (pending_approval) — owner must confirm
// L4: Escalate + notify — blocked, requires manual intervention
// ════════════════════════════════════════════════════════════

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

export type AuthorityLevel = 1 | 2 | 3 | 4;

export interface Intention {
  id?: string;
  channel: string;
  raw_input: string;
  detected_intent: string;
  confidence: number;
  parsed_params: Record<string, unknown>;
  entity_type?: string | null;
  entity_id?: string | null;
  user_id?: string | null;
  chain_step?: number;
}

export interface IntentionResult {
  status: 'executed' | 'notified' | 'pending_approval' | 'escalated' | 'denied' | 'blocked';
  intention_id?: string;
  authority_level: AuthorityLevel;
  message: string;
  confirmation_token?: string;
  data?: unknown;
}

/**
 * Route an intention based on its authority level.
 */
export async function routeIntention(
  intention: Intention,
  authorityLevel: AuthorityLevel,
): Promise<IntentionResult> {
  switch (authorityLevel) {
    case 1:
      return routeL1(intention);
    case 2:
      return routeL2(intention);
    case 3:
      return routeL3(intention);
    case 4:
      return routeL4(intention);
    default:
      return {
        status: 'denied',
        authority_level: 4,
        message: `Unknown authority level: ${authorityLevel}`,
      };
  }
}

/**
 * L1: Auto-execute, silent. No notification needed.
 * Used for: read_job, view_pipeline, run_report
 */
async function routeL1(intention: Intention): Promise<IntentionResult> {
  return {
    status: 'executed',
    intention_id: intention.id,
    authority_level: 1,
    message: `Auto-executed: ${intention.detected_intent}`,
  };
}

/**
 * L2: Execute + notify owner via Telegram.
 * Used for: update_job, manage_schedule
 */
async function routeL2(intention: Intention): Promise<IntentionResult> {
  // Action proceeds, but owner gets a Telegram notification
  return {
    status: 'notified',
    intention_id: intention.id,
    authority_level: 2,
    message: `Executed with notification: ${intention.detected_intent}`,
  };
}

/**
 * L3: Create action card — pending approval.
 * Used for: send_quote, create_job, commitment_detected
 * Owner must confirm via Telegram inline button or web UI.
 */
async function routeL3(intention: Intention): Promise<IntentionResult> {
  const sb = getSupabase();

  const token = generateToken();

  const { error } = await sb.from('pending_confirmations').insert({
    org_id: DEFAULT_ORG_ID,
    intention_id: intention.id,
    user_id: intention.user_id || null,
    channel: intention.channel,
    action: intention.detected_intent,
    description: `Confirm: ${intention.detected_intent} — ${JSON.stringify(intention.parsed_params)}`,
    params: intention.parsed_params,
    token,
  });

  if (error) throw error;

  return {
    status: 'pending_approval',
    intention_id: intention.id,
    authority_level: 3,
    message: `Awaiting confirmation: ${intention.detected_intent}`,
    confirmation_token: token,
  };
}

/**
 * L4: Escalate — blocked entirely.
 * Used for: delete_job, unknown high-risk actions
 */
async function routeL4(intention: Intention): Promise<IntentionResult> {
  return {
    status: 'escalated',
    intention_id: intention.id,
    authority_level: 4,
    message: `Escalated for manual review: ${intention.detected_intent}`,
  };
}

function generateToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 24; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}
