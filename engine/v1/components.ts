// Patio rebuild — Phase 1 canonical component set (P1.1 computeComponents).
//
// ONE canonical ComponentV1[] BOM derived once from the typed geometry. This
// kills the three-parallel-quantity-pipeline problem (trap T6): the geometry
// frame is the single truth for member counts; steel is billed via the real
// nesting/waste rule (stock length × $/LM), computed once from the canonical
// member set. No DOM round-trip, no divergent recompute.
//
// Quantity rules mirror the correct model in report §1.1. Insulated panels are
// self-spanning → 0 rafters (already enforced by the geometry engine).

import {
  DEFAULT_BUILD_POLICY,
  type BuildPolicyV1,
  type ComponentCategory,
  type ComponentUnit,
  type ComponentV1,
  type SkuRefV1
} from "./pricing-model.ts";
import type { PatioModelV1, StructuralSectionV1 } from "./patio-model.ts";
import type { PatioGeometryV1, StructuralMemberGeometryV1 } from "./geometry.ts";

// Per-size stock lengths (mm), invoice-verified — mirror of the legacy
// STEEL_STOCK_LENGTHS_BY_SIZE, re-keyed to the canonical "WxDxG" section key.
const STEEL_STOCK_LENGTHS: Record<string, number[]> = {
  "50x25x1.6": [6500, 8000],
  "65x35x2": [6500, 8000],
  "75x35x2": [6500, 8000],
  "76x38x1.6": [3000, 4000, 6100, 7300, 8000],
  "75x50x2": [8000],
  "100x50x2": [5500, 6500, 8000],
  "150x50x2": [5500, 6500, 8000],
  "150x50x3": [8000],
  "125x50x2": [6500, 8000],
  "90x90x2": [3100, 4100, 6200, 8000],
  "65x65x2": [6500, 8000],
  "75x75x2": [6500, 8000],
  "100x100x2": [6500, 8000],
  "125x125x3": [6500, 8000],
  "150x150x3": [6500, 8000]
};

const DEFAULT_STOCK_LENGTHS = [6500, 8000];

function stockLengthsFor(sizeKey: string): number[] {
  return STEEL_STOCK_LENGTHS[sizeKey] ?? DEFAULT_STOCK_LENGTHS;
}

/** Canonical steel section key "WxDxG" — carries the gauge, so 150×50×2 and
 * 150×50×3 are distinct keys (kills trap T4 — gauge collapse). */
export function steelSizeKey(section: StructuralSectionV1): string {
  return `${section.widthMm}x${section.depthMm}x${section.wallThicknessMm}`;
}

/** Riser size key "WxD" (gauge-agnostic) — matches the confirmed Riser rows. */
export function riserSizeKey(section: StructuralSectionV1): string {
  return `${section.widthMm}x${section.depthMm}`;
}

interface NestResult {
  totalStockMm: number;
  totalSticks: number;
  stockLengthMm: number;
  piecesPerStick: number;
  specialOrder: boolean;
}

/**
 * Pack `qty` pieces of `cutLengthMm` into stock sticks and return the total
 * billed stock length. Faithful port of the legacy nestCuts()/calculateStockRequired
 * billing: cost is charged on the chosen stock length, not the cut length —
 * waste is a real supplier cost billed to the job.
 */
