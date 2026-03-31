// ════════════════════════════════════════════════════════════
// Cost Tracker — Real-time job cost tracking with Xero/crew sync
//
// Tracks: materials (from Xero POs), labour (from crew schedules),
// overheads (fixed %), and margin drift alerts.
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isEnabled } from '../utils/feature-flags.js';
import { JobCostTrackingRecord, MarginAlert } from './types.js';

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

// Alert thresholds
const ALERT_THRESHOLDS = {
  materials_variance_pct: 10,  // 10% material overrun triggers warning
  labour_variance_pct: 20,     // 20% labour overrun triggers warning
  min_margin_pct: 15,          // Below 15% margin triggers critical alert
};

/**
 * Update job cost tracking with latest actuals.
 * Gated by feature flag.
 */
export async function updateJobCosts(jobId: string): Promise<JobCostTrackingRecord | null> {
  const enabled = await isEnabled('cost_tracking_enabled');
  if (!enabled) return null;

  const sb = getSupabase();

  // Get or create cost tracking record
  let { data: costRecord } = await sb
    .from('job_cost_tracking')
    .select('*')
    .eq('job_id', jobId)
    .single();

  if (!costRecord) {
    // Initialize from job pricing_json
    const { data: job } = await sb
      .from('jobs')
      .select('pricing_json')
      .eq('id', jobId)
      .single();

    const pricing = job?.pricing_json || {};
    const quotedTotal = parseFloat(pricing.totalIncGST || pricing.total || '0');
    const quotedMaterials = parseFloat(pricing.materialsCost || '0');
    const quotedLabour = parseFloat(pricing.labourCost || '0');
    const quotedMargin = quotedTotal > 0 ? ((quotedTotal - quotedMaterials - quotedLabour) / quotedTotal) * 100 : 0;

    const { data: created } = await sb
      .from('job_cost_tracking')
      .insert({
        job_id: jobId,
        quoted_total: quotedTotal || null,
        quoted_materials: quotedMaterials || null,
        quoted_labour: quotedLabour || null,
        quoted_margin_pct: quotedMargin || null,
      })
      .select()
      .single();

    costRecord = created;
  }

  if (!costRecord) return null;

  // Sync material costs from Xero
  const materialCosts = await syncMaterialCosts(sb, jobId);

  // Sync labour costs from crew schedules
  const labourCosts = await syncLabourCosts(sb, jobId);

  // Calculate totals and variances
  const actualTotal = materialCosts + labourCosts + (costRecord.actual_overheads || 0);
  const quotedTotal = costRecord.quoted_total || 0;
  const currentMargin = quotedTotal > 0 ? ((quotedTotal - actualTotal) / quotedTotal) * 100 : 0;

  const varianceMaterials = materialCosts - (costRecord.quoted_materials || 0);
  const varianceLabour = labourCosts - (costRecord.quoted_labour || 0);
  const varianceTotal = actualTotal - quotedTotal;

  // Update record
  const { data: updated } = await sb
    .from('job_cost_tracking')
    .update({
      actual_materials: materialCosts,
      actual_labour: labourCosts,
      actual_total: actualTotal,
      current_margin_pct: currentMargin,
      variance_materials: varianceMaterials,
      variance_labour: varianceLabour,
      variance_total: varianceTotal,
    })
    .eq('id', costRecord.id)
    .select()
    .single();

  // Check for margin alerts
  if (updated) {
    await checkMarginAlerts(sb, jobId, updated);
  }

  return updated;
}

/**
 * Sync material costs from Xero purchase orders.
 * Gated by feature flag. Returns total material cost.
 */
async function syncMaterialCosts(sb: SupabaseClient, jobId: string): Promise<number> {
  const enabled = await isEnabled('xero_cost_sync_enabled');
  if (!enabled) return 0;

  try {
    // Forward-ref table — may not exist yet
    const { data: poLines } = await sb
      .from('xero_cached_po_lines')
      .select('amount_inc_tax')
      .eq('job_id', jobId);

    if (!poLines || poLines.length === 0) return 0;

    const total = poLines.reduce((sum, line) => sum + parseFloat(line.amount_inc_tax || '0'), 0);

    await sb
      .from('job_cost_tracking')
      .update({ last_xero_sync_at: new Date().toISOString() })
      .eq('job_id', jobId);

    return total;
  } catch (err) {
    // xero_cached_po_lines may not exist yet — non-fatal
    console.warn('[cost-tracker] Xero sync failed (table may not exist):', (err as Error).message);
    return 0;
  }
}

/**
 * Sync labour costs from crew schedule logs.
 * Gated by feature flag. Returns total labour cost.
 */
