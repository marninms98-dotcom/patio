// Patio rebuild — Phase 1 pricing (P1.2 priceComponents + P1.3 money assembly
// + output adapters).
//
//   ComponentV1[]  →  priceComponents(RateSnapshotV1)  →  CostLineV1[] / unpriced
//                  →  computeJobTotals(BuildPolicyV1)   →  PricingSnapshotV1
//                  →  toPricingJson()   (Contract B — the server gate)
//                  →  toQuoteInvestment()/toMaterialRows()  (Contract A / work order)
//
// `unpriced` = rate missing OR unit-mismatch → the quote BLOCKS. There are no
// `|| N` fallbacks; a wrong-but-nonzero rate cannot resolve because lookup is by
// structured key, not substring (kills T1/T2/T3/T4/T9/T10). Money is integer cents.

import {
  DEFAULT_BUILD_POLICY,
  type BuildPolicyV1,
  type ComponentCategory,
  type ComponentV1,
  type CostLineV1,
  type DepositStageV1,
  type PricingSnapshotV1,
  type PricingTotalsV1,
  type PricingValidationV1,
  type RateSnapshotV1,
  type SellLineV1,
  type UnpricedComponentV1,
  PRICING_MODEL_VERSION,
  rateKey
} from "./pricing-model.ts";
import { resolveRate, resolveRateByKey } from "./rate-snapshot.ts";
import type { PatioModelV1 } from "./patio-model.ts";

export interface PriceComponentsResult {
  lines: CostLineV1[];
  unpriced: UnpricedComponentV1[];
}

/** Structured-key pricing. Missing rate or unit mismatch → unpriced → block. */
export function priceComponents(components: ComponentV1[], snapshot: RateSnapshotV1): PriceComponentsResult {
  const lines: CostLineV1[] = [];
  const unpriced: UnpricedComponentV1[] = [];
  for (const component of components) {
    const resolution = resolveRate(snapshot, component.sku);
    if (!resolution.found || resolution.rate === null) {
      unpriced.push({
        component,
        rateKey: resolution.key,
        reason: "rate-missing",
        message: `No confirmed rate for "${component.description}" (key ${resolution.key}) — quote blocked until it is set.`
      });
      continue;
    }
    const rate = resolution.rate;
    if (rate.unit !== component.unit) {
      unpriced.push({
        component,
        rateKey: resolution.key,
        reason: "unit-mismatch",
        message: `Rate ${resolution.key} is per ${rate.unit} but "${component.description}" is billed per ${component.unit} — quote blocked.`
      });
      continue;
    }
    lines.push({
      componentId: component.componentId,
      category: component.category,
      description: component.description,
      quantity: component.quantity,
      unit: component.unit,
      rate,
      totalCostCents: Math.round(component.quantity * rate.value)
    });
  }
  return { lines, unpriced };
}

export interface LabourInputV1 {
  trades: number;
  labourers: number;
  days: number;
}

export interface LineInputV1 {
  description: string;
  category?: ComponentCategory;
  qty: number;
  unitCostCents: number;
  unitSellCents: number;
  /** Optional tag — "permit"/"demo" drive deposit-schedule + separation. */
  type?: string;
}

export interface PricingContextV1 {
  labour: LabourInputV1;
  additionalMaterials?: LineInputV1[];
  extras?: LineInputV1[];
}

const MATERIAL_CATEGORIES: ReadonlySet<ComponentCategory> = new Set([
  "steel",
  "roofing",
  "flashings",
  "gutters",
  "downpipes",
  "fixings",
  "fabrication"
]);

function isPermit(line: LineInputV1): boolean {
  return line.type === "permit" || /permit|council/i.test(line.description);
}
function isDemo(line: LineInputV1): boolean {
  return line.type === "demo" || /demolition/i.test(line.description);
}

