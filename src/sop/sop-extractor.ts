// ════════════════════════════════════════════════════════════
// SOP Extractor — The "Reflector" background agent
//
// Analyses completed jobs, finds common patterns, drafts SOPs.
// When >80% of jobs follow the same action pattern, proposes
// an SOP for owner approval.
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isEnabled } from '../utils/feature-flags.js';
import { buildActionSequence, tagForSOPRelevance } from './action-tracer.js';
import { ActionSequence, ProcedureStep, SOPExtractionResult, StandardProcedure } from './types.js';

const PATTERN_THRESHOLD = 0.80; // 80% of jobs must follow pattern

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

/**
 * Analyse completed jobs of a given type and extract SOPs.
 * Gated by feature flag.
 */
export async function analyseCompletedJobs(jobType: string): Promise<SOPExtractionResult | null> {
  const enabled = await isEnabled('sop_extraction_enabled');
  if (!enabled) return null;

  const sb = getSupabase();

  // Get completed jobs of this type
  const { data: jobs } = await sb
    .from('jobs')
    .select('id')
    .eq('type', jobType)
    .eq('status', 'complete')
    .order('completed_at', { ascending: false })
    .limit(50);

  if (!jobs || jobs.length < 5) return null; // Need minimum sample

  // Build action sequences for each job
  const sequences: ActionSequence[] = [];
  for (const job of jobs) {
    try {
      const seq = await buildActionSequence(job.id);
      if (seq) sequences.push(seq);
    } catch (err) {
      console.warn(`[sop-extractor] Failed to build sequence for job ${job.id}:`, (err as Error).message);
    }
  }

  if (sequences.length < 5) return null;

  // Extract the common pattern
  return extractSOP(sequences, jobType);
}

/**
 * Extract an SOP from a set of action sequences.
 * Finds the most common action ordering and proposes it as a procedure.
 */
export function extractSOP(sequences: ActionSequence[], jobType: string): SOPExtractionResult | null {
  // Get SOP-relevant traces for each sequence
  const relevantSequences = sequences.map((seq) => ({
    jobId: seq.job_id,
    actions: tagForSOPRelevance(seq).map((t) => t.action_type),
  }));

  // Find the most common action pattern (order matters)
  const patternCounts = new Map<string, { count: number; jobIds: string[] }>();

  for (const seq of relevantSequences) {
    const key = seq.actions.join(' → ');
    const existing = patternCounts.get(key) || { count: 0, jobIds: [] };
    existing.count++;
    existing.jobIds.push(seq.jobId);
    patternCounts.set(key, existing);
  }

  // Find dominant pattern
  let dominant: { pattern: string; count: number; jobIds: string[] } | null = null;
  for (const [pattern, data] of patternCounts) {
    if (!dominant || data.count > dominant.count) {
      dominant = { pattern, ...data };
    }
  }

  if (!dominant) return null;

  const frequency = dominant.count / sequences.length;

  if (frequency < PATTERN_THRESHOLD) return null; // Not consistent enough

  // Build procedure steps from the dominant pattern
  const actionTypes = dominant.pattern.split(' → ');
  const steps: ProcedureStep[] = actionTypes.map((action, index) => ({
    index,
    action_type: action,
    description: `Step ${index + 1}: ${action.replace(/_/g, ' ')}`,
    required: true,
    auto_execute: isAutoExecutable(action),
    authority_level: getActionAuthorityLevel(action),
    on_failure: 'escalate',
  }));

  // Identify common deviations (patterns that differ from dominant)
  const deviations: string[] = [];
  for (const [pattern, data] of patternCounts) {
    if (pattern !== dominant.pattern && data.count > 1) {
      deviations.push(`${data.count} jobs: ${pattern}`);
    }
  }

  // Build branching logic from deviations
  const branchingLogic: Record<string, unknown> = {};
  if (deviations.length > 0) {
    branchingLogic.alternative_paths = deviations;
    branchingLogic.deviation_rate = 1 - frequency;
  }

  return {
    job_type: jobType,
    jobs_analysed: sequences.length,
    pattern_frequency: frequency,
    proposed_steps: steps,
    branching_logic: branchingLogic,
    common_deviations: deviations,
    confidence: frequency,
  };
}

/**
 * Save a proposed SOP as a DRAFT in standard_procedures.
 */
export async function saveDraftSOP(result: SOPExtractionResult): Promise<string> {
  const sb = getSupabase();

  // Check for existing SOP of same type
  const { data: existing } = await sb
    .from('standard_procedures')
    .select('id, version')
    .eq('job_type', result.job_type)
    .eq('approval_status', 'approved')
    .order('version', { ascending: false })
    .limit(1)
    .single();

  const version = existing ? existing.version + 1 : 1;

  const { data, error } = await sb
    .from('standard_procedures')
    .insert({
      name: `${result.job_type} Standard Procedure v${version}`,
      description: `Auto-extracted from ${result.jobs_analysed} completed ${result.job_type} jobs. Pattern frequency: ${(result.pattern_frequency * 100).toFixed(0)}%.`,
      job_type: result.job_type,
      step_sequence: result.proposed_steps,
      branching_logic: result.branching_logic,
      approval_status: 'draft',
      version,
      pattern_frequency: result.pattern_frequency,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/**
 * Approve a draft SOP. Only owner can approve.
 */
export async function approveSOP(sopId: string, approvedBy: string): Promise<void> {
  const sb = getSupabase();

  // Deprecate any previously approved SOP of same type
  const { data: sop } = await sb
    .from('standard_procedures')
    .select('job_type')
    .eq('id', sopId)
    .single();

  if (sop?.job_type) {
    await sb
      .from('standard_procedures')
      .update({ approval_status: 'deprecated' })
      .eq('job_type', sop.job_type)
      .eq('approval_status', 'approved');
  }

  await sb
    .from('standard_procedures')
    .update({
      approval_status: 'approved',
      approved_by: approvedBy,
    })
    .eq('id', sopId);
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

function isAutoExecutable(action: string): boolean {
  const autoActions = new Set([
    'read_job_details', 'read_contact', 'search_memory',
    'store_observation', 'log_communication', 'update_internal_note',
    'send_progress_update', 'send_daily_digest',
  ]);
  return autoActions.has(action);
}

function getActionAuthorityLevel(action: string): number {
  const l1 = new Set(['read_job_details', 'read_contact', 'search_memory', 'store_observation']);
  const l2 = new Set(['send_progress_update', 'send_stage1_chase', 'update_job_status']);
  const l3 = new Set(['send_quote', 'negotiate_price', 'commit_start_date', 'order_materials', 'schedule_job']);

  if (l1.has(action)) return 1;
  if (l2.has(action)) return 2;
  if (l3.has(action)) return 3;
  return 4; // Default to escalate
}
