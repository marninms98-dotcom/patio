// Patio rebuild — Phase 1 typed pricing model.
//
// This module layers the *commercial* model on top of the physical engine/v1
// (patio-model.ts + geometry.ts). It is deliberately independent of the DOM,
// the network, PDF generation and the legacy pricing path. All money is integer
// cents; all dimensions are integer millimetres (inherited from the geometry).
//
// It exists to make pricing trustworthy where the legacy tool is not:
//   * one canonical component set          (kills trap T6 — three quantity pipelines)
//   * one versioned rate snapshot          (kills trap T7 — three rate sources)
//   * structured-key rate lookup           (kills traps T1/T3/T4/T10 — substring matching)
//   * variant-match validation, not `>0`   (kills traps T2/T9 — non-zero-but-wrong, `|| N`)
//   * named, Captain-confirmed policy       (kills trap T8 — hardcoded magic numbers)
//
// See data/patio-rebuild-phase0-design/report.md §1.4/§1.5 and
// data/patio-rate-confirmation/confirmed-rates-2026-08-10.md.

export const PRICING_MODEL_VERSION = "patio-pricing/v1" as const;

/** Unit a component quantity (and its matched rate) is expressed in. */
export type ComponentUnit = "each" | "lm" | "sqm" | "bag" | "day" | "hour";

/** Coarse category — aligns with the server REQUIRED_LINE_CATEGORIES gate. */
export type ComponentCategory =
  | "steel"
  | "roofing"
  | "flashings"
  | "gutters"
  | "downpipes"
  | "fixings"
  | "fabrication"
  | "labour"
  | "extras";

/**
 * Structured product reference. Pricing keys off this — NEVER off the human
 * description string. `productId` is the rate family; the optional discriminators
 * make (e.g.) SolarSpan 75 and SolarSpan 150 distinct keys, and 150×50×2 distinct
 * from 150×50×3, so a wrong-but-nonzero rate can never resolve silently.
 */
export interface SkuRefV1 {
  productId: string;
  /** Steel/riser section key, e.g. "90x90x2", "76x38x1.6", "150x50x3". */
  sizeKey?: string;
  /** Roofing panel thickness in mm (75/100/150/200). Part of the roofing key. */
  thicknessMm?: number;
  /** Roofing profile id, e.g. "solarspan75", "corrugated", "stratco_cgi75". */
  profile?: string;
  /** Girth-flashing family: "standard" | "solarspan". */
  variant?: string;
}

/** One physical component — the single source of truth for a member/derivation. */
export interface ComponentV1 {
  componentId: string;
  category: ComponentCategory;
  sku: SkuRefV1;
  /** Display string for documents. NEVER used for pricing. */
  description: string;
  /** Integer count, or metres / m² as a number (see `unit`). */
  quantity: number;
  unit: ComponentUnit;
  /** True cut length of a structural member (mm), if applicable. */
  cutLengthMm?: number;
  /** Nested stock length actually billed (mm) — waste billed to the job. */
  orderLengthMm?: number;
  colour?: string;
  /** Human-readable derivation, e.g. "posts=ceil(dist/2400)+1, ×2 freestanding". */
  derivationRule: string;
  /** Scope fields that produced this component — the "Why?" trace. */
  sourceScopePaths: string[];
}

/** A rate is a typed (value, unit) pair with full provenance. Value in cents. */
export interface RateV1 {
  /** The canonical structured key this rate answers (see rateKey()). */
  sku: string;
  /** Value in integer cents, per `unit`. */
  value: number;
  unit: ComponentUnit;
  source: string;
  version: string;
  effectiveDate: string;
}

export interface RateSnapshotV1 {
  snapshotId: string;
  source: "scope_tool_defaults" | "offline-default";
  version: string;
  effectiveDate: string;
  fetchedAt: string;
  rates: Record<string, RateV1>;
}

export interface CostLineV1 {
  componentId: string;
  category: ComponentCategory;
  description: string;
  quantity: number;
  unit: ComponentUnit;
  /** The EXACT rate matched — provenance recorded. */
  rate: RateV1;
  /** quantity × rate (cents). Steel waste is already folded into `quantity` (metres of stock). */
  totalCostCents: number;
}

export interface SellLineV1 {
  componentId: string;
  category: ComponentCategory;
  description: string;
  quantity: number;
  unit: ComponentUnit;
  totalCostCents: number;
  totalSellCents: number;
}

/**
 * Reason a component could not be priced. Any unpriced component BLOCKS the quote;
 * the engine never guesses a rate.
 */
export interface UnpricedComponentV1 {
  component: ComponentV1;
  rateKey: string;
  reason: "rate-missing" | "unit-mismatch";
  message: string;
}