/**
 * Faithful port of the legacy computeJobTotals() money truth, with the
 * confirmed policy scalars: per-line material markup 1.5, reverse-skillion
 * uplift 1.08 (materials, once), 10% GST, 13% commission of gross profit,
 * GST-inclusive material basis for true cost. Produces the frozen snapshot the
 * sacred output templates consume.
 */
export function computeJobTotals(
  model: PatioModelV1,
  priced: PriceComponentsResult,
  ctx: PricingContextV1,
  snapshot: RateSnapshotV1,
  policy: BuildPolicyV1 = DEFAULT_BUILD_POLICY
): PricingSnapshotV1 {
  const errors: PricingValidationV1["errors"] = [];
  const warnings: string[] = [];

  // Any unpriced component blocks the quote.
  for (const item of priced.unpriced) {
    errors.push({ code: "unpriced-component", message: item.message, componentId: item.component.componentId });
  }

  // ── Material cost + sell lines (per-line 1.5 markup baked into sell). ──
  const sellLines: SellLineV1[] = [];
  let matCostCents = 0;
  let matSellCents = 0;
  for (const line of priced.lines) {
    const sell = Math.round(line.totalCostCents * policy.materialMarkup);
    matCostCents += line.totalCostCents;
    matSellCents += sell;
    sellLines.push({
      componentId: line.componentId,
      category: line.category,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      totalCostCents: line.totalCostCents,
      totalSellCents: sell
    });
  }

  // ── Reverse-skillion uplift (materials only, once). Not double-counted with
  // box-gutter steel: the engine does not separately inflate box-gutter steel,
  // so the single 1.08 material uplift is the only reverse adjustment. ──
  let reverseApplied = false;
  if (model.roof.type === "reverse-skillion") {
    matCostCents = Math.round(matCostCents * policy.reverseSkillionUplift);
    matSellCents = Math.round(matSellCents * policy.reverseSkillionUplift);
    reverseApplied = true;
    warnings.push(`Reverse-skillion uplift ${policy.reverseSkillionUplift}× applied to material cost & sell (not itemised on lines).`);
  }

  // ── Labour (hours-based). Rates come from the single snapshot; missing → block. ──
  const hours = policy.labourHoursPerDay;
  const tradeHours = ctx.labour.trades * ctx.labour.days * hours;
  const labourerHours = ctx.labour.labourers * ctx.labour.days * hours;
  let labCostCents = 0;
  let labSellCents = 0;
  const tradeCost = resolveRateByKey(snapshot, "labour-trade-cost");
  const tradeSell = resolveRateByKey(snapshot, "labour-trade-sell");
  const labourerCost = resolveRateByKey(snapshot, "labour-labourer-cost");
  const labourerSell = resolveRateByKey(snapshot, "labour-labourer-sell");
  if (tradeHours > 0 && (!tradeCost || !tradeSell)) {
    errors.push({ code: "labour-rate-missing", message: "Trade labour rate is not in the rate snapshot — quote blocked." });
  }
  if (labourerHours > 0 && (!labourerCost || !labourerSell)) {
    errors.push({ code: "labour-rate-missing", message: "Labourer rate is not in the rate snapshot — quote blocked." });
  }
  if (tradeHours > 0 && tradeCost && tradeSell) {
    labCostCents += Math.round(tradeHours * tradeCost.value);
    labSellCents += Math.round(tradeHours * tradeSell.value);
  }
  if (labourerHours > 0 && labourerCost && labourerSell) {
    labCostCents += Math.round(labourerHours * labourerCost.value);
    labSellCents += Math.round(labourerHours * labourerSell.value);
  }
  if (tradeHours + labourerHours <= 0) {
    errors.push({ code: "labour-missing", message: "Job has no labour — a sendable quote requires labour hours." });
  } else {
    sellLines.push({
      componentId: "labour-install",
      category: "labour",
      description: `Labour — ${ctx.labour.trades} trade + ${ctx.labour.labourers} labourer × ${ctx.labour.days} day(s)`,
      quantity: (tradeHours + labourerHours),
      unit: "hour",
      totalCostCents: labCostCents,
      totalSellCents: labSellCents
    });
  }

  // ── Roof plumber (box gutter + riser) — labour bucket. ──
  if (model.drainage.houseGutter === "box" && model.attachment.type === "riser") {
    const rp = resolveRateByKey(snapshot, "roof-plumber-day");
    if (!rp) {
      errors.push({ code: "roof-plumber-rate-missing", message: "Box gutter + riser needs a roof-plumber day rate — quote blocked." });
    } else {
      const rpCost = rp.value;
      const rpSell = Math.round(rpCost * policy.materialMarkup);
      labCostCents += rpCost;
      labSellCents += rpSell;
      sellLines.push({
        componentId: "roof-plumber",
        category: "labour",
        description: "Roof Plumber (box gutter install) — 1 day",
        quantity: 1,
        unit: "day",
        totalCostCents: rpCost,
        totalSellCents: rpSell
      });
    }
  }

  // ── Additional materials + extras (provided verbatim; sell as supplied). ──
  let addMatCostCents = 0;
  let addMatSellCents = 0;
  for (const line of ctx.additionalMaterials ?? []) {
    const cost = Math.round(line.qty * line.unitCostCents);
    const sell = Math.round(line.qty * line.unitSellCents);
    addMatCostCents += cost;
    addMatSellCents += sell;
    sellLines.push({
      componentId: `add-mat-${sellLines.length}`,
      category: "extras",
      description: line.description,
      quantity: line.qty,
      unit: "each",
      totalCostCents: cost,
      totalSellCents: sell
    });
  }
  let extrasCostCents = 0;
  let extrasSellCents = 0;
  let councilFeesCents = 0;
  for (const line of ctx.extras ?? []) {
    const cost = Math.round(line.qty * line.unitCostCents);
    const sell = Math.round(line.qty * line.unitSellCents);
    extrasCostCents += cost;
    extrasSellCents += sell;
    if (isPermit(line)) councilFeesCents += sell;
    sellLines.push({
      componentId: `extra-${sellLines.length}`,
      category: "extras",
      description: line.description,
      quantity: line.qty,
      unit: "each",
      totalCostCents: cost,
      totalSellCents: sell
    });
  }

  // ── Rollup (mirrors computeJobTotals). ──
  const totalCostCents = matCostCents + addMatCostCents + labCostCents + extrasCostCents;
  const totalSellCents = matSellCents + addMatSellCents + labSellCents + extrasSellCents;
  const gstCents = Math.round(totalSellCents * policy.gstRate);
  const totalIncGstCents = totalSellCents + gstCents;
  // Materials are stored GST-inclusive → /1.1 for true cost.
  const trueCostCents = Math.round((matCostCents + addMatCostCents) / (1 + policy.gstRate)) + labCostCents + extrasCostCents;
  const grossMarginCents = totalSellCents - trueCostCents;
  const commissionCents = grossMarginCents > 0 ? Math.round(grossMarginCents * policy.commissionRate) : 0;
  const marginCents = grossMarginCents - commissionCents;
  const marginPct = totalSellCents > 0 ? (marginCents / totalSellCents) * 100 : 0;
  const marginHealth: PricingTotalsV1["marginHealth"] = marginPct > policy.marginThresholds.good
    ? "good"
    : marginPct >= policy.marginThresholds.watch ? "watch" : "floor";

  const totals: PricingTotalsV1 = {
    materialCostCents: matCostCents,
    materialSellCents: matSellCents,
    labourCostCents: labCostCents,
    labourSellCents: labSellCents,
    extrasCostCents: extrasCostCents + addMatCostCents,
    extrasSellCents: extrasSellCents + addMatSellCents,
    totalCostCents,
    totalExGstCents: totalSellCents,
    gstCents,
    totalIncGstCents,
    trueCostCents,
    grossMarginCents,
    commissionCents,
    marginCents,
    marginPct: Math.round(marginPct * 100) / 100,
    marginHealth
  };

  // ── Deposit schedule (business rule; independent of the deposit % input). ──
  const hasPlans = (ctx.extras ?? []).some((line) => isPermit(line) && Math.round(line.qty * line.unitSellCents) > 0);
  const scheduleStages = buildDepositSchedule(totalIncGstCents, hasPlans);
  if (marginHealth === "floor") warnings.push(`Margin ${totals.marginPct}% is below the ${policy.marginThresholds.watch}% floor.`);

  const passed = errors.length === 0 && totalIncGstCents > 0 && totalSellCents > 0;

  return {
    pricingVersion: PRICING_MODEL_VERSION,
    scopeId: model.scopeId,
    optionId: model.optionId,
    rateSnapshotId: snapshot.snapshotId,
    rateSnapshotVersion: snapshot.version,
    reverseSkillionUpliftApplied: reverseApplied,
    costLines: priced.lines,
    sellLines,
    totals,
    deposit: {
      percent: policy.depositPercent,
      hasPlans,
      councilFeesCents,
      scheduleStages
    },
    validation: { passed, errors, warnings }
  };
}

