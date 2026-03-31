// ════════════════════════════════════════════════════════════
// Scope Validator — Validates job scope against rules,
// wind ratings, measurement anomalies, and material specs.
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isEnabled } from '../utils/feature-flags.js';
import { getWindZoneForSuburb, WIND_ZONE_REQUIREMENTS } from './data/perth-wind-zones.js';
import { ScopeValidationResult, JobScopeRecord } from './types.js';

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

// Required fields per job type
const REQUIRED_SCOPE_FIELDS: Record<string, string[]> = {
  patio: ['projection_mm', 'length_mm', 'roof_type', 'sheet_type', 'sheet_colour', 'steel_colour', 'num_posts', 'attachment_type'],
  carport: ['projection_mm', 'length_mm', 'roof_type', 'sheet_type', 'sheet_colour', 'steel_colour', 'num_posts'],
  fencing: ['length_mm', 'height_mm'],
};

// Typical measurement ranges for anomaly detection (Perth patio market)
const TYPICAL_RANGES: Record<string, { min: number; max: number; unit: string }> = {
  projection_mm: { min: 2000, max: 8000, unit: 'mm' },
  length_mm: { min: 3000, max: 20000, unit: 'mm' },
  height_mm: { min: 2100, max: 3600, unit: 'mm' },
  area_sqm: { min: 6, max: 120, unit: 'sqm' },
  num_posts: { min: 2, max: 12, unit: 'posts' },
  num_beams: { min: 1, max: 6, unit: 'beams' },
  num_rafters: { min: 2, max: 20, unit: 'rafters' },
  num_sheets: { min: 2, max: 30, unit: 'sheets' },
  quoted_amount: { min: 3000, max: 80000, unit: 'AUD' },
};

// Allowed materials per job type
const ALLOWED_MATERIALS: Record<string, string[]> = {
  patio: ['Colorbond', 'SolarSpan', 'Stratco_Outback', 'Bondor'],
  carport: ['Colorbond', 'SolarSpan', 'Stratco_Outback', 'Bondor'],
  fencing: ['Colorbond', 'Aluminium', 'Timber'],
};

/**
 * Validate a job's scope. Gated by feature flag.
 */
export async function validateScope(
  jobId: string,
  jobType?: string,
): Promise<ScopeValidationResult> {
  const enabled = await isEnabled('scope_validation_enabled');
  if (!enabled) {
    return { valid: true, errors: [], warnings: [] };
  }

  const sb = getSupabase();

  // Load scope
  const { data: scope } = await sb
    .from('job_scope')
    .select('*')
    .eq('job_id', jobId)
    .single();

  if (!scope) {
    return {
      valid: false,
      errors: [{ rule: 'scope_exists', field: 'job_scope', message: 'No scope record found for this job', severity: 'error' }],
      warnings: [],
    };
  }

  // Resolve job type if not provided
  if (!jobType) {
    const { data: job } = await sb
      .from('jobs')
      .select('type')
      .eq('id', jobId)
      .single();
    jobType = job?.type || 'patio';
  }

  const result: ScopeValidationResult = { valid: true, errors: [], warnings: [] };

  // Check required fields
  checkRequiredFields(scope, jobType, result);

  // Check wind rating
  await checkWindRating(scope, result);

  // Check measurement anomalies
  await checkMeasurements(sb, scope, jobType, result);

  // Check material compatibility
  checkMaterials(scope, jobType, result);

  // Update validation result in DB
  result.valid = result.errors.length === 0;

  await sb
    .from('job_scope')
    .update({
      validated_at: new Date().toISOString(),
      validation_result: result,
    })
    .eq('id', scope.id);

  return result;
}

// ════════════════════════════════════════════════════════════
// VALIDATORS
// ════════════════════════════════════════════════════════════

function checkRequiredFields(
  scope: Record<string, unknown>,
  jobType: string,
  result: ScopeValidationResult,
): void {
  const required = REQUIRED_SCOPE_FIELDS[jobType] || REQUIRED_SCOPE_FIELDS['patio'];

  for (const field of required) {
    const value = scope[field];
    if (value === null || value === undefined || value === '') {
      result.errors.push({
        rule: 'required_field',
        field,
        message: `Required field "${field}" is missing for job type "${jobType}"`,
        severity: 'error',
      });
    }
  }
}

