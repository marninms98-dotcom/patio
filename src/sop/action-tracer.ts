// ════════════════════════════════════════════════════════════
// Action Tracer — Links intention_log entries into sequences
//
// Builds per-job action sequences from intention_log, groups
// into phases, calculates timing, tags SOP-relevant patterns.
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isEnabled } from '../utils/feature-flags.js';
import { ActionTrace, ActionSequence } from './types.js';

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

// Phase mapping: intention action → job lifecycle phase
const ACTION_PHASE_MAP: Record<string, string> = {
  read_contact: 'lead_qualification',
  read_job_details: 'lead_qualification',
  search_memory: 'lead_qualification',
  send_stage1_chase: 'lead_chase',
  send_stage2_chase: 'lead_chase',
  send_stage3_chase: 'lead_chase',
  send_stage4_chase: 'lead_chase',
  send_quote: 'quoting',
  negotiate_price: 'quoting',
  commit_start_date: 'scheduling',
  schedule_job: 'scheduling',
  order_materials: 'materials',
  send_progress_update: 'execution',
  send_crew_notification: 'execution',
  update_job_status: 'execution',
  create_invoice: 'invoicing',
  escalate_complaint: 'resolution',
};

/**
 * Build an action sequence for a job from intention_log.
 * Gated by feature flag.
 */
export async function buildActionSequence(jobId: string): Promise<ActionSequence | null> {
  const enabled = await isEnabled('action_trace_analysis_enabled');
  if (!enabled) return null;

  const sb = getSupabase();

  // Query all intentions linked to this job
  const { data: intentions, error } = await sb
    .from('intention_log')
    .select('id, detected_intent, confidence, status, duration_ms, created_at, completed_at')
    .or(`parsed_params->job_id.eq.${jobId},entity_id.eq.${jobId}`)
    .not('status', 'in', '("denied","cancelled")')
    .order('created_at', { ascending: true });

  if (error || !intentions || intentions.length === 0) return null;

  // Get job type
  const { data: job } = await sb
    .from('jobs')
    .select('type, created_at, completed_at')
    .eq('id', jobId)
    .single();

  // Build traces with timing
  const traces: ActionTrace[] = [];
  let prevTimestamp: Date | null = null;

  for (let i = 0; i < intentions.length; i++) {
    const intent = intentions[i];
    const timestamp = new Date(intent.created_at);
    const gapMs = prevTimestamp ? timestamp.getTime() - prevTimestamp.getTime() : null;

    const trace: ActionTrace = {
      id: '',
      job_id: jobId,
      intention_ids: [intent.id],
      phase: ACTION_PHASE_MAP[intent.detected_intent] || 'other',
      sequence_index: i,
      action_type: intent.detected_intent,
      duration_ms: intent.duration_ms,
      gap_from_prev_ms: gapMs,
      metadata: { confidence: intent.confidence, status: intent.status },
      created_at: intent.created_at,
    };

    traces.push(trace);
    prevTimestamp = timestamp;
  }

  // Store traces
  for (const trace of traces) {
    try {
      const { data } = await sb
        .from('action_trace_sequences')
        .insert({
          job_id: trace.job_id,
          intention_ids: trace.intention_ids,
          phase: trace.phase,
          sequence_index: trace.sequence_index,
          action_type: trace.action_type,
          duration_ms: trace.duration_ms,
          gap_from_prev_ms: trace.gap_from_prev_ms,
          metadata: trace.metadata,
        })
        .select('id')
        .single();

      if (data) trace.id = data.id;
    } catch (err) {
      console.warn(`[action-tracer] Failed to store trace ${trace.sequence_index} for job ${jobId}:`, (err as Error).message);
    }
  }

  // Build phase summary
  const phaseSummary: Record<string, number> = {};
  for (const trace of traces) {
    const phase = trace.phase || 'other';
    phaseSummary[phase] = (phaseSummary[phase] || 0) + 1;
  }

  const totalDuration = traces.reduce((sum, t) => sum + (t.duration_ms || 0), 0);

  return {
    job_id: jobId,
    job_type: job?.type || 'patio',
    traces,
    total_duration_ms: totalDuration,
    phase_summary: phaseSummary,
    action_types: [...new Set(traces.map((t) => t.action_type))],
    started_at: job?.created_at || traces[0]?.created_at || '',
    completed_at: job?.completed_at || null,
  };
}

/**
 * Tag action sequences for SOP relevance.
 * Filters noise (read-only lookups, failed actions) and identifies
 * meaningful patterns (state changes, outbound comms, material orders).
 */
export function tagForSOPRelevance(sequence: ActionSequence): ActionTrace[] {
  const sopRelevantActions = new Set([
    'send_quote', 'negotiate_price', 'commit_start_date',
    'send_stage1_chase', 'send_stage2_chase', 'send_stage3_chase',
    'schedule_job', 'order_materials', 'create_invoice',
    'send_progress_update', 'send_crew_notification',
    'escalate_complaint', 'update_job_status',
  ]);

  return sequence.traces.filter((trace) => {
    // Include if action is SOP-relevant
    if (sopRelevantActions.has(trace.action_type)) return true;

    // Exclude pure lookups
    if (trace.action_type.startsWith('read_') || trace.action_type === 'search_memory') return false;

    // Include if it had significant duration (>1s = actual work)
    if (trace.duration_ms && trace.duration_ms > 1000) return true;

    return false;
  });
}

/**
 * Get all traced sequences for a job.
 */
export async function getJobTraces(jobId: string): Promise<ActionTrace[]> {
  const sb = getSupabase();

  const { data } = await sb
    .from('action_trace_sequences')
    .select('*')
    .eq('job_id', jobId)
    .order('sequence_index', { ascending: true });

  return (data || []) as ActionTrace[];
}
