// ════════════════════════════════════════════════════════════
// Trust Graduation — Automatic authority level promotion
//
// Tracks consecutive approvals per action. After N approvals
// without edits, proposes graduating the action to a lower
// authority level (more autonomous).
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getRedis } from '../utils/redis.js';

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const GRADUATION_THRESHOLD = 10; // consecutive approvals needed

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

/**
 * Record an approval for an action.
 * If edited: reset consecutive count.
 * If not: increment, check if graduation threshold met.
 */
export async function recordApproval(action: string, wasEdited: boolean): Promise<void> {
  const redis = getRedis();
  const key = `trust:approvals:${action}`;

  if (wasEdited) {
    await redis.set(key, 0);
    return;
  }

  const count = await redis.incr(key);

  if (count >= GRADUATION_THRESHOLD) {
    // Get current authority level
    const sb = getSupabase();
    const { data } = await sb
      .from('authority_levels')
      .select('requires_confirmation')
      .eq('org_id', DEFAULT_ORG_ID)
      .eq('action', action)
      .single();

    if (data?.requires_confirmation) {
      // Currently L3 (requires confirmation) — propose graduating to L2
      await proposeGraduation(action, 3);
    }
  }
}

/**
 * Record a rejection. Resets consecutive approvals to 0.
 */
export async function recordRejection(action: string): Promise<void> {
  const redis = getRedis();
  await redis.set(`trust:approvals:${action}`, 0);

  const sb = getSupabase();
  await sb.from('trust_graduation_log').insert({
    action,
    previous_level: 3,
    new_level: 3,
    reason: 'rejection_reset',
    consecutive_approvals: 0,
    changed_by: 'system',
  });
}

/**
 * Propose a graduation via L3 pending_confirmation.
 * Owner must approve before authority changes.
 */
export async function proposeGraduation(action: string, currentLevel: number): Promise<void> {
  const redis = getRedis();
  const count = await redis.get<number>(`trust:approvals:${action}`) || 0;
  const newLevel = currentLevel - 1;

  const sb = getSupabase();

  // Create an intention for the graduation proposal
  const { data: intention } = await sb
    .from('intention_log')
    .insert({
      org_id: DEFAULT_ORG_ID,
      channel: 'system',
      raw_input: `Trust graduation proposal: ${action} from L${currentLevel} to L${newLevel}`,
      detected_intent: 'trust_graduation',
      confidence: 1.0,
      authorised: true,
      status: 'approved',
      result_summary: `${count} consecutive approvals without edits`,
    })
    .select('id')
    .single();

  if (!intention) return;

  // Create pending confirmation
  const token = Math.random().toString(36).slice(2, 26);
  await sb.from('pending_confirmations').insert({
    org_id: DEFAULT_ORG_ID,
    intention_id: intention.id,
    channel: 'telegram',
    action: 'trust_graduation',
    description: `I've done "${action}" ${count} times and you approved every one. Want me to start doing this at Level ${newLevel} (${newLevel === 2 ? 'execute + notify' : newLevel === 1 ? 'auto-execute' : 'unknown'})?`,
    params: { action, current_level: currentLevel, new_level: newLevel, consecutive_approvals: count },
    token,
  });
}

/**
 * Graduate an action to a new authority level.
 * Called when owner confirms the graduation proposal.
 */
export async function graduateAction(action: string, newLevel: number): Promise<void> {
  const sb = getSupabase();
  const redis = getRedis();

  // Get current level
  const { data: current } = await sb
    .from('authority_levels')
    .select('requires_confirmation')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('action', action)
    .single();

  const previousLevel = current?.requires_confirmation ? 3 : 2;
  const requiresConfirmation = newLevel >= 3;

  // Update authority level
  await sb
    .from('authority_levels')
    .update({ requires_confirmation: requiresConfirmation })
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('action', action);

  // Log graduation
  const count = await redis.get<number>(`trust:approvals:${action}`) || 0;
  await sb.from('trust_graduation_log').insert({
    action,
    previous_level: previousLevel,
    new_level: newLevel,
    reason: 'auto_graduation',
    consecutive_approvals: count,
    changed_by: 'system',
  });

  // Reset counter
  await redis.set(`trust:approvals:${action}`, 0);
}

/**
 * Manual override — set authority level directly via /authority command.
 */
export async function manualSetLevel(action: string, level: number, changedBy: string): Promise<void> {
  const sb = getSupabase();
  const redis = getRedis();

  const { data: current } = await sb
    .from('authority_levels')
    .select('requires_confirmation')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('action', action)
    .single();

  const previousLevel = current?.requires_confirmation ? 3 : 2;
  const requiresConfirmation = level >= 3;

  await sb
    .from('authority_levels')
    .update({ requires_confirmation: requiresConfirmation })
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('action', action);

  await sb.from('trust_graduation_log').insert({
    action,
    previous_level: previousLevel,
    new_level: level,
    reason: 'manual_override',
    consecutive_approvals: null,
    changed_by: changedBy,
  });

  // Reset counter
  await redis.set(`trust:approvals:${action}`, 0);
}