function nestGroup(
  cutLengthMm: number,
  qty: number,
  stockLengths: number[],
  onePerStick: boolean,
  sawKerfMm: number
): NestResult {
  const sorted = [...stockLengths].sort((a, b) => a - b);
  const maxStock = sorted[sorted.length - 1];

  // Oversize: no single stock fits one piece. Bill ceil(len/maxStock) max sticks
  // per piece (mirrors legacy calculateStockRequired for special-order members).
  if (cutLengthMm > maxStock) {
    const sticksPerPiece = Math.ceil(cutLengthMm / maxStock);
    return {
      totalStockMm: sticksPerPiece * maxStock * qty,
      totalSticks: sticksPerPiece * qty,
      stockLengthMm: maxStock,
      piecesPerStick: 1,
      specialOrder: true
    };
  }

  let bestStock = maxStock;
  for (const stock of sorted) {
    if (stock >= cutLengthMm) {
      bestStock = stock;
      break;
    }
  }

  if (onePerStick) {
    return { totalStockMm: bestStock * qty, totalSticks: qty, stockLengthMm: bestStock, piecesPerStick: 1, specialOrder: false };
  }

  const piecesFor = (stock: number): number => {
    let pieces = 0;
    let used = 0;
    while (used + cutLengthMm <= stock) {
      pieces += 1;
      used += cutLengthMm + sawKerfMm;
    }
    return Math.max(1, pieces);
  };

  let piecesPerStick = piecesFor(bestStock);
  for (let li = sorted.indexOf(bestStock) + 1; li < sorted.length; li += 1) {
    const bigPieces = piecesFor(sorted[li]);
    if (Math.ceil(qty / bigPieces) < Math.ceil(qty / piecesPerStick)) {
      bestStock = sorted[li];
      piecesPerStick = bigPieces;
    }
  }

  const totalSticks = Math.ceil(qty / piecesPerStick);
  return { totalStockMm: bestStock * totalSticks, totalSticks, stockLengthMm: bestStock, piecesPerStick, specialOrder: false };
}

interface SteelGroup {
  sizeKey: string;
  section: StructuralSectionV1;
  cutLengthMm: number;
  quantity: number;
}

/** Group members of one class by (section, rounded cut length). */
function groupSteel(
  members: StructuralMemberGeometryV1[],
  cutLengthOf: (member: StructuralMemberGeometryV1) => number
): SteelGroup[] {
  const groups = new Map<string, SteelGroup>();
  for (const memberItem of members) {
    const sizeKey = steelSizeKey(memberItem.section);
    const cutLengthMm = Math.round(cutLengthOf(memberItem));
    const key = `${sizeKey}@${cutLengthMm}`;
    const existing = groups.get(key);
    if (existing) existing.quantity += 1;
    else groups.set(key, { sizeKey, section: memberItem.section, cutLengthMm, quantity: 1 });
  }
  return [...groups.values()];
}

function metres(mm: number): number {
  return Math.round(mm) / 1000;
}

/** Round a derived quantity to 3 dp (µm/mm precision) for clean, stable JSON. */
function q3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function pushSteelGroups(
  out: ComponentV1[],
  idPrefix: string,
  roleLabel: string,
  groups: SteelGroup[],
  onePerStick: boolean,
  policy: BuildPolicyV1,
  sourceScopePaths: string[]
): void {
  groups.forEach((group, index) => {
    const nest = nestGroup(group.cutLengthMm, group.quantity, stockLengthsFor(group.sizeKey), onePerStick, policy.sawKerfMm);
    const stockLabel = nest.specialOrder
      ? `${nest.totalSticks}× special-order`
      : `${nest.totalSticks}× ${metres(nest.stockLengthMm)}m stick${nest.totalSticks === 1 ? "" : "s"}`;
    out.push({
      componentId: `${idPrefix}-${index + 1}`,
      category: "steel",
      sku: { productId: "steel-section", sizeKey: group.sizeKey },
      description: `${roleLabel} ${group.section.label} — ${group.quantity} @ ${group.cutLengthMm}mm`,
      quantity: metres(nest.totalStockMm),
      unit: "lm",
      cutLengthMm: group.cutLengthMm,
      orderLengthMm: nest.totalStockMm,
      derivationRule: `${group.quantity}× ${group.cutLengthMm}mm nested into ${stockLabel} (stock × $/LM)`,
      sourceScopePaths
    });
  });
}

interface SimpleExtra {
  sku?: Partial<SkuRefV1>;
  colour?: string;
}

function simple(
  componentId: string,
  category: ComponentCategory,
  productId: string,
  description: string,
  quantity: number,
  unit: ComponentUnit,
  derivationRule: string,
  sourceScopePaths: string[],
  extra: SimpleExtra = {}
): ComponentV1 {
  return {
    componentId,
    category,
    sku: { productId, ...(extra.sku ?? {}) },
    description,
    quantity,
    unit,
    derivationRule,
    sourceScopePaths,
    ...(extra.colour !== undefined ? { colour: extra.colour } : {})
  };
}

function frontRowPostCount(geometry: PatioGeometryV1): number {
  return geometry.frame.posts.filter((post) => post.role === "front-row").length;
}