/**
 * Named policy — every constant the legacy tool hardcoded, made explicit and
 * Captain-confirmable. Money multipliers are dimensionless; quantity constants
 * are named. Confirmed 2026-08-10 (see confirmed-rates doc).
 */
export interface BuildPolicyV1 {
  /** Per-line material markup. Confirmed 1.5 (50%) — was 1.35. */
  materialMarkup: number;
  /** Reverse-skillion material uplift (cost AND sell), reverse only. Confirmed 1.08. */
  reverseSkillionUplift: number;
  /** Statutory GST. 0.10. */
  gstRate: number;
  /** Commission as a fraction of gross profit. Confirmed 0.13 (13%). */
  commissionRate: number;
  /** On-screen / snapshot deposit percent. Confirmed 10. */
  depositPercent: number;
  /** Margin health thresholds (percent). Confirmed >20 good / 10–20 watch / <10 floor. */
  marginThresholds: { good: number; watch: number };
  /** Quote validity window. Confirmed 30 days. */
  quoteValidityDays: number;
  /** Labour hours in a working day. Confirmed 8. */
  labourHoursPerDay: number;
  /** Kwikset bags per post. Legacy-preserved quantity constant (5). */
  concreteBagsPerPost: number;
  /** In-ground embedment added to a concrete-fixed post's billed cut length (mm). Legacy 600. */
  postConcreteEmbedmentMm: number;
  /** Saw kerf used when nesting cut pieces into stock lengths (mm). Legacy 3. */
  sawKerfMm: number;
  /** +join allowance added to gutter/flashing run lengths (mm). Legacy 200. */
  runJoinAllowanceMm: number;
  /** Sheet length overage before rounding up to the next 100 mm (mm). Legacy 50. */
  sheetLengthOverageMm: number;
}

/** Confirmed policy — Captain (nithin), 2026-08-10. */
export const DEFAULT_BUILD_POLICY: BuildPolicyV1 = {
  materialMarkup: 1.5,
  reverseSkillionUplift: 1.08,
  gstRate: 0.1,
  commissionRate: 0.13,
  depositPercent: 10,
  marginThresholds: { good: 20, watch: 10 },
  quoteValidityDays: 30,
  labourHoursPerDay: 8,
  concreteBagsPerPost: 5,
  postConcreteEmbedmentMm: 600,
  sawKerfMm: 3,
  runJoinAllowanceMm: 200,
  sheetLengthOverageMm: 50
};

export interface DepositStageV1 {
  pct: number;
  stage: string;
  description: string;
  amountCents: number;
}

export interface PricingTotalsV1 {
  materialCostCents: number;
  materialSellCents: number;
  labourCostCents: number;
  labourSellCents: number;
  extrasCostCents: number;
  extrasSellCents: number;
  totalCostCents: number;
  totalExGstCents: number;
  gstCents: number;
  totalIncGstCents: number;
  trueCostCents: number;
  grossMarginCents: number;
  commissionCents: number;
  marginCents: number;
  marginPct: number;
  marginHealth: "good" | "watch" | "floor";
}

export interface PricingValidationV1 {
  passed: boolean;
  errors: Array<{ code: string; message: string; componentId?: string }>;
  warnings: string[];
}

export interface PricingSnapshotV1 {
  pricingVersion: typeof PRICING_MODEL_VERSION;
  scopeId: string;
  optionId: string | null;
  rateSnapshotId: string;
  rateSnapshotVersion: string;
  reverseSkillionUpliftApplied: boolean;
  costLines: CostLineV1[];
  sellLines: SellLineV1[];
  totals: PricingTotalsV1;
  deposit: {
    percent: number;
    hasPlans: boolean;
    councilFeesCents: number;
    scheduleStages: DepositStageV1[];
  };
  validation: PricingValidationV1;
}

// ── Structured-key lookup ──────────────────────────────────────────────────
// The canonical key a SkuRefV1 resolves to in a RateSnapshotV1. This is the
// single place substring matching is replaced by structured keys. Two SKUs
// collide ONLY when they are genuinely the same priced thing.

export function rateKey(sku: SkuRefV1): string {
  switch (sku.productId) {
    case "steel-section":
      return `steel:${sku.sizeKey ?? "?"}`;
    case "roofing":
      // Both profile AND thickness must match — kills T1 (SolarSpan 150 → 75 rate).
      return `roofing:${sku.profile ?? "?"}:${sku.thicknessMm ?? 0}`;
    case "riser":
      return `riser:${sku.sizeKey ?? "?"}`;
    case "flashing-girth":
      return `flashing-girth:${sku.variant ?? "?"}`;
    default:
      // Simple families keyed by productId alone (gutters, downpipes, flashings,
      // fixings, concrete, brackets, gable-truss fab/steel, labour, roof-plumber).
      return sku.productId;
  }
}
