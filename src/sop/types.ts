// ════════════════════════════════════════════════════════════
// SOP Engine Types
// ════════════════════════════════════════════════════════════

import { JOB_STATES } from '../jobs/types.js';

export interface ActionTrace {
  id: string;
  job_id: string;
  intention_ids: string[];
  phase: string | null;
  sequence_index: number;
  action_type: string;
  duration_ms: number | null;
  gap_from_prev_ms: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ActionSequence {
  job_id: string;
  job_type: string;
  traces: ActionTrace[];
  total_duration_ms: number;
  phase_summary: Record<string, number>; // phase → count of actions
  action_types: string[];
  started_at: string;
  completed_at: string | null;
}

export interface ProcedureStep {
  index: number;
  action_type: string;
  description: string;
  expected_duration_ms?: number;
  required: boolean;
  auto_execute: boolean;
  authority_level: number;
  on_failure?: 'skip' | 'retry' | 'escalate' | 'abort';
  conditions?: Record<string, unknown>;
}

export interface StandardProcedure {
  id: string;
  name: string;
  description: string | null;
  job_type: string | null;
  step_sequence: ProcedureStep[];
  branching_logic: Record<string, unknown>;
  approval_status: 'draft' | 'pending_review' | 'approved' | 'deprecated';
  approved_by: string | null;
  version: number;
  source_job_ids: string[];
  pattern_frequency: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProcedureExecution {
  id: string;
  job_id: string;
  procedure_id: string;
  current_step: number;
  status: 'active' | 'completed' | 'deviated' | 'paused' | 'aborted';
  deviations: Array<{
    step_index: number;
    expected_action: string;
    actual_action: string;
    reason?: string;
    detected_at: string;
  }>;
  step_results: Array<{
    step_index: number;
    action_type: string;
    status: 'completed' | 'skipped' | 'failed';
    duration_ms?: number;
    completed_at: string;
  }>;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromptRule {
  id: string;
  rule_text: string;
  category: string;
  version: number;
  active: boolean;
  source: 'owner_directive' | 'learned' | 'sop';
  previous_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface SOPExtractionResult {
  job_type: string;
  jobs_analysed: number;
  pattern_frequency: number;
  proposed_steps: ProcedureStep[];
  branching_logic: Record<string, unknown>;
  common_deviations: string[];
  confidence: number;
}
