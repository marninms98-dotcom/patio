// ════════════════════════════════════════════════════════════
// JARVIS Orchestrator — Main entry point
//
// Every inbound request/message flows through here.
// Full pipeline:
//   validate → authority check → commitment override →
//   chain check → rate limit → route → log
//
// Runs in the Railway Node.js agent, NOT as an Edge Function.
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { validateIntention } from './validator.js';
import { routeIntention, AuthorityLevel, Intention, IntentionResult } from './router.js';
import { logIntention, updateIntention } from './logger.js';
import { detectCommitment } from './commitment-detector.js';
import { isPaused, checkCircuitBreaker, getDailyActionCount } from './safety.js';
import { isToolEnabled, checkToolRateLimit, checkToolChaining, validateToolParams, logToolExecution } from './tool-registry.js';
import { isEnabled, isShadowMode } from '../utils/feature-flags.js';
import { rateLimit } from '../utils/redis.js';

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const CHAIN_CHECKPOINT_THRESHOLD = 5;
const DAILY_ACTION_LIMIT = 500;

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

export interface OrchestratorInput {
  channel: string;
  raw_input: string;
  user_id?: string;
  detected_intent?: string;
  confidence?: number;
  parsed_params?: Record<string, unknown>;
  entity_type?: string;
  entity_id?: string;
  chain_step?: number;
  context?: Record<string, unknown>;
}

export interface OrchestratorResult {
  status: string;
  intention_id?: string;
  authority_level?: AuthorityLevel;
  message: string;
  commitment?: { detected: boolean; type?: string; confidence: number };
  confirmation_token?: string;
  shadow_mode?: boolean;
  data?: unknown;
}

/**
 * Process an inbound intention through the full safety pipeline.
 */