async function checkWindRating(
  scope: Record<string, unknown>,
  result: ScopeValidationResult,
): Promise<void> {
  const enabled = await isEnabled('wind_rating_validation_enabled');
  if (!enabled) return;

  const suburb = scope.suburb as string;
  if (!suburb) {
    result.warnings.push({
      rule: 'wind_rating',
      field: 'suburb',
      message: 'Suburb not set — cannot validate wind rating',
    });
    return;
  }

  const requiredZone = getWindZoneForSuburb(suburb);
  const scopeRating = scope.wind_rating as string;

  result.wind_zone = requiredZone;

  if (!scopeRating) {
    result.errors.push({
      rule: 'wind_rating_set',
      field: 'wind_rating',
      message: `Wind rating not set. ${suburb} requires minimum ${requiredZone} (${WIND_ZONE_REQUIREMENTS[requiredZone].windSpeed})`,
      severity: 'error',
      expected: requiredZone,
    });
    return;
  }

  // Compare ratings (N1 < N2 < N3 < N4 < C1 < C2)
  const ratingOrder = ['N1', 'N2', 'N3', 'N4', 'C1', 'C2'];
  const requiredIdx = ratingOrder.indexOf(requiredZone);
  const scopeIdx = ratingOrder.indexOf(scopeRating);

  if (scopeIdx < requiredIdx) {
    result.errors.push({
      rule: 'wind_rating_insufficient',
      field: 'wind_rating',
      message: `Wind rating ${scopeRating} is insufficient for ${suburb}. Minimum required: ${requiredZone} (${WIND_ZONE_REQUIREMENTS[requiredZone].windSpeed})`,
      severity: 'error',
      actual_value: scopeRating,
      expected: requiredZone,
    });
  }

  // Check bracing requirement
  const requirements = WIND_ZONE_REQUIREMENTS[requiredZone];
  if (requirements.bracingRequired) {
    result.warnings.push({
      rule: 'bracing_required',
      field: 'wind_rating',
      message: `${requiredZone} zone (${suburb}) requires structural bracing — ensure design accounts for this`,
    });
  }
}

async function checkMeasurements(
  sb: SupabaseClient,
  scope: Record<string, unknown>,
  jobType: string,
  result: ScopeValidationResult,
): Promise<void> {
  const enabled = await isEnabled('anomaly_detection_enabled');
  if (!enabled) return;

  result.anomalies = [];

  // Range checks
  for (const [field, range] of Object.entries(TYPICAL_RANGES)) {
    const value = scope[field] as number;
    if (value === null || value === undefined) continue;

    if (value < range.min || value > range.max) {
      result.warnings.push({
        rule: 'measurement_range',
        field,
        message: `${field} = ${value}${range.unit} is outside typical range (${range.min}-${range.max}${range.unit})`,
        actual_value: value,
      });
    }
  }

  // Statistical anomaly detection: compare against similar jobs
  try {
    // Join through jobs table since job_scope has no job_type column
    const { data: similarJobs } = await sb
      .from('job_scope')
      .select('projection_mm, length_mm, area_sqm, num_posts, quoted_amount, jobs!inner(type)')
      .eq('jobs.type', jobType)
      .not('projection_mm', 'is', null)
      .limit(50);

    if (similarJobs && similarJobs.length >= 10) {
      for (const field of ['projection_mm', 'length_mm', 'area_sqm', 'quoted_amount'] as const) {
        const value = scope[field] as number;
        if (value === null || value === undefined) continue;

        const values = similarJobs
          .map((j: any) => j[field] as number)
          .filter((v): v is number => v !== null && v !== undefined);

        if (values.length < 5) continue;

        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const stddev = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length);

        if (stddev === 0) continue;

        const zscore = (value - mean) / stddev;

        if (Math.abs(zscore) > 2) {
          result.anomalies.push({ field, value, mean, stddev, zscore });
          result.warnings.push({
            rule: 'statistical_anomaly',
            field,
            message: `${field} = ${value} is ${zscore > 0 ? 'above' : 'below'} average (z-score: ${zscore.toFixed(1)}, mean: ${mean.toFixed(0)}, σ: ${stddev.toFixed(0)})`,
            actual_value: value,
          });
        }
      }
    }
  } catch (err) {
    // Non-fatal — statistical checks are best-effort
    console.warn('[scope-validator] Statistical anomaly check failed:', err);
  }
}

function checkMaterials(
  scope: Record<string, unknown>,
  jobType: string,
  result: ScopeValidationResult,
): void {
  const allowed = ALLOWED_MATERIALS[jobType];
  if (!allowed) return;

  const sheetType = scope.sheet_type as string;
  if (sheetType && !allowed.some((m) => sheetType.toLowerCase().includes(m.toLowerCase()))) {
    result.warnings.push({
      rule: 'material_compatibility',
      field: 'sheet_type',
      message: `Sheet type "${sheetType}" is not in the standard list for ${jobType}: [${allowed.join(', ')}]`,
      actual_value: sheetType,
    });
  }
}
