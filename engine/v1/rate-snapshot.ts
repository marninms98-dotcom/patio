// Patio rebuild — Phase 1 canonical rate snapshot.
//
// ONE versioned rate source, keyed by structured SKU key (see rateKey()), each
// row carrying source + version + effective date. The three legacy sources
// (`storedRates`, `loadSupabasePrices`, `scope_tool_defaults` overlay) collapse
// into this single snapshot — the canonical source is the central Supabase
// `scope_tool_defaults` table; the others reconcile to it (kills trap T7).
//
// Values are the Captain-confirmed rates of 2026-08-10
// (data/patio-rate-confirmation/confirmed-rates-2026-08-10.md). Uncommon
// sizes/materials the Captain left conditional are DELIBERATELY absent — a
// selection that resolves to an absent key BLOCKS the quote (it never guesses).
//
// There are NO `|| N` numeric fallbacks anywhere in this path.

import {
  type ComponentUnit,
  type RateSnapshotV1,
  type RateV1,
  type SkuRefV1,
  rateKey
} from "./pricing-model.ts";

const CONFIRMED_SOURCE = "scope_tool_defaults" as const;
const CONFIRMED_VERSION = "confirmed-2026-08-10";
const CONFIRMED_EFFECTIVE = "2026-08-10";

/** [key, valueCents, unit] rows — the confirmed standard set. */
const CONFIRMED_ROWS: Array<[string, number, ComponentUnit]> = [
  // ── Steel ($/LM) ──
  ["steel:90x90x2", 3550, "lm"],
  ["steel:100x50x2", 3000, "lm"],
  ["steel:76x38x1.6", 1550, "lm"],
  ["steel:75x50x2", 2600, "lm"],
  ["steel:150x50x2", 3905, "lm"],
  // ── Roofing ($/LM), keyed profile:thickness ──
  ["roofing:solarspan75:75", 12000, "lm"],
  ["roofing:solarspan100:100", 12000, "lm"],
  ["roofing:stratco_cgi75:75", 11000, "lm"],
  ["roofing:stratco_cgi100:100", 11000, "lm"],
  ["roofing:trimdek:0", 2200, "lm"],
  ["roofing:corrugated:0", 2200, "lm"],
  ["roofing:spanplus330:0", 1204, "lm"],
  // ── Gutters / downpipes / flashings ($/LM) ──
  ["patio-gutter", 1500, "lm"],
  ["box-gutter", 3000, "lm"],
  ["downpipe-95x45", 2222, "lm"],
  ["ridge-cap", 2000, "lm"],
  ["barge-flashing", 1500, "lm"],
  ["back-flashing", 1500, "lm"],
  ["gutter-flashing", 2000, "lm"],
  // Girth-based drawn flashings: cost = girth(m) × length(m) × rate → $/m² family.
  ["flashing-girth:standard", 1500, "sqm"],
  ["flashing-girth:solarspan", 2500, "sqm"],
  // ── Fixings / concrete / risers / brackets ──
  ["fixings", 5000, "sqm"],
  ["concrete-kwikset", 1000, "bag"],
  ["riser:100x50", 6500, "each"],
  ["riser:76x38", 5500, "each"],
  ["riser:75x50", 6000, "each"],
  ["rafter-bracket", 2000, "each"],
  ["tubing-bracket", 500, "each"],
  // ── Gable truss (editable / on-site customisable) ──
  // Steel rate applies ONLY to trusses fabricated from 76×38×1.6 RHS.
  ["gable-truss-fab", 9500, "lm"],
  ["gable-truss-steel", 1550, "lm"],
  // ── Labour ──
  ["labour-trade-cost", 6500, "hour"],
  ["labour-trade-sell", 11000, "hour"],
  ["labour-labourer-cost", 4500, "hour"],
  ["labour-labourer-sell", 9000, "hour"],
  ["roof-plumber-day", 110000, "day"]
];

function buildRatesFromRows(
  rows: Array<[string, number, ComponentUnit]>,
  source: string,
  version: string,
  effectiveDate: string
): Record<string, RateV1> {
  const rates: Record<string, RateV1> = {};
  for (const [key, value, unit] of rows) {
    rates[key] = { sku: key, value, unit, source, version, effectiveDate };
  }
  return rates;
}

/**
 * The offline canonical snapshot: the Captain-confirmed standard set of
 * 2026-08-10. Deterministic (no clock read) so tests and byte-stable snapshots
 * are reproducible.
 */
export const CONFIRMED_RATE_SNAPSHOT_2026_08_10: RateSnapshotV1 = {
  snapshotId: "confirmed-2026-08-10",
  source: CONFIRMED_SOURCE,
  version: CONFIRMED_VERSION,
  effectiveDate: CONFIRMED_EFFECTIVE,
  fetchedAt: CONFIRMED_EFFECTIVE,
  rates: buildRatesFromRows(CONFIRMED_ROWS, CONFIRMED_SOURCE, CONFIRMED_VERSION, CONFIRMED_EFFECTIVE)
};

/** A raw central-table record, as returned by `scope_tool_defaults`. */
export interface ScopeToolDefaultRecordV1 {
  /** Canonical structured key (see rateKey()). */
  rate_key: string;
  /** Confirmed price in cents. */
  value_cents: number;
  unit: ComponentUnit;
}

export interface BuildRateSnapshotOptions {
  snapshotId: string;
  version: string;
  effectiveDate: string;
  fetchedAt: string;
  source?: RateSnapshotV1["source"];
}

/**
 * Reconcile a set of central-table records into a single canonical snapshot.
 * The central `scope_tool_defaults` table is the source of truth; this is the
 * one place records become a versioned snapshot. Deterministic: provenance is
 * passed in, never read from the clock.
 */
export function buildRateSnapshot(
  records: ScopeToolDefaultRecordV1[],
  options: BuildRateSnapshotOptions
): RateSnapshotV1 {
  const source = options.source ?? CONFIRMED_SOURCE;
  const rates: Record<string, RateV1> = {};
  for (const record of records) {
    if (!Number.isFinite(record.value_cents) || record.value_cents <= 0) continue; // unpriced rows are simply absent → they block
    rates[record.rate_key] = {
      sku: record.rate_key,
      value: Math.round(record.value_cents),
      unit: record.unit,
      source,
      version: options.version,
      effectiveDate: options.effectiveDate
    };
  }
  return {
    snapshotId: options.snapshotId,
    source,
    version: options.version,
    effectiveDate: options.effectiveDate,
    fetchedAt: options.fetchedAt,
    rates
  };
}

export interface RateResolution {
  found: boolean;
  key: string;
  rate: RateV1 | null;
}

/** Structured-key lookup. No substring matching, no fallback. */
export function resolveRate(snapshot: RateSnapshotV1, sku: SkuRefV1): RateResolution {
  const key = rateKey(sku);
  const rate = snapshot.rates[key] ?? null;
  return { found: rate !== null, key, rate };
}

/** Look up a simple family key directly (labour rates, roof-plumber). */
export function resolveRateByKey(snapshot: RateSnapshotV1, key: string): RateV1 | null {
  return snapshot.rates[key] ?? null;
}
