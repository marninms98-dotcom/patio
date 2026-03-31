// ════════════════════════════════════════════════════════════
// Safety Module — Kill switches, circuit breaker, rate guards
//
// Every orchestrator call checks safety before proceeding.
// ════════════════════════════════════════════════════════════

import { getRedis, getCache, setCache } from '../utils/redis.js';
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

/**
 * Check if JARVIS is manually paused (e.g. via Telegram /pause command).
 * Checks Redis key `jarvis:paused`.
 */
export async function isPaused(): Promise<boolean> {
  const redis = getRedis();
  const paused = await redis.get('jarvis:paused');
  return paused === '1' || paused === 'true';
}

/**
 * Get today's total token/API spend from intention_log.
 */
export async function getDailyTokenSpend(): Promise<number> {
  // Check cache first (short TTL to avoid hammering DB)
  const cached = await getCache<number>('daily_token_spend');
  if (cached !== null) return cached;

  const sb = getSupabase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data } = await sb
    .from('intention_log')
    .select('duration_ms')
    .eq('org_id', DEFAULT_ORG_ID)
    .gte('created_at', today.toISOString())
    .not('status', 'in', '("denied","cancelled")');

  const total = (data || []).reduce((sum, row) => sum + (row.duration_ms || 0), 0);

  await setCache('daily_token_spend', total, 30_000); // 30s cache
  return total;
}

/**
 * Get today's total action count from intention_log.
 */
export async function getDailyActionCount(): Promise<number> {
  const cached = await getCache<number>('daily_action_count');
  if (cached !== null) return cached;

  const sb = getSupabase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count } = await sb
    .from('intention_log')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', DEFAULT_ORG_ID)
    .gte('created_at', today.toISOString())
    .not('status', 'in', '("denied","cancelled")');

  const total = count || 0;
  await setCache('daily_action_count', total, 30_000);
  return total;
}

/**
 * Circuit breaker: detect 3 consecutive identical actions.
 * Prevents infinite loops or stuck retry patterns.
 * Returns true if circuit should BREAK (i.e. block the action).
 */
export async function checkCircuitBreaker(
  action: string,
  params: Record<string, unknown>,
): Promise<boolean> {
  const sb = getSupabase();

  // Fetch the last 3 intentions
  const { data } = await sb
    .from('intention_log')
    .select('detected_intent, parsed_params')
    .eq('org_id', DEFAULT_ORG_ID)
    .order('created_at', { ascending: false })
    .limit(3);

  if (!data || data.length < 3) return false;

  // Check if all 3 are identical to the current action
  const paramsStr = JSON.stringify(params);
  const allIdentical = data.every(
    (row) =>
      row.detected_intent === action &&
      JSON.stringify(row.parsed_params) === paramsStr,
  );

  return allIdentical;
}
