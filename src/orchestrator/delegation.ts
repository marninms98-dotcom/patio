// ════════════════════════════════════════════════════════════
// Delegation — Temporary authority delegation between staff
//
// Owner can delegate L3/L4 approval authority to another
// staff member for a set period (e.g. while on holiday).
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

/**
 * Create a delegation session.
 */
export async function createDelegation(
  delegatorId: string,
  delegateId: string,
  levels: number[] = [3, 4],
  hours: number = 24,
  reason?: string,
): Promise<string> {
  const sb = getSupabase();

  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  const { data, error } = await sb
    .from('delegation_sessions')
    .insert({
      delegator_entity_id: delegatorId,
      delegate_entity_id: delegateId,
      authority_levels_delegated: levels,
      reason: reason || null,
      expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/**
 * Get the active delegate for a given delegator and authority level.
 * Returns delegate entity_id or null.
 */
export async function getActiveDelegate(
  delegatorId: string,
  level: number,
): Promise<string | null> {
  const sb = getSupabase();

  const { data } = await sb
    .from('delegation_sessions')
    .select('delegate_entity_id')
    .eq('delegator_entity_id', delegatorId)
    .eq('active', true)
    .gt('expires_at', new Date().toISOString())
    .contains('authority_levels_delegated', [level])
    .limit(1)
    .single();

  return data?.delegate_entity_id || null;
}

/**
 * Expire all overdue delegations. Called by scheduler.
 */
export async function expireDelegations(): Promise<number> {
  const sb = getSupabase();

  const { data } = await sb
    .from('delegation_sessions')
    .update({ active: false })
    .eq('active', true)
    .lt('expires_at', new Date().toISOString())
    .select('id');

  return data?.length || 0;
}

/**
 * Manually revoke a delegation session.
 */
export async function revokeDelegation(sessionId: string): Promise<void> {
  const sb = getSupabase();

  await sb
    .from('delegation_sessions')
    .update({ active: false })
    .eq('id', sessionId);
}
