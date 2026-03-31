// ════════════════════════════════════════════════════════════
// Job State Machine — Lifecycle transitions with validation
//
// Every transition is validated, logged, and audit-trailed.
// WARRANTY is a terminal state (no transitions out).
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isEnabled } from '../utils/feature-flags.js';
import { JOB_STATES, TransitionContext } from './types.js';

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

// Valid state transitions: from → allowed to[]
const VALID_TRANSITIONS: Record<string, string[]> = {
  [JOB_STATES.LEAD]: [JOB_STATES.QUOTED],
  [JOB_STATES.QUOTED]: [JOB_STATES.ACCEPTED, JOB_STATES.LEAD],
  [JOB_STATES.ACCEPTED]: [JOB_STATES.DEPOSIT_PAID],
  [JOB_STATES.DEPOSIT_PAID]: [JOB_STATES.MATERIALS_ORDERED, JOB_STATES.SCHEDULED],
  [JOB_STATES.MATERIALS_ORDERED]: [JOB_STATES.SCHEDULED],
  [JOB_STATES.SCHEDULED]: [JOB_STATES.IN_PROGRESS],
  [JOB_STATES.IN_PROGRESS]: [JOB_STATES.COMPLETED],
  [JOB_STATES.COMPLETED]: [JOB_STATES.FINAL_INVOICED],
  [JOB_STATES.FINAL_INVOICED]: [JOB_STATES.PAID],
  [JOB_STATES.PAID]: [JOB_STATES.WARRANTY],
  [JOB_STATES.WARRANTY]: [], // Terminal state
};

export interface TransitionResult {
  success: boolean;
  fromState: string;
  toState: string;
  error?: string;
  transitionId?: string;
}

/**
 * Attempt to transition a job from its current state to a new state.
 */
export async function transitionJob(
  jobId: string,
  toState: string,
  context: TransitionContext,
): Promise<TransitionResult> {
  // Feature flag gate
  const enabled = await isEnabled('job_state_machine_enabled');
  if (!enabled) {
    return { success: false, fromState: '', toState, error: 'Job state machine is disabled' };
  }

  const sb = getSupabase();

  // Get current job state
  const { data: job, error: jobErr } = await sb
    .from('jobs')
    .select('status')
    .eq('id', jobId)
    .single();

  if (jobErr || !job) {
    return { success: false, fromState: '', toState, error: `Job ${jobId} not found` };
  }

  const fromState = job.status;

  // Validate transition is allowed
  const allowed = VALID_TRANSITIONS[fromState];
  if (!allowed || !allowed.includes(toState)) {
    return {
      success: false,
      fromState,
      toState,
      error: `Transition from "${fromState}" to "${toState}" is not allowed. Valid: [${(allowed || []).join(', ')}]`,
    };
  }

  // Pre-transition validators
  const validationError = await validatePreTransition(sb, jobId, fromState, toState);
  if (validationError) {
    return { success: false, fromState, toState, error: validationError };
  }

  // Execute transition
  const { error: updateErr } = await sb
    .from('jobs')
    .update({
      status: toState,
      ...(toState === JOB_STATES.QUOTED ? { quoted_at: new Date().toISOString() } : {}),
      ...(toState === JOB_STATES.ACCEPTED ? { accepted_at: new Date().toISOString() } : {}),
      ...(toState === JOB_STATES.SCHEDULED ? { scheduled_at: new Date().toISOString() } : {}),
      ...(toState === JOB_STATES.COMPLETED ? { completed_at: new Date().toISOString() } : {}),
    })
    .eq('id', jobId);

  if (updateErr) {
    return { success: false, fromState, toState, error: updateErr.message };
  }

  // Log transition
  const { data: transition } = await sb
    .from('job_state_transitions')
    .insert({
      job_id: jobId,
      from_state: fromState,
      to_state: toState,
      triggered_by: context.triggeredBy,
      trigger_channel: context.triggerChannel || null,
      reason: context.reason || null,
      metadata: context.metadata || {},
      intention_id: context.intentionId || null,
    })
    .select('id')
    .single();

  return {
    success: true,
    fromState,
    toState,
    transitionId: transition?.id,
  };
}

/**
 * Get valid next states for a job.
 */
export function getValidTransitions(currentState: string): string[] {
  return VALID_TRANSITIONS[currentState] || [];
}

/**
 * Get the full transition history for a job.
 */
export async function getTransitionHistory(jobId: string): Promise<unknown[]> {
  const sb = getSupabase();

  const { data } = await sb
    .from('job_state_transitions')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });

  return data || [];
}

// ════════════════════════════════════════════════════════════
// PRE-TRANSITION VALIDATORS
// ════════════════════════════════════════════════════════════

async function validatePreTransition(
  sb: SupabaseClient,
  jobId: string,
  fromState: string,
  toState: string,
): Promise<string | null> {
  switch (toState) {
    case JOB_STATES.QUOTED: {
      // Must have pricing_json with a total
      const { data: job } = await sb
        .from('jobs')
        .select('pricing_json')
        .eq('id', jobId)
        .single();

      if (!job?.pricing_json || !job.pricing_json.totalIncGST) {
        return 'Cannot transition to QUOTED: pricing_json with totalIncGST is required';
      }
      return null;
    }

    case JOB_STATES.DEPOSIT_PAID: {
      // Must have a deposit recorded (check job_cost_tracking or pricing_json)
      const { data: cost } = await sb
        .from('job_cost_tracking')
        .select('id')
        .eq('job_id', jobId)
        .single();

      // Allow if cost tracking exists or if manually triggered with reason
      if (!cost) {
        return 'Cannot transition to DEPOSIT_PAID: no cost tracking record found. Create one first or provide a reason override.';
      }
      return null;
    }

    case JOB_STATES.MATERIALS_ORDERED: {
      // Must have scope validated
      const { data: scope } = await sb
        .from('job_scope')
        .select('validated_at')
        .eq('job_id', jobId)
        .single();

      if (!scope?.validated_at) {
        return 'Cannot transition to MATERIALS_ORDERED: scope must be validated first';
      }
      return null;
    }

    case JOB_STATES.SCHEDULED: {
      // Must have a scheduled date
      const { data: job } = await sb
        .from('jobs')
        .select('scheduled_at')
        .eq('id', jobId)
        .single();

      if (!job?.scheduled_at) {
        return 'Cannot transition to SCHEDULED: scheduled_at date is required';
      }
      return null;
    }

    default:
      return null; // No special validation needed
  }
}