export async function processIntention(input: OrchestratorInput): Promise<OrchestratorResult> {
  const startTime = Date.now();

  // ── Step 0: Master kill switch ──
  const orchestratorEnabled = await isEnabled('orchestrator_enabled');
  if (!orchestratorEnabled) {
    return {
      status: 'disabled',
      message: 'JARVIS orchestrator is disabled. Enable the orchestrator_enabled flag.',
    };
  }

  // ── Step 1: Check if paused ──
  const paused = await isPaused();
  if (paused) {
    return {
      status: 'paused',
      message: 'JARVIS is paused. Send /resume to reactivate.',
    };
  }

  // ── Step 2: Validate input ──
  const validation = validateIntention(input);
  if (!validation.valid) {
    return {
      status: 'invalid',
      message: `Validation failed: ${validation.errors?.join(', ')}`,
    };
  }

  // ── Step 3: Check authority ──
  const userRole = input.user_id ? await resolveUserRole(input.user_id) : 'anonymous';
  const authority = await checkAuthority(userRole, input.channel, input.detected_intent || 'unknown');

  if (!authority.allowed) {
    const intentionId = await logIntention({
      org_id: DEFAULT_ORG_ID,
      user_id: input.user_id || null,
      channel: input.channel,
      raw_input: input.raw_input,
      detected_intent: input.detected_intent || 'unknown',
      confidence: input.confidence || 0,
      parsed_params: input.parsed_params,
      authority_check: authority,
      authorised: false,
      status: 'denied',
      duration_ms: Date.now() - startTime,
    });

    return {
      status: 'denied',
      intention_id: intentionId,
      message: `Not authorised: ${input.detected_intent} via ${input.channel} as ${userRole}`,
    };
  }

  // ── Step 3b: Tool registry checks ──
  const toolName = input.detected_intent || 'unknown';
  const toolEnabled = await isToolEnabled(toolName);
  if (!toolEnabled) {
    const intentionId = await logIntention({
      org_id: DEFAULT_ORG_ID, user_id: input.user_id || null,
      channel: input.channel, raw_input: input.raw_input,
      detected_intent: toolName, confidence: input.confidence || 0,
      authority_check: authority, authorised: false, status: 'denied',
      error_detail: 'Tool disabled or in shadow mode',
      duration_ms: Date.now() - startTime,
    });
    return { status: 'tool_disabled', intention_id: intentionId, message: `Tool "${toolName}" is disabled or in shadow mode.` };
  }

  const toolRl = await checkToolRateLimit(toolName, input.entity_id);
  if (!toolRl.allowed) {
    return { status: 'tool_rate_limited', message: `Tool "${toolName}" rate limited. Retry after ${toolRl.retryAfter}ms.` };
  }

  const toolChain = await checkToolChaining(toolName, (input.context as any)?.previous_tool);
  if (!toolChain.allowed) {
    return { status: 'tool_chain_blocked', message: toolChain.reason || 'Tool chaining blocked.' };
  }

  if (input.parsed_params) {
    const paramValid = await validateToolParams(toolName, input.parsed_params);
    if (!paramValid.valid) {
      return { status: 'invalid_params', message: `Tool params invalid: ${paramValid.errors?.join(', ')}` };
    }
  }

  // ── Step 4: Commitment override ──
  // If commitment detected in outbound message, force Level 3 (approval required)
  let authorityLevel: AuthorityLevel = authority.requires_confirmation ? 3 : 1;
  let commitment = { detected: false, confidence: 0 } as ReturnType<typeof detectCommitment>;

  const commitmentEnabled = await isEnabled('commitment_detection');
  if (commitmentEnabled) {
    commitment = detectCommitment(input.raw_input);
    if (commitment.detected) {
      authorityLevel = 3; // Force L3 — owner must approve commitments
    }
  }

  // ── Step 5: Chain check ──
  // If chain_step > threshold, force checkpoint (L3)
  if (input.chain_step && input.chain_step > CHAIN_CHECKPOINT_THRESHOLD) {
    authorityLevel = Math.max(authorityLevel, 3) as AuthorityLevel;
  }

  // ── Step 6: Circuit breaker ──
  const circuitBroken = await checkCircuitBreaker(
    input.detected_intent || 'unknown',
    input.parsed_params || {},
  );
  if (circuitBroken) {
    const intentionId = await logIntention({
      org_id: DEFAULT_ORG_ID,
      user_id: input.user_id || null,
      channel: input.channel,
      raw_input: input.raw_input,
      detected_intent: input.detected_intent || 'unknown',
      confidence: input.confidence || 0,
      authority_check: authority,
      authorised: false,
      status: 'denied',
      duration_ms: Date.now() - startTime,
      error_detail: 'Circuit breaker: 3 consecutive identical actions detected',
    });

    return {
      status: 'circuit_breaker',
      intention_id: intentionId,
      message: 'Circuit breaker triggered: 3 consecutive identical actions. Blocked to prevent loops.',
    };
  }

  // ── Step 7: Rate limit ──
  const rl = await rateLimit(
    `intention:${input.user_id || 'system'}`,
    DAILY_ACTION_LIMIT,
    86_400_000, // 24 hours
  );
  if (!rl.allowed) {
    return {
      status: 'rate_limited',
      message: `Daily action limit (${DAILY_ACTION_LIMIT}) reached. ${rl.remaining} remaining.`,
    };
  }

  // ── Step 8: Check shadow mode ──
  const shadowMode = await isShadowMode('orchestrator_enabled');

  // ── Step 9: Log intention ──
  const intentionId = await logIntention({
    org_id: DEFAULT_ORG_ID,
    user_id: input.user_id || null,
    channel: input.channel,
    raw_input: input.raw_input,
    detected_intent: input.detected_intent || 'unknown',
    confidence: input.confidence || 0,
    parsed_params: input.parsed_params,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    authority_check: authority,
    authorised: true,
    status: shadowMode ? 'shadow' : 'authorised',
    duration_ms: Date.now() - startTime,
  });

  // In shadow mode: log but don't execute
  if (shadowMode) {
    return {
      status: 'shadow',
      intention_id: intentionId,
      authority_level: authorityLevel,
      message: `Shadow mode: would have routed ${input.detected_intent} at L${authorityLevel}`,
      commitment,
      shadow_mode: true,
    };
  }

  // ── Step 10: Route by authority level ──
  const intention: Intention = {
    id: intentionId,
    channel: input.channel,
    raw_input: input.raw_input,
    detected_intent: input.detected_intent || 'unknown',
    confidence: input.confidence || 0,
    parsed_params: input.parsed_params || {},
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    user_id: input.user_id,
    chain_step: input.chain_step,
  };

  const result = await routeIntention(intention, authorityLevel);

  // Update intention log with result
  const finalDuration = Date.now() - startTime;
  await updateIntention(intentionId, {
    status: result.status === 'executed' ? 'completed' : result.status,
    result_summary: result.message,
    completed_at: new Date().toISOString(),
    duration_ms: finalDuration,
    confirmation_token: result.confirmation_token,
  });

  // Log tool execution for SOP tracing
  await logToolExecution(toolName, input.parsed_params || {}, result, finalDuration, intentionId);

  return {
    status: result.status,
    intention_id: intentionId,
    authority_level: authorityLevel,
    message: result.message,
    commitment,
    confirmation_token: result.confirmation_token,
    data: result.data,
  };
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

async function resolveUserRole(userId: string): Promise<string> {
  const sb = getSupabase();
  const { data } = await sb
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();

  return data?.role || 'anonymous';
}

interface AuthorityResult {
  allowed: boolean;
  requires_confirmation: boolean;
  max_per_day?: number;
  cooldown_seconds?: number;
  reason?: string;
}

async function checkAuthority(
  role: string,
  channel: string,
  action: string,
): Promise<AuthorityResult> {
  const sb = getSupabase();
  const { data } = await sb.rpc('check_authority', {
    p_org_id: DEFAULT_ORG_ID,
    p_role: role,
    p_channel: channel,
    p_action: action,
  });

  return data || { allowed: false, requires_confirmation: true, reason: 'no_rule_defined' };
}