/** With plans → 20 / 50 / 30; without → 50 / 50. Last stage takes the exact remainder. */
export function buildDepositSchedule(totalIncGstCents: number, hasPlans: boolean): DepositStageV1[] {
  const spec: Array<{ pct: number; stage: string; description: string }> = hasPlans
    ? [
        { pct: 20, stage: "Deposit", description: "Deposit on acceptance" },
        { pct: 50, stage: "Materials", description: "On material order / delivery" },
        { pct: 30, stage: "Completion", description: "On practical completion" }
      ]
    : [
        { pct: 50, stage: "Deposit", description: "Deposit on acceptance" },
        { pct: 50, stage: "Completion", description: "On practical completion" }
      ];
  const stages: DepositStageV1[] = [];
  let allocated = 0;
  spec.forEach((entry, index) => {
    const amountCents = index === spec.length - 1
      ? totalIncGstCents - allocated
      : Math.round(totalIncGstCents * entry.pct / 100);
    allocated += amountCents;
    stages.push({ pct: entry.pct, stage: entry.stage, description: entry.description, amountCents });
  });
  return stages;
}

// ── Convenience: full pipeline in one call ──────────────────────────────────
export function computePricing(
  model: PatioModelV1,
  components: ComponentV1[],
  snapshot: RateSnapshotV1,
  ctx: PricingContextV1,
  policy: BuildPolicyV1 = DEFAULT_BUILD_POLICY
): PricingSnapshotV1 {
  const priced = priceComponents(components, snapshot);
  return computeJobTotals(model, priced, ctx, snapshot, policy);
}

