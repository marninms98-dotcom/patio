// ════════════════════════════════════════════════════════════
// Job Lifecycle Types
// ════════════════════════════════════════════════════════════

export enum JOB_STATES {
  LEAD = 'lead',
  QUOTED = 'quoted',
  ACCEPTED = 'accepted',
  DEPOSIT_PAID = 'deposit_paid',
  MATERIALS_ORDERED = 'materials_ordered',
  SCHEDULED = 'scheduled',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FINAL_INVOICED = 'final_invoiced',
  PAID = 'paid',
  WARRANTY = 'warranty',
}

export interface JobRecord {
  id: string;
  org_id: string;
  status: string;
  type: string;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  site_address: string | null;
  site_suburb: string | null;
  scope_json: Record<string, unknown>;
  pricing_json: Record<string, unknown>;
  notes: string | null;
  ghl_contact_id: string | null;
  created_by: string | null;
  quoted_at: string | null;
  accepted_at: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobScopeRecord {
  id: string;
  job_id: string;
  projection_mm: number | null;
  length_mm: number | null;
  height_mm: number | null;
  area_sqm: number | null;
  roof_type: string | null;
  sheet_type: string | null;
  sheet_colour: string | null;
  steel_colour: string | null;
  wind_rating: string | null;
  suburb: string | null;
  council: string | null;
  num_posts: number | null;
  num_beams: number | null;
  num_rafters: number | null;
  num_sheets: number | null;
  has_gutters: boolean;
  has_downpipes: boolean;
  has_fascia: boolean;
  attachment_type: string | null;
  footing_type: string | null;
  quoted_amount: number | null;
  materials_list: unknown[];
  scope_hash: string | null;
  validated_at: string | null;
  validation_result: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface JobCostTrackingRecord {
  id: string;
  job_id: string;
  quoted_total: number | null;
  quoted_materials: number | null;
  quoted_labour: number | null;
  quoted_margin_pct: number | null;
  actual_materials: number;
  actual_labour: number;
  actual_overheads: number;
  actual_total: number;
  current_margin_pct: number | null;
  variance_materials: number;
  variance_labour: number;
  variance_total: number;
  last_xero_sync_at: string | null;
  last_crew_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransitionContext {
  triggeredBy: string;
  triggerChannel?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  intentionId?: string;
}

export interface MarginAlert {
  id: string;
  job_id: string;
  cost_tracking_id: string | null;
  alert_type: 'material_overrun' | 'labour_overrun' | 'margin_below_threshold' | 'cost_spike';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  threshold_value: number | null;
  actual_value: number | null;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface ScopeValidationResult {
  valid: boolean;
  errors: Array<{
    rule: string;
    field: string;
    message: string;
    severity: 'error' | 'warning' | 'info';
    actual_value?: unknown;
    expected?: unknown;
  }>;
  warnings: Array<{
    rule: string;
    field: string;
    message: string;
    actual_value?: unknown;
  }>;
  wind_zone?: string;
  anomalies?: Array<{
    field: string;
    value: number;
    mean: number;
    stddev: number;
    zscore: number;
  }>;
}
