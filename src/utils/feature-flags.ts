// ════════════════════════════════════════════════════════════
// Feature Flags — Redis-cached, Supabase-backed
//
// Checks Redis first (60s TTL), falls back to Supabase query.
// ════════════════════════════════════════════════════════════

import { getCache, setCache } from './redis.js';
import { createClient } from '@supabase/supabase-js';

const CACHE_TTL_MS = 60_000; // 60 seconds
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

let _supabaseClient: ReturnType<typeof createClient> | null = null;

function getSupabase() {
  if (!_supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    _supabaseClient = createClient(url, key);
  }
  return _supabaseClient;
}

interface FlagRow {
  enabled: boolean;
  shadow_mode: boolean;
}

async function fetchFlag(flagName: string): Promise<FlagRow | null> {
  // Check Redis cache first
  const cacheKey = `flag:${DEFAULT_ORG_ID}:${flagName}`;
  const cached = await getCache<FlagRow>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  // Fall back to Supabase
  const sb = getSupabase();
  const { data, error } = await sb
    .from('feature_flags')
    .select('enabled, shadow_mode')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('flag_key', flagName)
    .single();

  if (error || !data) {
    return null;
  }

  // Cache the result
  await setCache(cacheKey, data, CACHE_TTL_MS);
  return data;
}

/**
 * Check if a feature flag is enabled.
 * Returns false if the flag doesn't exist.
 */
export async function isEnabled(flagName: string): Promise<boolean> {
  const flag = await fetchFlag(flagName);
  return flag?.enabled ?? false;
}

/**
 * Check if a feature flag is in shadow mode.
 * Shadow mode: log actions but don't execute them.
 * Returns false if the flag doesn't exist.
 */
export async function isShadowMode(flagName: string): Promise<boolean> {
  const flag = await fetchFlag(flagName);
  return flag?.shadow_mode ?? false;
}