// ── Contract B: the pricing snapshot the server gate validates ──────────────
const centsToDollars = (cents: number): number => Math.round(cents) / 100;

export interface PricingJsonLineItem {
  description: string;
  quantity: number;
  unit: string;
  cost_price: number;
  sell_price: number;
  total_cost: number;
  total_sell: number;
  category: string;
  supplier_name: string;
}

export interface PricingJsonV1 {
  source: string;
  version: string;
  totalExGST: number;
  totalIncGST: number;
  totalCostEstimate: number;
  materialCostEstimate: number;
  labourCostEstimate: number;
  commissionCostEstimate: number;
  margin_pct: number;
  line_items: PricingJsonLineItem[];
  deposit: {
    percent: number;
    council_fees: number;
    total_deposit_inc_gst: number;
    schedule: Array<{ pct: number; stage: string; description: string; amount: number }>;
  };
  pricing_validation_passed: boolean;
  pricing_validation_errors: Array<{ code: string; message: string }>;
  pricing_warnings: string[];
}

/**
 * Map a PricingSnapshotV1 onto the Contract-B pricing_json shape the unchanged
 * server `validatePricingSnapshot` gate consumes. Totals come straight from the
 * snapshot — never recomputed. Category names match REQUIRED_LINE_CATEGORIES.
 */
