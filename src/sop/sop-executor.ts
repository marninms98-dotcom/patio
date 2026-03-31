// ════════════════════════════════════════════════════════════
// SOP Executor — Guides jobs through approved SOPs
//
// Loads approved SOP for a job type, executes step by step,
// detects deviations, escalates when off-script.
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isEnabled } from '../utils/feature-flags.js';
import { processIntention } from '../orchestrator/index.js';
import { StandardProcedure, ProcedureExecution, ProcedureStep } from './types.js';

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

/**
 * Start executing an approved SOP for a job.
 * Returns the execution ID, or null if no SOP found.
 */
export async function startProcedure(jobId: string, jobType: string): Promise<string | null> {
  const enabled = await isEnabled('sop_execution_enabled');
  if (!enabled) return null;

  const sb = getSupabase();

  // Find the latest approved SOP for this job type
  const { data: sop } = await sb
    .from('standard_procedures')
    .select('*')
    .eq('job_type', jobType)
    .eq('approval_status', 'approved')
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (!sop) return null;

  // Create execution record
  const { data: execution, error } = await sb
    .from('procedure_executions')
    .insert({
      job_id: jobId,
      procedure_id: sop.id,
      current_step: 0,
      status: 'active',
    })
    .select('id')
    .single();

  if (error) throw error;
  return execution.id;
}

/**
 * Execute the next step in the SOP for a job.
 */
export async function executeNextStep(executionId: string): Promise<{
  step: ProcedureStep | null;
  completed: boolean;
  deviated: boolean;
}> {
  const enabled = await isEnabled('sop_execution_enabled');
  if (!enabled) return { step: null, completed: false, deviated: false };

  const sb = getSupabase();

  // Load execution + procedure
  const { data: execution } = await sb
    .from('procedure_executions')
    .select('*, standard_procedures(*)')
    .eq('id', executionId)
    .single();

  if (!execution || execution.status !== 'active') {
    return { step: null, completed: true, deviated: false };
  }

  const sop = execution.standard_procedures as StandardProcedure;
  const steps = sop.step_sequence as ProcedureStep[];
  const currentStep = execution.current_step;

  if (currentStep >= steps.length) {
    // SOP complete
    await sb
      .from('procedure_executions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', executionId);

    return { step: null, completed: true, deviated: false };
  }

  const step = steps[currentStep];

  // Execute step through orchestrator
  let stepStatus: 'completed' | 'failed' = 'completed';
  if (step.auto_execute) {
    try {
      await processIntention({
        channel: 'system',
        raw_input: `SOP step ${currentStep}: ${step.description}`,
        detected_intent: step.action_type,
        confidence: 1.0,
        parsed_params: { sop_execution_id: executionId, step_index: currentStep },
      });
    } catch (err) {
      console.warn(`[sop-executor] Step ${currentStep} (${step.action_type}) failed for execution ${executionId}:`, (err as Error).message);
      stepStatus = 'failed';
    }
  }

  // Record step result
  const stepResults = execution.step_results || [];
  stepResults.push({
    step_index: currentStep,
    action_type: step.action_type,
    status: stepStatus,
    completed_at: new Date().toISOString(),
  });

  // Advance to next step
  await sb
    .from('procedure_executions')
    .update({
      current_step: currentStep + 1,
      step_results: stepResults,
    })
    .eq('id', executionId);

  return { step, completed: false, deviated: false };
}

/**
 * Detect deviation from SOP.
 * Called when an action occurs that doesn't match the expected next step.
 */
export async function flagDeviation(
  executionId: string,
  expectedAction: string,
  actualAction: string,
  reason?: string,
): Promise<void> {
  const sb = getSupabase();

  const { data: execution } = await sb
    .from('procedure_executions')
    .select('current_step, deviations')
    .eq('id', executionId)
    .single();

  if (!execution) return;

  const deviations = execution.deviations || [];
  deviations.push({
    step_index: execution.current_step,
    expected_action: expectedAction,
    actual_action: actualAction,
    reason: reason || 'Unexpected action during SOP execution',
    detected_at: new Date().toISOString(),
  });

  // If >2 deviations, mark execution as deviated and escalate
  const status = deviations.length > 2 ? 'deviated' : 'active';

  await sb
    .from('procedure_executions')
    .update({ deviations, status })
    .eq('id', executionId);

  if (status === 'deviated') {
    await processIntention({
      channel: 'system',
      raw_input: `SOP deviation: execution ${executionId} has ${deviations.length} deviations. Escalating for review.`,
      detected_intent: 'escalate_complaint',
      confidence: 0.9,
      parsed_params: { sop_execution_id: executionId, deviation_count: deviations.length },
    });
  }
}

/**
 * Get active SOP execution for a job.
 */
export async function getActiveExecution(jobId: string): Promise<ProcedureExecution | null> {
  const sb = getSupabase();

  const { data } = await sb
    .from('procedure_executions')
    .select('*')
    .eq('job_id', jobId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return data as ProcedureExecution | null;
}

/**
 * Pause an SOP execution (e.g. when human takes over).
 */
export async function pauseExecution(executionId: string): Promise<void> {
  const sb = getSupabase();

  await sb
    .from('procedure_executions')
    .update({ status: 'paused' })
    .eq('id', executionId);
}

/**
 * Abort an SOP execution.
 */
export async function abortExecution(executionId: string): Promise<void> {
  const sb = getSupabase();

  await sb
    .from('procedure_executions')
    .update({ status: 'aborted' })
    .eq('id', executionId);
}
