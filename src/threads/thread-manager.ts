// ════════════════════════════════════════════════════════════
// Thread Manager — Lifecycle management for active_threads
//
// Thread types: negotiation, chase_cycle, onboarding, review,
// bd_opportunity, quote_follow_up, job_scheduling,
// material_ordering, complaint_resolution
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { calculatePriority } from '../orchestrator/priority-scorer.js';
import { processIntention } from '../orchestrator/index.js';
import { enqueueEvent } from '../events/event-queue.js';
import { cancelPendingForThread } from '../channels/outbound-queue.js';

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

export interface ActiveThread {
  id: string;
  thread_type: string;
  subject_entity_id: string | null;
  related_job_id: string | null;
  current_step: number;
  next_action_date: string | null;
  context_summary: string | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Joined fields
  entity_name?: string;
  entity_type?: string;
}

// Default next-action delays per thread type (in hours)
const THREAD_DEFAULTS: Record<string, { delayHours: number; maxSteps: number }> = {
  chase_cycle: { delayHours: 48, maxSteps: 4 },
  negotiation: { delayHours: 24, maxSteps: 6 },
  onboarding: { delayHours: 1, maxSteps: 3 },
  review: { delayHours: 4, maxSteps: 2 },
  bd_opportunity: { delayHours: 72, maxSteps: 5 },
  quote_follow_up: { delayHours: 48, maxSteps: 3 },
  job_scheduling: { delayHours: 24, maxSteps: 4 },
  material_ordering: { delayHours: 12, maxSteps: 3 },
  complaint_resolution: { delayHours: 4, maxSteps: 5 },
};

/**
 * Create a new thread.
 */
export async function createThread(
  type: string,
  entityId: string,
  jobId?: string,
  channel?: string,
  context?: string,
): Promise<string> {
  const sb = getSupabase();

  const defaults = THREAD_DEFAULTS[type] || { delayHours: 24, maxSteps: 5 };
  const nextAction = new Date(Date.now() + defaults.delayHours * 60 * 60 * 1000);

  const priority = await calculatePriority({
    event_type: type,
    job_id: jobId,
    entity_id: entityId,
  });

  const { data, error } = await sb
    .from('active_threads')
    .insert({
      thread_type: type,
      subject_entity_id: entityId,
      related_job_id: jobId || null,
      current_step: 1,
      next_action_date: nextAction.toISOString(),
      context_summary: context || `New ${type} thread`,
      status: 'active',
      metadata: { channel: channel || 'system', priority, max_steps: defaults.maxSteps },
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/**
 * Get all due threads, ordered by priority.
 */
export async function getDueThreads(): Promise<ActiveThread[]> {
  const sb = getSupabase();

  const { data, error } = await sb
    .from('active_threads')
    .select('*, entity_profiles!subject_entity_id(name, entity_type)')
    .eq('status', 'active')
    .lte('next_action_date', new Date().toISOString())
    .order('next_action_date', { ascending: true });

  if (error) throw error;

  return (data || []).map((t: any) => ({
    ...t,
    entity_name: t.entity_profiles?.name,
    entity_type: t.entity_profiles?.entity_type,
  }));
}

/**
 * Process a due thread: load context, route through orchestrator, advance step.
 */
export async function processThread(thread: ActiveThread): Promise<void> {
  const sb = getSupabase();
  const defaults = THREAD_DEFAULTS[thread.thread_type] || { delayHours: 24, maxSteps: 5 };
  const maxSteps = (thread.metadata?.max_steps as number) || defaults.maxSteps;

  // Check if max steps reached
  if (thread.current_step >= maxSteps) {
    await sb
      .from('active_threads')
      .update({ status: 'escalated', context_summary: `${thread.context_summary} — max steps reached, escalating` })
      .eq('id', thread.id);

    // Enqueue L4 escalation
    await processIntention({
      channel: 'system',
      raw_input: `Thread ${thread.thread_type} for ${thread.entity_name || thread.subject_entity_id} reached max steps (${maxSteps}). Escalating.`,
      detected_intent: 'escalate_complaint',
      confidence: 0.9,
      parsed_params: { thread_id: thread.id, thread_type: thread.thread_type },
    });
    return;
  }

  // Route through orchestrator for the current step's action
  const intentMap: Record<string, string> = {
    chase_cycle: `send_stage${Math.min(thread.current_step, 4)}_chase`,
    negotiation: 'negotiate_price',
    quote_follow_up: 'send_stage1_chase',
    complaint_resolution: 'escalate_complaint',
    job_scheduling: 'schedule_job',
    material_ordering: 'order_materials',
  };

  const intent = intentMap[thread.thread_type] || 'read_job_details';

  await processIntention({
    channel: 'system',
    raw_input: `Thread step ${thread.current_step}: ${thread.thread_type} for ${thread.entity_name || 'unknown'}`,
    detected_intent: intent,
    confidence: 0.85,
    parsed_params: {
      thread_id: thread.id,
      thread_type: thread.thread_type,
      step: thread.current_step,
      entity_id: thread.subject_entity_id,
      job_id: thread.related_job_id,
    },
    entity_id: thread.subject_entity_id || undefined,
    chain_step: thread.current_step,
  });

  // Advance thread
  const nextAction = new Date(Date.now() + defaults.delayHours * 60 * 60 * 1000);
  await sb
    .from('active_threads')
    .update({
      current_step: thread.current_step + 1,
      next_action_date: nextAction.toISOString(),
      context_summary: `Step ${thread.current_step + 1}: ${intent}`,
    })
    .eq('id', thread.id);
}

/**
 * Update a thread's fields.
 */
export async function updateThread(
  threadId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const sb = getSupabase();
  await sb.from('active_threads').update(updates).eq('id', threadId);
}

/**
 * Pause a thread with a reason.
 */
export async function pauseThread(threadId: string, reason: string): Promise<void> {
  const sb = getSupabase();
  await sb
    .from('active_threads')
    .update({
      status: 'paused',
      context_summary: reason,
    })
    .eq('id', threadId);
}

/**
 * Yield to human: cancel pending outbound, pause thread.
 */
export async function yieldToHuman(threadId: string): Promise<void> {
  // Cancel any pending outbound messages for this thread
  const { data: thread } = await getSupabase()
    .from('active_threads')
    .select('metadata')
    .eq('id', threadId)
    .single();

  const intentionId = (thread?.metadata as any)?.last_intention_id;
  if (intentionId) {
    await cancelPendingForThread(intentionId);
  }

  await pauseThread(threadId, 'Human took over');
}

/**
 * Scan for due threads and enqueue events. Called by scheduler every 30min.
 */
export async function scanDueThreads(): Promise<void> {
  const dueThreads = await getDueThreads();

  if (dueThreads.length > 0) {
    await enqueueEvent(
      'thread_due',
      'scheduler',
      { thread_count: dueThreads.length },
      50,
    );
  }
}
