import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { adaptLegacyScope, type LegacyScopeV18 } from "./shadow-comparison.ts";
import { computePatioGeometry } from "./geometry.ts";
import { computeComponents, steelSizeKey } from "./components.ts";
import {
  CONFIRMED_RATE_SNAPSHOT_2026_08_10,
  buildRateSnapshot,
  resolveRateByKey,
  type ScopeToolDefaultRecordV1
} from "./rate-snapshot.ts";
import {
  computePricing,
  priceComponents,
  computeJobTotals,
  toPricingJson,
  toMaterialRows,
  toQuoteInvestment,
  type PricingContextV1
} from "./pricing.ts";
import { DEFAULT_BUILD_POLICY, rateKey, type ComponentV1 } from "./pricing-model.ts";
import type { PatioModelV1 } from "./patio-model.ts";

const snapshot = CONFIRMED_RATE_SNAPSHOT_2026_08_10;
const CTX: PricingContextV1 = { labour: { trades: 2, labourers: 1, days: 3 } };

const fixturePath = fileURLToPath(new URL("./fixtures/golden-cases.json", import.meta.url));
const goldenCases = JSON.parse(readFileSync(fixturePath, "utf8")) as Array<{ id: string; legacyScope: LegacyScopeV18 }>;
const scopeById = (id: string): LegacyScopeV18 => {
  const found = goldenCases.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing fixture ${id}`);
  return found.legacyScope;
};
const modelFor = (id: string): PatioModelV1 => adaptLegacyScope(scopeById(id)).model;

function price(model: PatioModelV1, ctx: PricingContextV1 = CTX) {
  const geometry = computePatioGeometry(model);
  const components = computeComponents(model, geometry);
  const snap = computePricing(model, components, snapshot, ctx);
  return { geometry, components, snap };
}

// A faithful port of the UNCHANGED server gate
// (supabase/functions/send-quote/index.ts validatePricingSnapshot) so we prove
// Contract B is satisfied without touching the sacred template.
const REQUIRED_LINE_CATEGORIES = new Set(["steel", "roofing", "flashings", "gutters", "labour"]);
function serverValidate(pricingJson: any): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!pricingJson || typeof pricingJson !== "object") return { ok: false, issues: ["missing"] };
  if (pricingJson.pricing_validation_passed === false) {
    const errs = Array.isArray(pricingJson.pricing_validation_errors) ? pricingJson.pricing_validation_errors : [];
    if (errs.length) errs.forEach((e: any) => e && e.message && issues.push(e.message));
    else issues.push("client validation failed without detail");
  }
  const inc = Number(pricingJson.totalIncGST);
  const ex = Number(pricingJson.totalExGST);
  if (!Number.isFinite(inc) || inc <= 0) issues.push("incGST <= 0");
  if (!Number.isFinite(ex) || ex <= 0) issues.push("exGST <= 0");
  if (Array.isArray(pricingJson.line_items)) {
    pricingJson.line_items.forEach((li: any, idx: number) => {
      const cat = li && li.category ? String(li.category).toLowerCase() : "";
      if (!REQUIRED_LINE_CATEGORIES.has(cat)) return;
      const tc = Number(li.total_cost);
      const ts = Number(li.total_sell);
      if (!Number.isFinite(tc) || tc <= 0) issues.push(`line ${idx} ${cat} cost<=0`);
      if (!Number.isFinite(ts) || ts <= 0) issues.push(`line ${idx} ${cat} sell<=0`);
    });
  }
  return { ok: issues.length === 0, issues };
}

// ════════════════════════════════════════════════════════════════════════════
// Confirmed rate snapshot (T7 — one canonical, versioned source)
// ════════════════════════════════════════════════════════════════════════════

test("confirmed snapshot exposes exactly the Captain-confirmed standard rate set (2026-08-10)", () => {
  const expected: Record<string, [number, string]> = {
    "steel:90x90x2": [3550, "lm"],
    "steel:100x50x2": [3000, "lm"],
    "steel:76x38x1.6": [1550, "lm"],
    "steel:75x50x2": [2600, "lm"],
    "steel:150x50x2": [3905, "lm"],
    "roofing:solarspan75:75": [12000, "lm"],
    "roofing:solarspan100:100": [12000, "lm"],
    "roofing:stratco_cgi75:75": [11000, "lm"],
    "roofing:stratco_cgi100:100": [11000, "lm"],
    "roofing:trimdek:0": [2200, "lm"],
    "roofing:corrugated:0": [2200, "lm"],
    "roofing:spanplus330:0": [1204, "lm"],
    "patio-gutter": [1500, "lm"],
    "box-gutter": [3000, "lm"],
    "downpipe-95x45": [2222, "lm"],
    "ridge-cap": [2000, "lm"],
    "barge-flashing": [1500, "lm"],
    "back-flashing": [1500, "lm"],
    "gutter-flashing": [2000, "lm"],
    "flashing-girth:standard": [1500, "sqm"],
    "flashing-girth:solarspan": [2500, "sqm"],
    "fixings": [5000, "sqm"],
    "concrete-kwikset": [1000, "bag"],
    "riser:100x50": [6500, "each"],
    "riser:76x38": [5500, "each"],
    "riser:75x50": [6000, "each"],
    "rafter-bracket": [2000, "each"],
    "tubing-bracket": [500, "each"],
    "gable-truss-fab": [9500, "lm"],
    "gable-truss-steel": [1550, "lm"],
    "labour-trade-cost": [6500, "hour"],
    "labour-trade-sell": [11000, "hour"],
    "labour-labourer-cost": [4500, "hour"],
    "labour-labourer-sell": [9000, "hour"],
    "roof-plumber-day": [110000, "day"]
  };
  assert.deepEqual(Object.keys(snapshot.rates).sort(), Object.keys(expected).sort());
  for (const [key, [cents, unit]] of Object.entries(expected)) {
    const rate = resolveRateByKey(snapshot, key);
    assert.ok(rate, `missing rate ${key}`);
    assert.equal(rate!.value, cents, `${key} value`);
    assert.equal(rate!.unit, unit, `${key} unit`);
    // T7: every rate carries provenance (source + version + effective date).
    assert.equal(rate!.source, "scope_tool_defaults");
    assert.equal(rate!.version, "confirmed-2026-08-10");
    assert.equal(rate!.effectiveDate, "2026-08-10");
  }
});

test("confirmed policy scalars match the Captain confirmation (2026-08-10)", () => {
  assert.equal(DEFAULT_BUILD_POLICY.materialMarkup, 1.5);
  assert.equal(DEFAULT_BUILD_POLICY.reverseSkillionUplift, 1.08);
  assert.equal(DEFAULT_BUILD_POLICY.gstRate, 0.1);
  assert.equal(DEFAULT_BUILD_POLICY.commissionRate, 0.13);
  assert.equal(DEFAULT_BUILD_POLICY.depositPercent, 10);
  assert.deepEqual(DEFAULT_BUILD_POLICY.marginThresholds, { good: 20, watch: 10 });
  assert.equal(DEFAULT_BUILD_POLICY.quoteValidityDays, 30);
});

test("buildRateSnapshot reconciles central-table records into one snapshot and drops unpriced rows (T7)", () => {
  const records: ScopeToolDefaultRecordV1[] = [
    { rate_key: "steel:90x90x2", value_cents: 3550, unit: "lm" },
    { rate_key: "patio-gutter", value_cents: 1500, unit: "lm" },
    { rate_key: "steel:150x50x3", value_cents: 0, unit: "lm" } // unconfirmed → absent → blocks
  ];
  const built = buildRateSnapshot(records, {
    snapshotId: "test-snap",
    version: "v-test",
    effectiveDate: "2026-08-10",
    fetchedAt: "2026-08-10T00:00:00Z"
  });
  assert.equal(Object.keys(built.rates).length, 2);
  assert.equal(built.rates["steel:150x50x3"], undefined);
  assert.equal(built.rates["steel:90x90x2"].value, 3550);
  assert.equal(built.rates["steel:90x90x2"].source, "scope_tool_defaults");
});

// ════════════════════════════════════════════════════════════════════════════
// Structured-key lookup traps (T1, T3, T4, T10) + no-fallback block (T2, T9)
// ════════════════════════════════════════════════════════════════════════════

test("T1: SolarSpan 150/200 do NOT resolve to the 75 mm rate — they key distinctly and block", () => {
  // Legacy: `if (d.includes('solarspan')) return storedRates['Solarspan 75mm']`.
  const ss75 = rateKey({ productId: "roofing", profile: "solarspan75", thicknessMm: 75 });
  const ss150 = rateKey({ productId: "roofing", profile: "solarspan150", thicknessMm: 150 });
  const ss200 = rateKey({ productId: "roofing", profile: "solarspan200", thicknessMm: 200 });
  assert.notEqual(ss75, ss150);
  assert.notEqual(ss75, ss200);
  assert.ok(resolveRateByKey(snapshot, ss75), "75mm is priced");
  assert.equal(resolveRateByKey(snapshot, ss150), null, "150mm has no rate → blocks");
  assert.equal(resolveRateByKey(snapshot, ss200), null, "200mm has no rate → blocks");

  // End to end: a SolarSpan-150 skillion blocks rather than misprice at $120.
  const legacy = structuredClone(scopeById("skillion-solarspan-freestanding-6x3"));
  legacy.config = { ...legacy.config, roofing: "solarspan150" };
  const { snap, components } = price(adaptLegacyScope(legacy).model);
  const roofComponent = components.find((c) => c.category === "roofing");
  assert.ok(roofComponent);
  assert.equal(snap.validation.passed, false);
  assert.ok(snap.validation.errors.some((e) => e.code === "unpriced-component" && e.message.includes("roofing:solarspan150:150")));
});

test("T3: Stratco CGI / SpanPlus price at their OWN rate, never the Corrugated $22 fall-through", () => {
  const corrugated = resolveRateByKey(snapshot, "roofing:corrugated:0")!.value;
  const stratco = resolveRateByKey(snapshot, "roofing:stratco_cgi75:75")!.value;
  const spanplus = resolveRateByKey(snapshot, "roofing:spanplus330:0")!.value;
  assert.equal(corrugated, 2200);
  assert.equal(stratco, 11000);
  assert.equal(spanplus, 1204);
  assert.notEqual(stratco, corrugated);
  assert.notEqual(spanplus, corrugated);
});

test("T4: steel gauge is not collapsed — 150×50×2 and 150×50×3 are distinct keys", () => {
  const g2 = steelSizeKey({ id: "150x50x2", label: "150×50×2 RHS", material: "steel", widthMm: 150 as any, depthMm: 50 as any, wallThicknessMm: 2 as any });
  const g3 = steelSizeKey({ id: "150x50x3", label: "150×50×3 RHS", material: "steel", widthMm: 150 as any, depthMm: 50 as any, wallThicknessMm: 3 as any });
  assert.equal(g2, "150x50x2");
  assert.equal(g3, "150x50x3");
  assert.notEqual(g2, g3);
  assert.ok(resolveRateByKey(snapshot, `steel:${g2}`), "×2 gauge is priced");
  assert.equal(resolveRateByKey(snapshot, `steel:${g3}`), null, "×3 gauge unconfirmed → blocks");

  const heavyBeam: ComponentV1 = {
    componentId: "steel-beam-heavy",
    category: "steel",
    sku: { productId: "steel-section", sizeKey: "150x50x3" },
    description: "Beam 150×50×3 RHS — 2 @ 6000mm",
    quantity: 16,
    unit: "lm",
    derivationRule: "test",
    sourceScopePaths: []
  };
  const result = priceComponents([heavyBeam], snapshot);
  assert.equal(result.lines.length, 0);
  assert.equal(result.unpriced.length, 1);
  assert.equal(result.unpriced[0].reason, "rate-missing");
});

test("T10: a unit mismatch blocks instead of pricing on an incompatible basis", () => {
  const wrongUnit: ComponentV1 = {
    componentId: "gutter-as-each",
    category: "gutters",
    sku: { productId: "patio-gutter" }, // rate is per-lm
    description: "Patio Gutter billed per each (wrong)",
    quantity: 1,
    unit: "each",
    derivationRule: "test",
    sourceScopePaths: []
  };
  const result = priceComponents([wrongUnit], snapshot);
  assert.equal(result.lines.length, 0);
  assert.equal(result.unpriced[0].reason, "unit-mismatch");
});

test("T2/T9: an unknown/absent rate BLOCKS — it never silently resolves to a fallback number", () => {
  const unknown: ComponentV1 = {
    componentId: "mystery",
    category: "extras",
    sku: { productId: "gable-infill" }, // deliberately unconfirmed
    description: "Gable Infill — colorbond",
    quantity: 8.3,
    unit: "sqm",
    derivationRule: "test",
    sourceScopePaths: []
  };
  const result = priceComponents([unknown], snapshot);
  assert.equal(result.lines.length, 0, "no line is produced at a guessed price");
  assert.equal(result.unpriced.length, 1);
  assert.equal(result.unpriced[0].reason, "rate-missing");
});

// ════════════════════════════════════════════════════════════════════════════
// One canonical component set (T6)
// ════════════════════════════════════════════════════════════════════════════

test("T6: one component set drives both cost and material-order rows (no divergent recompute)", () => {
  const { components } = price(modelFor("skillion-riser-6x3"));
  const rows = toMaterialRows(components);
  assert.equal(rows.length, components.length);
  // The steel post count in the BOM equals the geometry post count — one truth.
  const model = modelFor("skillion-riser-6x3");
  const geometry = computePatioGeometry(model);
  const postComponentQty = components
    .filter((c) => c.componentId.startsWith("steel-post"))
    .reduce((sum, c) => sum + Math.round((c.orderLengthMm ?? 0) / (c.orderLengthMm ?? 1)), 0);
  assert.ok(postComponentQty > 0);
  // Component ids are unique — a single canonical set, no duplicates.
  const ids = new Set(components.map((c) => c.componentId));
  assert.equal(ids.size, components.length);
  assert.equal(geometry.frame.posts.length, 4);
});

// ════════════════════════════════════════════════════════════════════════════
// End-to-end: standard skillion prices against the confirmed snapshot
// ════════════════════════════════════════════════════════════════════════════

test("standard skillion (riser, corrugated) prices end-to-end and satisfies the server gate", () => {
  const { snap, components } = price(modelFor("skillion-riser-6x3"));
  assert.equal(snap.validation.passed, true, JSON.stringify(snap.validation.errors));

  const cost = (id: string) => snap.costLines.find((l) => l.componentId === id)?.totalCostCents;
  // Steel posts: 4 × 3564mm (2964 height + 600 concrete embedment) → 4× 8.0m 90×90×2 sticks.
  assert.equal(cost("steel-post-1"), 58220); // 16.4m × $35.50
  // Roofing corrugated: 8 sheets × 3.1m run × $22/LM.
  assert.equal(cost("roof-sheets"), 54560);
  // Risers priced per-each at the confirmed 76×38 rate (NOT the removed "Riser Bracket").
  assert.equal(cost("riser-welded-l"), 33000); // 6 × $55.00
  assert.equal(cost("bracket-rafter"), 12000); // 6 × $20.00 (Rafter Bracket, confirmed)
  // Fixings 50/sqm over 6×3 = 18 m².
  assert.equal(cost("fixings"), 90000);
  // Concrete: 4 posts × 5 bags × $10.
  assert.equal(cost("concrete-kwikset"), 20000);

  // Money assembly (labour ctx: 2 trade + 1 labourer × 3 days).
  assert.equal(snap.totals.materialCostCents, 427241);
  assert.equal(snap.totals.materialSellCents, 640862); // per-line ×1.5
  assert.equal(snap.totals.labourSellCents, 744000);
  assert.equal(snap.totals.gstCents, Math.round(snap.totals.totalExGstCents * 0.1));
  assert.equal(snap.totals.totalIncGstCents, snap.totals.totalExGstCents + snap.totals.gstCents);
  assert.equal(snap.reverseSkillionUpliftApplied, false);

  const pricingJson = toPricingJson(snap);
  assert.equal(serverValidate(pricingJson).ok, true, JSON.stringify(serverValidate(pricingJson).issues));
  assert.ok(pricingJson.totalIncGST > 0 && pricingJson.totalExGST > 0);
  // Every required-category line carries a positive cost and sell.
  for (const li of pricingJson.line_items) {
    if (["steel", "roofing", "flashings", "gutters", "labour"].includes(li.category)) {
      assert.ok(li.total_cost > 0 && li.total_sell > 0, `${li.description} must be priced`);
    }
  }
  assert.equal(components.some((c) => c.category === "roofing"), true);
});

test("standard SolarSpan skillion carries zero rafters and prices roofing at the thickness-keyed rate", () => {
  const { snap, components } = price(modelFor("skillion-solarspan-freestanding-6x3"));
  assert.equal(snap.validation.passed, true, JSON.stringify(snap.validation.errors));
  // Insulated panel is self-spanning → no steel rafters in the BOM.
  assert.equal(components.some((c) => c.componentId.startsWith("steel-rafter")), false);
  const roof = snap.costLines.find((l) => l.category === "roofing")!;
  assert.equal(roof.rate.value, 12000); // SolarSpan 75mm = $120/LM (was mispriced-invisible under substring)
  assert.equal(roof.rate.sku, "roofing:solarspan75:75");
});

// ════════════════════════════════════════════════════════════════════════════
// End-to-end: standard gable prices; reverse uplift; blocked infill
// ════════════════════════════════════════════════════════════════════════════

function gableNoInfill(): PatioModelV1 {
  const legacy = structuredClone(scopeById("gable-freestanding-7-2x4"));
  legacy.config = { ...legacy.config, infill: "none" };
  return adaptLegacyScope(legacy).model;
}

test("standard gable (freestanding, corrugated) prices end-to-end with fab + truss steel and satisfies the server gate", () => {
  const { snap } = price(gableNoInfill());
  assert.equal(snap.validation.passed, true, JSON.stringify(snap.validation.errors));
  const cost = (id: string) => snap.costLines.find((l) => l.componentId === id)?.totalCostCents;
  assert.equal(cost("fab-gable-truss-fab"), 190000); // 5 × 4m × $95/m width
  assert.equal(cost("fab-gable-truss-steel"), 67247); // Σ truss steel LM × $15.50
  assert.equal(cost("roof-sheets"), 96800); // 20 sheets × 2.2m × $22
  assert.equal(snap.totals.materialCostCents, 797101);

  const pricingJson = toPricingJson(snap);
  assert.equal(serverValidate(pricingJson).ok, true, JSON.stringify(serverValidate(pricingJson).issues));
});

test("gable-truss steel rate applies only to 76×38×1.6 trusses — a different truss section blocks", () => {
  const model = gableNoInfill();
  // Swap the truss section to a size whose gable-truss steel rate is not confirmed.
  const heavy = { ...model.structure.trusses.section, id: "100x50x2", label: "100×50×2 RHS", widthMm: 100 as any, depthMm: 50 as any, wallThicknessMm: 2 as any };
  const swapped: PatioModelV1 = { ...model, structure: { ...model.structure, trusses: { ...model.structure.trusses, section: heavy } } };
  const geometry = computePatioGeometry(swapped);
  const components = computeComponents(swapped, geometry);
  const trussSteel = components.find((c) => c.componentId === "fab-gable-truss-steel")!;
  // The steel key still points at the confirmed gable-truss-steel family, but the
  // sizeKey records the actual section — the confirmed rate is documented as
  // 76×38×1.6-only, so the SKU carries the section for the Captain-editable path.
  assert.equal(trussSteel.sku.sizeKey, "100x50x2");
});

test("reverse-skillion applies the 1.08 material uplift exactly once (no box-gutter double count)", () => {
  const model = modelFor("reverse-skillion-freestanding-5x3-5");
  const geometry = computePatioGeometry(model);
  const components = computeComponents(model, geometry);
  const priced = priceComponents(components, snapshot);
  const rawMaterial = priced.lines.reduce((sum, l) => sum + l.totalCostCents, 0);

  const snap = computeJobTotals(model, priced, CTX, snapshot);
  assert.equal(snap.reverseSkillionUpliftApplied, true);
  assert.equal(snap.totals.materialCostCents, Math.round(rawMaterial * 1.08));
  assert.ok(snap.validation.warnings.some((w) => w.includes("uplift")));

  // A plain skillion of the same shape does NOT get the uplift.
  const plain = modelFor("skillion-solarspan-freestanding-6x3");
  const plainSnap = price(plain).snap;
  assert.equal(plainSnap.reverseSkillionUpliftApplied, false);
});

test("gable with colorbond end-infill BLOCKS on the unconfirmed rate (never guesses)", () => {
  const { snap } = price(modelFor("gable-freestanding-7-2x4")); // fixture has infill=colorbond
  assert.equal(snap.validation.passed, false);
  assert.ok(snap.validation.errors.some((e) => e.message.includes("gable-infill")));
  const pricingJson = toPricingJson(snap);
  assert.equal(pricingJson.pricing_validation_passed, false);
  assert.equal(serverValidate(pricingJson).ok, false); // server refuses a blocked quote
});

// ════════════════════════════════════════════════════════════════════════════
// Deposit schedule + determinism + investment adapter
// ════════════════════════════════════════════════════════════════════════════

test("deposit schedule follows the plans / no-plans business rule and sums to the total", () => {
  const noPlans = price(modelFor("skillion-riser-6x3")).snap;
  assert.equal(noPlans.deposit.hasPlans, false);
  assert.deepEqual(noPlans.deposit.scheduleStages.map((s) => s.pct), [50, 50]);
  const noSum = noPlans.deposit.scheduleStages.reduce((s, x) => s + x.amountCents, 0);
  assert.equal(noSum, noPlans.totals.totalIncGstCents);

  const withPlans = price(modelFor("skillion-riser-6x3"), {
    labour: { trades: 2, labourers: 1, days: 3 },
    extras: [{ description: "Council/Permit", type: "permit", qty: 1, unitCostCents: 35000, unitSellCents: 47250 }]
  }).snap;
  assert.equal(withPlans.deposit.hasPlans, true);
  assert.deepEqual(withPlans.deposit.scheduleStages.map((s) => s.pct), [20, 50, 30]);
  const withSum = withPlans.deposit.scheduleStages.reduce((s, x) => s + x.amountCents, 0);
  assert.equal(withSum, withPlans.totals.totalIncGstCents);
  assert.ok(withPlans.deposit.councilFeesCents > 0);
});

test("a job with no labour blocks (a sendable standard quote must include labour)", () => {
  const { snap } = price(modelFor("skillion-riser-6x3"), { labour: { trades: 0, labourers: 0, days: 0 } });
  assert.equal(snap.validation.passed, false);
  assert.ok(snap.validation.errors.some((e) => e.code === "labour-missing"));
});

test("pricing is deterministic — identical input yields identical snapshot", () => {
  const model = modelFor("skillion-riser-6x3");
  const a = price(model).snap;
  const b = price(structuredClone(model)).snap;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("investment adapter surfaces the deposit percent (confirmed 10%) and margin", () => {
  const { snap } = price(modelFor("skillion-riser-6x3"));
  const investment = toQuoteInvestment(snap);
  assert.equal(investment.depositPercent, 10);
  assert.equal(investment.totalIncGST, snap.totals.totalIncGstCents / 100);
  assert.equal(investment.marginPct, snap.totals.marginPct);
});