/**
 * The single canonical BOM. Pure: no DOM, network or clock. One count per
 * component, taken from the geometry frame. Steel waste is billed once via the
 * nesting rule; non-structural derivations (sheets, flashings, gutters,
 * downpipes, fixings, concrete, risers, brackets, gable-truss) roll into the
 * same set.
 */
export function computeComponents(
  model: PatioModelV1,
  geometry: PatioGeometryV1,
  policy: BuildPolicyV1 = DEFAULT_BUILD_POLICY
): ComponentV1[] {
  const components: ComponentV1[] = [];
  const lengthM = metres(model.footprint.lengthMm);
  const joinM = metres(policy.runJoinAllowanceMm);

  // ── Posts ── billed cut = above-ground member height + concrete embedment.
  const concrete = model.structure.posts.fixing === "concrete";
  const embedment = concrete ? policy.postConcreteEmbedmentMm : 0;
  pushSteelGroups(
    components,
    "steel-post",
    "Posts",
    groupSteel(geometry.frame.posts, (post) => post.lengthMm + embedment),
    true,
    policy,
    ["structure.posts", "structure.postHeightMm", "structure.posts.fixing"]
  );

  // ── Perimeter beams (front / back / fascia) — one member each from geometry. ──
  pushSteelGroups(
    components,
    "steel-beam",
    "Beam",
    groupSteel(geometry.frame.beams, (beam) => beam.lengthMm),
    true,
    policy,
    ["structure.beams", "attachment.type"]
  );

  // ── Tie beams (end-tie horizontals) — present only when enabled. ──
  const tieBeams = geometry.frame.attachmentMembers.filter((memberItem) => memberItem.kind === "tie-beam");
  if (tieBeams.length) {
    pushSteelGroups(components, "steel-tiebeam", "Tie Beam", groupSteel(tieBeams, (m) => m.lengthMm), true, policy, ["structure.tieBeams"]);
  }

  // ── Rafters (skillion only; 0 for insulated panels) ── combine per stock. ──
  if (geometry.frame.rafters.length) {
    pushSteelGroups(
      components,
      "steel-rafter",
      "Rafters",
      groupSteel(geometry.frame.rafters, (rafter) => rafter.lengthMm),
      false,
      policy,
      ["structure.rafters", "roofing.material"]
    );
  }

  // ── Purlins / battens ── combine per stock; run length = patio length. ──
  if (geometry.frame.purlins.length) {
    pushSteelGroups(
      components,
      "steel-purlin",
      model.roof.type === "gable" ? "Purlins" : "Battens",
      groupSteel(geometry.frame.purlins, () => model.footprint.lengthMm),
      false,
      policy,
      ["structure.purlins"]
    );
  }

  // ── Gable trusses ── fabrication ($/m width) + truss steel ($/LM, 76×38 only). ──
  if (model.roof.type === "gable" && geometry.metrics.trussCount > 0) {
    const trussCount = geometry.metrics.trussCount;
    const trussWidthM = metres(model.footprint.projectionMm); // chord width = span (lengthways)
    const fabWidthM = trussWidthM * trussCount;
    components.push(simple(
      "fab-gable-truss-fab",
      "fabrication",
      "gable-truss-fab",
      `Gable Truss Fabrication — ${trussCount} × ${trussWidthM}m width`,
      fabWidthM,
      "lm",
      `fab = trussCount(${trussCount}) × width(${trussWidthM}m) × $/m`,
      ["structure.trusses.quantity", "footprint.projectionMm"]
    ));
    // Truss steel LM = Σ truss-rafter + truss-chord + truss-web member lengths
    // (2·rafter + chord(width) + webs per truss). Excludes the shared ridge.
    const trussSteelMm = geometry.frame.trussMembers
      .filter((memberItem) => memberItem.kind !== "ridge")
      .reduce((sum, memberItem) => sum + memberItem.lengthMm, 0);
    const trussSection = model.structure.trusses.section;
    components.push(simple(
      "fab-gable-truss-steel",
      "fabrication",
      "gable-truss-steel",
      `Gable Truss Steel — ${metres(trussSteelMm)}m (${trussSection.label})`,
      metres(trussSteelMm),
      "lm",
      "truss steel = Σ(truss rafters + chord + webs); rate applies to 76×38×1.6 RHS trusses only",
      ["structure.trusses.section"],
      { sku: { sizeKey: steelSizeKey(trussSection) } }
    ));
  }

  // ── Risers (welded-L elbows) + rafter brackets — riser attachment only. ──
  if (model.attachment.type === "riser") {
    const riserCount = model.attachment.riserQuantity;
    const riserSection = model.attachment.riserSection;
    components.push(simple(
      "riser-welded-l",
      "steel",
      "riser",
      `Risers (Welded L) ${riserSection.label} — ${riserCount}`,
      riserCount,
      "each",
      `riserQuantity=${riserCount} (welded-L, priced per each)`,
      ["attachment.riserQuantity", "attachment.riserSection"],
      { sku: { sizeKey: riserSizeKey(riserSection) } }
    ));
    components.push(simple(
      "bracket-rafter",
      "fabrication",
      "rafter-bracket",
      `Rafter Brackets (Galv) — ${riserCount}`,
      riserCount,
      "each",
      `1 rafter bracket per riser (riserQuantity=${riserCount})`,
      ["attachment.riserQuantity"]
    ));
  }

  // ── Tubing brackets (external/internal batten brackets) ── only when battens
  // present AND an external frame requires them. Standard insulated jobs: none.
  // (Bracket count is a render detail; kept out of the standard priced set until
  // its geometry is modelled — noted so it is not silently assumed present.)

  // ── Roof sheets ── priced $/LM of sheet run; gable already ×2 planes via totalSheets.
  const totalSheets = geometry.metrics.totalSheets;
  if (totalSheets > 0 && model.jobType !== "frame-only" && model.jobType !== "quote-only") {
    const sheetRunM = Math.ceil((geometry.metrics.rafterLengthMm + policy.sheetLengthOverageMm) / 100) * 100 / 1000;
    components.push(simple(
      "roof-sheets",
      "roofing",
      "roofing",
      `Roof Sheets ${model.roofing.profile} — ${totalSheets} @ ${sheetRunM}m`,
      q3(totalSheets * sheetRunM),
      "lm",
      `sheets=${totalSheets} × run(${sheetRunM}m) × $/LM`,
      ["roofing.productId", "roofing.panelThicknessMm", "roofing.coverWidthMm"],
      {
        colour: model.finishes.sheetColour,
        sku: { profile: model.roofing.productId, thicknessMm: model.roofing.panelThicknessMm }
      }
    ));
  }

  // ── Flashings (auto) ──
  if (model.drainage.includeFlashings) {
    const rafterM = metres(geometry.metrics.rafterLengthMm);
    if (model.roof.type === "gable") {
      components.push(simple(
        "flash-ridge",
        "flashings",
        "ridge-cap",
        "Ridge Cap",
        lengthM,
        "lm",
        "ridge runs the patio length (1 run)",
        ["roof.type", "drainage.includeFlashings"],
        { colour: model.finishes.flashingColour }
      ));
      components.push(simple(
        "flash-gable-barge",
        "flashings",
        "barge-flashing",
        "Gable Barges — 4",
        q3(4 * (rafterM + joinM)),
        "lm",
        "gable barge ×4 (both ends × both slopes), each = rafterLen + join",
        ["roof.type", "drainage.includeFlashings"],
        { colour: model.finishes.flashingColour }
      ));
    } else {
      components.push(simple(
        "flash-barge",
        "flashings",
        "barge-flashing",
        "Barge Flashings — 2",
        q3(2 * (rafterM + joinM)),
        "lm",
        "skillion barge ×2 (both rakes), each = rafterLen + join",
        ["roof.type", "drainage.includeFlashings"],
        { colour: model.finishes.flashingColour }
      ));
      // Back flashing — skipped for riser + box gutter (box gutter replaces it).
      const suppressBack = model.attachment.type === "riser" && model.drainage.houseGutter === "box";
      if (!suppressBack) {
        components.push(simple(
          "flash-back",
          "flashings",
          "back-flashing",
          "Back Flashing — 1",
          lengthM + joinM,
          "lm",
          "back flashing ×1 = patio length + join",
          ["attachment.type", "drainage.houseGutter", "drainage.includeFlashings"],
          { colour: model.finishes.flashingColour }
        ));
      }
    }
  }

  // ── Gutters ──
  // Phase-1 boundary: gutters and downpipes are priced as supply-complete $/LM
  // lines at the Captain-confirmed rates (Patio Gutter, Box Gutter, Downpipe
  // 95×45). The legacy fine-grained drainage-accessory kit (stop-ends, clips,
  // outlets, pops) is a 2026-06-13 refinement whose per-item rates are NOT in
  // the confirmed 2026-08-10 standard set, so it is intentionally not itemised
  // here (it is not silently guessed). Adding it back is a follow-on once those
  // accessory rates are confirmed and added to the snapshot.
  if (model.drainage.includeGutters) {
    components.push(simple(
      "gutter-patio",
      "gutters",
      "patio-gutter",
      "Patio Gutter — 1",
      lengthM + joinM,
      "lm",
      "patio (front) gutter ×1 = patio length + join",
      ["drainage.includeGutters"],
      { colour: model.finishes.flashingColour }
    ));
    if (model.attachment.type === "riser" && model.drainage.houseGutter === "box") {
      components.push(simple(
        "gutter-box",
        "gutters",
        "box-gutter",
        "Box Gutter — 1",
        lengthM + joinM,
        "lm",
        "box gutter at house (riser + box) ×1 = patio length + join",
        ["drainage.houseGutter"],
        { colour: model.finishes.flashingColour }
      ));
    }
  }

  // ── Downpipes ── each run = 2 (or 3 if tall) × 1.8m sticks, priced $/LM.
  if (model.drainage.includeDownpipes) {
    const frontPosts = frontRowPostCount(geometry);
    const dpCount = model.drainage.downpipePostIndices.length > 0
      ? model.drainage.downpipePostIndices.length
      : (frontPosts >= 3 ? 2 : 1);
    const sticksPerRun = model.structure.postHeightMm > 3500 ? 3 : 2;
    components.push(simple(
      "downpipes",
      "downpipes",
      "downpipe-95x45",
      `Downpipes 95×45mm — ${dpCount} run${dpCount === 1 ? "" : "s"} (${sticksPerRun}×1.8m each)`,
      dpCount * sticksPerRun * 1.8,
      "lm",
      `dpCount=${dpCount} × ${sticksPerRun} sticks × 1.8m`,
      ["drainage.includeDownpipes", "drainage.downpipePostIndices"],
      { colour: model.finishes.flashingColour }
    ));
  }

  // ── Fixings ── area-based (screws, anchors, silicone, foam).
  const areaSqm = lengthM * metres(model.footprint.projectionMm);
  components.push(simple(
    "fixings",
    "fixings",
    "fixings",
    "Fixings (screws, anchors, silicone, foam)",
    Math.round(areaSqm * 10) / 10,
    "sqm",
    "fixings = length(m) × projection(m) × $/sqm",
    ["footprint.lengthMm", "footprint.projectionMm"]
  ));

  // ── Concrete footings (Kwikset bags) — concrete-fixed posts only. ──
  if (concrete) {
    const bags = geometry.frame.posts.length * policy.concreteBagsPerPost;
    components.push(simple(
      "concrete-kwikset",
      "fabrication",
      "concrete-kwikset",
      `Kwikset Concrete — ${bags} bags`,
      bags,
      "bag",
      `${geometry.frame.posts.length} posts × ${policy.concreteBagsPerPost} bags/post`,
      ["structure.posts.fixing"]
    ));
  }

  // ── Gable-end infill ── unconfirmed rate (blocks) — emitted only when selected.
  if (model.roof.type === "gable" && model.infill.gable !== "none") {
    const infillArea = metres(geometry.metrics.rafterLengthMm) * metres(model.footprint.projectionMm);
    components.push(simple(
      "gable-infill",
      "extras",
      "gable-infill",
      `Gable Infill — ${model.infill.gable}`,
      Math.round(infillArea * 10) / 10,
      "sqm",
      "gable-end infill — rate unconfirmed (blocks until set)",
      ["infill.gable"]
    ));
  }

  return components;
}
