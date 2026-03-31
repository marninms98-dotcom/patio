// ════════════════════════════════════════════════════════════
// Tool Registry — Boundary contracts, rate limiting, chaining
//
// Manages tool_boundary_contracts table: validates params,
// enforces rate limits, checks chaining rules, shadow mode.
// ════════════════════════════════════════════════════════════

import Ajv from 'ajv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getCache, setCache, rateLimit as redisRateLimit } from '../utils/redis.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let _sb: SupabaseClient | null = null;
const ajv = new Ajv({ allErrors: true });

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

export interface ToolContract {
  id: string;
  tool_name: string;
  description: string | null;
  param_schema: Record<string, unknown>;
  rate_limit_per_minute: number | null;
  rate_limit_per_hour: number | null;
  rate_limit_per_day: number | null;
  allowed_after_tools: string[];
  blocked_after_tools: string[];
  shadow_mode: boolean;
  enabled: boolean;
}

/**
 * Fetch a tool contract. Redis-cached with 5min TTL, Supabase fallback.
 */
export async function getToolContract(toolName: string): Promise<ToolContract | null> {
  const cacheKey = `tool_contract:${toolName}`;
  const cached = await getCache<ToolContract>(cacheKey);
  if (cached) return cached;

  const sb = getSupabase();
  const { data, error } = await sb
    .from('tool_boundary_contracts')
    .select('*')
    .eq('tool_name', toolName)
    .single();

  if (error || !data) return null;

  await setCache(cacheKey, data, CACHE_TTL_MS);
  return data;
}

/**
 * Validate tool params against the contract's JSON schema.
 */
export async function validateToolParams(
  toolName: string,
  params: Record<string, unknown>,
): Promise<{ valid: boolean; errors?: string[] }> {
  const contract = await getToolContract(toolName);
  if (!contract) return { valid: true }; // No contract = no validation

  if (!contract.param_schema || Object.keys(contract.param_schema).length === 0) {
    return { valid: true };
  }

  const validate = ajv.compile(contract.param_schema);
  const valid = validate(params);

  if (valid) return { valid: true };

  const errors = (validate.errors || []).map((e) => `${e.instancePath || '/'}: ${e.message}`);
  return { valid: false, errors };
}

/**
 * Check per-minute/hour/day rate limits for a tool.
 */
export async function checkToolRateLimit(
  toolName: string,
  entityId?: string,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const contract = await getToolContract(toolName);
  if (!contract) return { allowed: true };

  const suffix = entityId ? `:${entityId}` : '';

  // Check per-minute
  if (contract.rate_limit_per_minute) {
    const rl = await redisRateLimit(`tool_rate:${toolName}${suffix}:min`, contract.rate_limit_per_minute, 60_000);
    if (!rl.allowed) return { allowed: false, retryAfter: 60_000 };
  }

  // Check per-hour
  if (contract.rate_limit_per_hour) {
    const rl = await redisRateLimit(`tool_rate:${toolName}${suffix}:hr`, contract.rate_limit_per_hour, 3_600_000);
    if (!rl.allowed) return { allowed: false, retryAfter: 3_600_000 };
  }

  // Check per-day
  if (contract.rate_limit_per_day) {
    const rl = await redisRateLimit(`tool_rate:${toolName}${suffix}:day`, contract.rate_limit_per_day, 86_400_000);
    if (!rl.allowed) return { allowed: false, retryAfter: 86_400_000 };
  }

  return { allowed: true };
}

/**
 * Check tool chaining rules (allowed_after / blocked_after).
 */
export async function checkToolChaining(
  toolName: string,
  previousTool?: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const contract = await getToolContract(toolName);
  if (!contract) return { allowed: true };

  if (previousTool) {
    // Check blocked_after_tools
    if (contract.blocked_after_tools.length > 0 && contract.blocked_after_tools.includes(previousTool)) {
      return { allowed: false, reason: `${toolName} is blocked after ${previousTool}` };
    }

    // Check allowed_after_tools (if non-empty, previous must be in list)
    if (contract.allowed_after_tools.length > 0 && !contract.allowed_after_tools.includes(previousTool)) {
      return { allowed: false, reason: `${toolName} requires one of [${contract.allowed_after_tools.join(', ')}] before it` };
    }
  }

  return { allowed: true };
}

/**
 * Check if a tool is enabled. In shadow mode: log and return false.
 */
export async function isToolEnabled(toolName: string): Promise<boolean> {
  const contract = await getToolContract(toolName);
  if (!contract) return true; // No contract = allowed

  if (!contract.enabled) return false;

  if (contract.shadow_mode) {
    console.log(`[shadow] Tool ${toolName} would execute but is in shadow mode`);
    return false;
  }

  return true;
}

/**
 * Log a tool execution for SOP tracing.
 */
export async function logToolExecution(
  toolName: string,
  params: Record<string, unknown>,
  result: unknown,
  durationMs: number,
  intentionId?: string,
): Promise<void> {
  const { createHash } = await import('crypto');
  const sb = getSupabase();

  const content = { tool: toolName, params, result, durationMs, intentionId };
  const hash = createHash('sha256').update(JSON.stringify(content)).digest('hex');

  const { data: prev } = await sb
    .from('agent_memory_log')
    .select('hash')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  await sb.from('agent_memory_log').insert({
    org_id: '00000000-0000-0000-0000-000000000001',
    event_type: 'search_performed',
    channel: 'system',
    content,
    hash,
    previous_hash: prev?.hash || null,
  });
}