async function syncLabourCosts(sb: SupabaseClient, jobId: string): Promise<number> {
  const enabled = await isEnabled('crew_schedule_sync_enabled');
  if (!enabled) return 0;

  try {
    // Forward-ref table — may not exist yet
    const { data: logs } = await sb
      .from('crew_schedule_logs')
      .select('hours_worked, hourly_rate')
      .eq('job_id', jobId);

    if (!logs || logs.length === 0) return 0;

    const total = logs.reduce(
      (sum, log) => sum + (parseFloat(log.hours_worked || '0') * parseFloat(log.hourly_rate || '0')),
      0,
    );

    await sb
      .from('job_cost_tracking')
      .update({ last_crew_sync_at: new Date().toISOString() })
      .eq('job_id', jobId);

    return total;
  } catch (err) {
    // crew_schedule_logs may not exist yet — non-fatal
    console.warn('[cost-tracker] Crew sync failed (table may not exist):', (err as Error).message);
    return 0;
  }
}

/**
 * Check for margin alerts and create them if thresholds breached.
 * Gated by feature flag.
 */
async function checkMarginAlerts(
  sb: SupabaseClient,
  jobId: string,
  costRecord: Record<string, unknown>,
): Promise<void> {
  const enabled = await isEnabled('margin_alerts_enabled');
  if (!enabled) return;

  const quotedMaterials = (costRecord.quoted_materials as number) || 0;
  const actualMaterials = (costRecord.actual_materials as number) || 0;
  const quotedLabour = (costRecord.quoted_labour as number) || 0;
  const actualLabour = (costRecord.actual_labour as number) || 0;
  const currentMargin = (costRecord.current_margin_pct as number) || 0;

  // Material overrun check
  if (quotedMaterials > 0) {
    const materialVariancePct = ((actualMaterials - quotedMaterials) / quotedMaterials) * 100;
    if (materialVariancePct > ALERT_THRESHOLDS.materials_variance_pct) {
      await createAlert(sb, jobId, costRecord.id as string, {
        alert_type: 'material_overrun',
        severity: materialVariancePct > 25 ? 'critical' : 'warning',
        message: `Material costs ${materialVariancePct.toFixed(1)}% over budget ($${actualMaterials.toFixed(0)} vs quoted $${quotedMaterials.toFixed(0)})`,
        threshold_value: ALERT_THRESHOLDS.materials_variance_pct,
        actual_value: materialVariancePct,
      });
    }
  }

  // Labour overrun check
  if (quotedLabour > 0) {
    const labourVariancePct = ((actualLabour - quotedLabour) / quotedLabour) * 100;
    if (labourVariancePct > ALERT_THRESHOLDS.labour_variance_pct) {
      await createAlert(sb, jobId, costRecord.id as string, {
        alert_type: 'labour_overrun',
        severity: labourVariancePct > 40 ? 'critical' : 'warning',
        message: `Labour costs ${labourVariancePct.toFixed(1)}% over budget ($${actualLabour.toFixed(0)} vs quoted $${quotedLabour.toFixed(0)})`,
        threshold_value: ALERT_THRESHOLDS.labour_variance_pct,
        actual_value: labourVariancePct,
      });
    }
  }

  // Margin below threshold check
  if (currentMargin < ALERT_THRESHOLDS.min_margin_pct && (costRecord.quoted_total as number) > 0) {
    await createAlert(sb, jobId, costRecord.id as string, {
      alert_type: 'margin_below_threshold',
      severity: currentMargin < 5 ? 'critical' : 'warning',
      message: `Job margin at ${currentMargin.toFixed(1)}% — below ${ALERT_THRESHOLDS.min_margin_pct}% threshold`,
      threshold_value: ALERT_THRESHOLDS.min_margin_pct,
      actual_value: currentMargin,
    });
  }
}

async function createAlert(
  sb: SupabaseClient,
  jobId: string,
  costTrackingId: string,
  alert: {
    alert_type: string;
    severity: string;
    message: string;
    threshold_value: number;
    actual_value: number;
  },
): Promise<void> {
  // Check for recent duplicate alert (same type, same job, last 24h)
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { data: existing } = await sb
    .from('job_margin_alerts')
    .select('id')
    .eq('job_id', jobId)
    .eq('alert_type', alert.alert_type)
    .eq('acknowledged', false)
    .gte('created_at', dayAgo.toISOString())
    .limit(1);

  if (existing && existing.length > 0) return; // Already alerted

  await sb.from('job_margin_alerts').insert({
    job_id: jobId,
    cost_tracking_id: costTrackingId,
    ...alert,
  });
}

/**
 * Get all unacknowledged alerts for a job.
 */
export async function getUnacknowledgedAlerts(jobId: string): Promise<MarginAlert[]> {
  const sb = getSupabase();

  const { data } = await sb
    .from('job_margin_alerts')
    .select('*')
    .eq('job_id', jobId)
    .eq('acknowledged', false)
    .order('created_at', { ascending: false });

  return (data || []) as MarginAlert[];
}

/**
 * Acknowledge a margin alert.
 */
export async function acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<void> {
  const sb = getSupabase();

  await sb
    .from('job_margin_alerts')
    .update({
      acknowledged: true,
      acknowledged_by: acknowledgedBy,
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', alertId);
}