export function toPricingJson(snapshot: PricingSnapshotV1): PricingJsonV1 {
  const line_items: PricingJsonLineItem[] = snapshot.sellLines.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    cost_price: line.quantity > 0 ? centsToDollars(line.totalCostCents / line.quantity) : centsToDollars(line.totalCostCents),
    sell_price: line.quantity > 0 ? centsToDollars(line.totalSellCents / line.quantity) : centsToDollars(line.totalSellCents),
    total_cost: centsToDollars(line.totalCostCents),
    total_sell: centsToDollars(line.totalSellCents),
    category: line.category,
    supplier_name: ""
  }));
  return {
    source: "patio-engine-v1",
    version: snapshot.pricingVersion,
    totalExGST: centsToDollars(snapshot.totals.totalExGstCents),
    totalIncGST: centsToDollars(snapshot.totals.totalIncGstCents),
    totalCostEstimate: centsToDollars(snapshot.totals.totalCostCents),
    materialCostEstimate: centsToDollars(snapshot.totals.materialCostCents),
    labourCostEstimate: centsToDollars(snapshot.totals.labourCostCents),
    commissionCostEstimate: centsToDollars(snapshot.totals.commissionCents),
    margin_pct: snapshot.totals.marginPct,
    line_items,
    deposit: {
      percent: snapshot.deposit.percent,
      council_fees: centsToDollars(snapshot.deposit.councilFeesCents),
      total_deposit_inc_gst: snapshot.deposit.scheduleStages.length ? centsToDollars(snapshot.deposit.scheduleStages[0].amountCents) : 0,
      schedule: snapshot.deposit.scheduleStages.map((stage) => ({
        pct: stage.pct,
        stage: stage.stage,
        description: stage.description,
        amount: centsToDollars(stage.amountCents)
      }))
    },
    pricing_validation_passed: snapshot.validation.passed,
    pricing_validation_errors: snapshot.validation.errors.map((error) => ({ code: error.code, message: error.message })),
    pricing_warnings: snapshot.validation.warnings
  };
}

// ── Contract A (investment portion) + work-order material rows ───────────────
export interface QuoteInvestmentV1 {
  totalIncGST: number;
  gst: number;
  totalExGST: number;
  depositPercent: number;
  hasPlans: boolean;
  councilFees: number;
  schedule: Array<{ pct: number; stage: string; desc: string; amount: number }>;
  marginPct: number;
}

/** The pricing fields the client quote's investment page reads (Contract A). */
export function toQuoteInvestment(snapshot: PricingSnapshotV1): QuoteInvestmentV1 {
  return {
    totalIncGST: centsToDollars(snapshot.totals.totalIncGstCents),
    gst: centsToDollars(snapshot.totals.gstCents),
    totalExGST: centsToDollars(snapshot.totals.totalExGstCents),
    depositPercent: snapshot.deposit.percent,
    hasPlans: snapshot.deposit.hasPlans,
    councilFees: centsToDollars(snapshot.deposit.councilFeesCents),
    schedule: snapshot.deposit.scheduleStages.map((stage) => ({
      pct: stage.pct,
      stage: stage.stage,
      desc: stage.description,
      amount: centsToDollars(stage.amountCents)
    })),
    marginPct: snapshot.totals.marginPct
  };
}

export interface MaterialRowV1 {
  category: ComponentCategory;
  description: string;
  quantity: number;
  unit: string;
  colour?: string;
}

/** Work-order / supplier-order projection of the canonical component set. */
export function toMaterialRows(components: ComponentV1[]): MaterialRowV1[] {
  return components.map((component) => ({
    category: component.category,
    description: component.description,
    quantity: component.quantity,
    unit: component.unit,
    ...(component.colour !== undefined ? { colour: component.colour } : {})
  }));
}
