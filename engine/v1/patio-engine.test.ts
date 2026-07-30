import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  deriveStructuredJobScope,
  parsePatioModel,
  validatePatioModel,
  type PatioModelV1
} from "./patio-model.ts";
import { computePatioGeometry, type PatioGeometryV1 } from "./geometry.ts";
import {
  adaptLegacyScope,
  compareLegacyScope,
  computeLegacyGeometryReference,
  type LegacyScopeV18
} from "./shadow-comparison.ts";

type GoldenExpected = {
  roofType: string;
  lengthMm: number;
  projectionMm: number;
  frontBeamBottomMm: number;
  backBeamBottomMm: number;
  fasciaBeamBottomMm: number | null;
  verticalRiseMm: number;
  ridgeHeightMm?: number;
  postCount: number;
  postPositionsMm: number[];
  rafterCount: number;
  purlinCount: number;
  trussCount: number;
  trussMemberCount?: number;
  roofPlaneCount: number;
  sheetsPerPlane: number;
  totalSheets: number;
  partialSheetWidthMm: number;
};

type GoldenCase = { id: string; legacyScope: LegacyScopeV18; expected: GoldenExpected };

const fixturePath = fileURLToPath(new URL("./fixtures/golden-cases.json", import.meta.url));
const goldenCases = JSON.parse(readFileSync(fixturePath, "utf8")) as GoldenCase[];
const byId = (id: string): GoldenCase => {
  const fixture = goldenCases.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Missing fixture ${id}`);
  return fixture;
};
const modelFor = (id: string): PatioModelV1 => adaptLegacyScope(byId(id).legacyScope).model;

function geometryHash(geometry: PatioGeometryV1): string {
  return createHash("sha256").update(JSON.stringify(geometry)).digest("hex");
}

function assertMemberLengths(geometry: PatioGeometryV1): void {
  const members = [
    ...geometry.frame.posts,
    ...geometry.frame.beams,
    ...geometry.frame.rafters,
    ...geometry.frame.purlins,
    ...geometry.frame.trussMembers,
    ...geometry.frame.attachmentMembers
  ];
  for (const current of members) {
    const actual = Math.round(Math.hypot(
      current.endMm.xMm - current.startMm.xMm,
      current.endMm.yMm - current.startMm.yMm,
      current.endMm.zMm - current.startMm.zMm
    ) * 1000) / 1000;
    assert.equal(current.lengthMm, actual, `${current.id} has a stale length`);
  }
}

test("legacy boundary creates valid canonical mm models", () => {
  for (const fixture of goldenCases) {
    const result = adaptLegacyScope(fixture.legacyScope);
    assert.deepEqual(validatePatioModel(result.model), { valid: true, errors: [] });
    assert.equal(result.model.units, "mm");
    assert.equal(typeof result.model.footprint.lengthMm, "number");
    assert.equal(typeof result.model.footprint.projectionMm, "number");
    assert.equal(typeof result.model.structure.postHeightMm, "number");
  }
});

test("canonical validation rejects UI metre strings instead of coercing them", () => {
  const source = modelFor("skillion-riser-6x3");
  const invalid = structuredClone(source) as unknown as Record<string, unknown>;
  (invalid.footprint as Record<string, unknown>).lengthMm = "6.0";
  const result = validatePatioModel(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("footprint.lengthMm must be an integer millimetre value"));
  assert.throws(() => parsePatioModel(invalid), /Invalid PatioModelV1/);
});

test("structured job_scope derives dimensions from canonical mm values", () => {
  const model = modelFor("skillion-riser-6x3");
  const jobScope = deriveStructuredJobScope(model);
  assert.deepEqual(jobScope, {
    schema_version: "patio-model/v1",
    scope_id: "GOLDEN-SK-001",
    option_id: null,
    shape: "rectangle",
    length_mm: 6000,
    projection_mm: 3000,
    post_height_mm: 2400,
    fascia_height_mm: 2700,
    riser_height_mm: 400,
    riser_offset_mm: 150,
    roof_type: "skillion",
    roof_orientation: null,
    roof_pitch_deg: 5,
    attachment_method: "riser",
    post_count: 4,
    frame_material: "steel",
    roofing_product_id: "corrugated",
    roofing_cover_width_mm: 762,
    roofing_panel_thickness_mm: 0,
    steel_colour: "Monument",
    sheet_colour: "Surfmist",
    flashing_colour: "Surfmist"
  });
});

for (const fixture of goldenCases) {
  test(`golden geometry: ${fixture.id}`, () => {
    const model = adaptLegacyScope(fixture.legacyScope).model;
    const geometry = computePatioGeometry(model);
    const expected = fixture.expected;
    assert.equal(geometry.metrics.roofType, expected.roofType);
    assert.equal(geometry.metrics.lengthMm, expected.lengthMm);
    assert.equal(geometry.metrics.projectionMm, expected.projectionMm);
    assert.equal(geometry.metrics.frontBeamBottomMm, expected.frontBeamBottomMm);
    assert.equal(geometry.metrics.backBeamBottomMm, expected.backBeamBottomMm);
    assert.equal(geometry.metrics.fasciaBeamBottomMm, expected.fasciaBeamBottomMm);
    assert.equal(geometry.metrics.verticalRiseMm, expected.verticalRiseMm);
    if (expected.ridgeHeightMm !== undefined) assert.equal(geometry.metrics.ridgeHeightMm, expected.ridgeHeightMm);
    assert.equal(geometry.frame.posts.length, expected.postCount);
    assert.deepEqual(
      geometry.frame.posts.filter((post) => post.role === "front-row").map((post) => post.startMm.xMm),
      expected.postPositionsMm
    );
    assert.equal(geometry.frame.rafters.length, expected.rafterCount);
    assert.equal(geometry.frame.purlins.length, expected.purlinCount);
    assert.equal(geometry.metrics.trussCount, expected.trussCount);
    if (expected.trussMemberCount !== undefined) assert.equal(geometry.frame.trussMembers.length, expected.trussMemberCount);
    assert.equal(geometry.roofPlanes.length, expected.roofPlaneCount);
    assert.equal(geometry.metrics.sheetsPerPlane, expected.sheetsPerPlane);
    assert.equal(geometry.metrics.totalSheets, expected.totalSheets);
    geometry.roofPlanes.forEach((plane) => assert.equal(plane.partialSheetWidthMm, expected.partialSheetWidthMm));
    assertMemberLengths(geometry);
  });
}

test("skillion and reverse skillion have opposite deterministic falls", () => {
  const skillion = computePatioGeometry(modelFor("skillion-riser-6x3"));
  const reverse = computePatioGeometry(modelFor("reverse-skillion-freestanding-5x3-5"));
  assert.ok(skillion.keyPoints.roofBackLeft.yMm > skillion.keyPoints.roofFrontLeft.yMm);
  assert.equal(skillion.roofPlanes[0].drainageEdge, "front");
  assert.ok(reverse.keyPoints.roofBackLeft.yMm < reverse.keyPoints.roofFrontLeft.yMm);
  assert.equal(reverse.roofPlanes[0].drainageEdge, "back");
});

test("gable projection ridge is produced from the same fixed coordinate system", () => {
  const fixture = structuredClone(byId("gable-freestanding-7-2x4").legacyScope);
  fixture.config = { ...fixture.config, orientation: "perpendicular" };
  const report = compareLegacyScope(fixture);
  assert.equal(report.parity, true, JSON.stringify(report.differences));
  assert.deepEqual(report.geometry.keyPoints.ridgeStart, { xMm: 3600, yMm: 3514.617, zMm: 0 });
  assert.deepEqual(report.geometry.keyPoints.ridgeEnd, { xMm: 3600, yMm: 3514.617, zMm: 4000 });
  assert.deepEqual(report.geometry.roofPlanes.map((plane) => plane.drainageEdge), ["left", "right"]);
});

test("gable eave overhang continues both roof planes at the specified pitch", () => {
  const model = modelFor("gable-freestanding-7-2x4");
  if (model.roof.type !== "gable") throw new Error("fixture must be gable");
  model.roof.eaveOverhangMm = 300;
  const geometry = computePatioGeometry(model);
  assert.deepEqual(geometry.roofPlanes[0].verticesMm[0], { xMm: 0, yMm: 2469.615, zMm: -300 });
  assert.deepEqual(geometry.roofPlanes[1].verticesMm[2], { xMm: 7200, yMm: 2469.615, zMm: 4300 });
  assert.equal(geometry.roofPlanes[0].sheetRunLengthMm, 2381.135);
});

test("partial and frame-only jobs expose deterministic sheet coverage without changing the frame", () => {
  const partial = modelFor("skillion-riser-6x3");
  partial.jobType = "partial-sheet";
  partial.roofing.coverage = { fraction: 0.5, openSide: "left" };
  const partialGeometry = computePatioGeometry(partial);
  assert.equal(partialGeometry.metrics.sheetsPerPlane, 4);
  assert.equal(partialGeometry.roofPlanes[0].partialSheetWidthMm, 714);
  assert.equal(partialGeometry.roofPlanes[0].sheetCoverageAxis, "x");
  assert.equal(partialGeometry.roofPlanes[0].sheetCoverageStartMm, 3000);
  assert.equal(partialGeometry.roofPlanes[0].sheetCoverageEndMm, 6000);

  const frameOnly = structuredClone(partial);
  frameOnly.jobType = "frame-only";
  frameOnly.roofing.coverage = { fraction: 1, openSide: "right" };
  const frameGeometry = computePatioGeometry(frameOnly);
  assert.equal(frameGeometry.metrics.totalSheets, 0);
  assert.equal(frameGeometry.frame.beams.length, partialGeometry.frame.beams.length);
  assert.equal(frameGeometry.frame.posts.length, partialGeometry.frame.posts.length);

  const legacyPartial = structuredClone(byId("skillion-riser-6x3").legacyScope);
  legacyPartial.config = {
    ...legacyPartial.config,
    jobType: "partial_sheet",
    partialSheetCoverage: "50",
    partialSheetOpenSide: "left"
  };
  const report = compareLegacyScope(legacyPartial);
  assert.equal(report.parity, false);
  assert.match(report.warnings[0], /covered roof range/);
  assert.deepEqual(report.differences.map((difference) => difference.path), ["sheetsPerPlane", "totalSheets"]);
});

test("wall, fascia and flyover attachment heights are deterministic", () => {
  const source = modelFor("skillion-riser-6x3");
  const wall = structuredClone(source);
  wall.attachment = { type: "wall", wallHeightMm: 2800 };
  const wallGeometry = computePatioGeometry(wall);
  assert.equal(wallGeometry.metrics.backBeamBottomMm, 2800);
  assert.equal(wallGeometry.metrics.frontBeamBottomMm, 2537.534);

  const fascia = structuredClone(source);
  fascia.attachment = { type: "fascia", fasciaHeightMm: 2700, bracketQuantity: 4 };
  const fasciaGeometry = computePatioGeometry(fascia);
  assert.equal(fasciaGeometry.metrics.fasciaBeamBottomMm, 2545);
  assert.equal(fasciaGeometry.metrics.backBeamBottomMm, 2545);

  const flyover = structuredClone(source);
  flyover.attachment = {
    type: "flyover",
    fasciaHeightMm: 2700,
    houseRoofPitchDeg: 15,
    houseRoofDepthMm: 1500,
    setbackMm: 600,
    clearanceMm: 150
  };
  const first = computePatioGeometry(flyover);
  const second = computePatioGeometry(flyover);
  assert.deepEqual(first, second);
  assert.equal(first.metrics.backBeamBottomMm, 3010.77);
});

test("same canonical input produces byte-identical versioned output", () => {
  const expectedHashes: Record<string, string> = {
    "skillion-riser-6x3": "34e1518bfeb1067b2f3b286e882e02057016584780531541683649a13d86052f",
    "reverse-skillion-freestanding-5x3-5": "1145d797462f565b6361de15ddc99cb8110609bb66c1d7dd4b492fc4fb810f70",
    "gable-freestanding-7-2x4": "89e406979fbe495eb1c3a0a66100ec87698c11d6eea0256a5bf7e5870d792bbb"
  };
  for (const fixture of goldenCases) {
    const model = adaptLegacyScope(fixture.legacyScope).model;
    const first = computePatioGeometry(model);
    const second = computePatioGeometry(structuredClone(model));
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(geometryHash(first), expectedHashes[fixture.id]);
  }
});

test("shadow comparison proves parity for all launch goldens", () => {
  for (const fixture of goldenCases) {
    const report = compareLegacyScope(fixture.legacyScope);
    assert.equal(report.supported, true);
    assert.equal(report.parity, true, `${fixture.id}: ${JSON.stringify(report.differences)}`);
    assert.deepEqual(report.differences, []);
    assert.ok(report.comparisons >= 17);
  }
});

test("shadow comparison itemises a deliberate legacy difference", () => {
  const fixture = byId("skillion-riser-6x3");
  const report = compareLegacyScope(fixture.legacyScope, {
    legacyComputation(scope) {
      const legacy = computeLegacyGeometryReference(scope);
      return { ...legacy, frontBeamBottomMm: legacy.frontBeamBottomMm - 25 };
    }
  });
  assert.equal(report.parity, false);
  assert.deepEqual(report.differences, [{
    path: "frontBeamBottomMm",
    legacy: 2938.534,
    canonical: 2963.534,
    delta: 25,
    tolerance: 0.001
  }]);
});

test("advanced shapes and hip remain explicitly outside v1", () => {
  const hip = structuredClone(byId("skillion-riser-6x3").legacyScope);
  hip.config = { ...hip.config, roofStyle: "hip" };
  assert.throws(() => adaptLegacyScope(hip), /outside patio-geometry\/v1 launch support/);

  const skew = structuredClone(byId("skillion-riser-6x3").legacyScope);
  skew.config = { ...skew.config, skew: true };
  assert.throws(() => adaptLegacyScope(skew), /front-skew/);
});
