import {
  PATIO_MODEL_SCHEMA_VERSION,
  assertValidPatioModel,
  deriveStructuredJobScope,
  type AttachmentV1,
  type ExistingSiteV1,
  type FlashingProfileV1,
  type FrameMaterial,
  type GableOrientation,
  type PatioModelV1,
  type RoofingMaterial,
  type StructuralSectionV1
} from "./patio-model.ts";
import {
  calculatePostPositionsMm,
  calculateRafterLayout,
  computePatioGeometry,
  type PatioGeometryV1
} from "./geometry.ts";

export interface LegacyScopeV18 {
  _version?: string;
  client?: Record<string, unknown>;
  config?: Record<string, unknown>;
  existingSite?: Record<string, unknown>;
  scope?: Record<string, unknown>;
  notes?: Record<string, unknown>;
  flashings?: unknown[];
}

export interface LegacyAdaptationResult {
  model: PatioModelV1;
  warnings: string[];
}

export interface ComparableGeometrySnapshot {
  roofType: string;
  lengthMm: number;
  projectionMm: number;
  pitchDeg: number;
  frontBeamBottomMm: number;
  backBeamBottomMm: number;
  fasciaBeamBottomMm: number | null;
  verticalRiseMm: number;
  rafterLengthMm: number;
  postQuantityPerRow: number;
  postPositionsMm: number[];
  rafterQuantity: number;
  trussQuantity: number;
  sheetsPerPlane: number;
  totalSheets: number;
}

export interface GeometryDifference {
  path: string;
  legacy: string | number | null;
  canonical: string | number | null;
  delta: number | null;
  tolerance: number;
}

export interface ShadowComparisonReport {
  supported: true;
  parity: boolean;
  toleranceMm: number;
  comparisons: number;
  warnings: string[];
  differences: GeometryDifference[];
  legacy: ComparableGeometrySnapshot;
  canonical: ComparableGeometrySnapshot;
  model: PatioModelV1;
  geometry: PatioGeometryV1;
  structuredJobScope: ReturnType<typeof deriveStructuredJobScope>;
}

const SECTION_MAP: Record<string, StructuralSectionV1> = {
  "65x65": section("65x65", "65×65×2 SHS", "steel", 65, 65, 2),
  "75x75": section("75x75", "75×75×2 SHS", "steel", 75, 75, 2),
  "90x90": section("90x90", "90×90×2 SHS", "steel", 90, 90, 2),
  "100x100": section("100x100", "100×100×2 SHS", "steel", 100, 100, 2),
  "125x125": section("125x125", "125×125×3 SHS", "steel", 125, 125, 3),
  "150x150": section("150x150", "150×150×3 SHS", "steel", 150, 150, 3),
  "76x38": section("76x38", "76×38×1.6 RHS", "steel", 76, 38, 1.6),
  "75x50": section("75x50", "75×50×2 RHS", "steel", 75, 50, 2),
  "100x50": section("100x50", "100×50×2 RHS", "steel", 100, 50, 2),
  "125x50": section("125x50", "125×50×2 RHS", "steel", 125, 50, 2),
  "150x50": section("150x50", "150×50×2 RHS", "steel", 150, 50, 2),
  "150x50x2": section("150x50x2", "150×50×2 RHS", "steel", 150, 50, 2),
  "150x50x3": section("150x50x3", "150×50×3 RHS", "steel", 150, 50, 3),
  "200x50": section("200x50", "200×50×2 RHS", "steel", 200, 50, 2),
  "timber_90": section("timber_90", "90×90 H4 Timber", "timber", 90, 90, null),
  "timber_115": section("timber_115", "115×115 H4 Timber", "timber", 115, 115, null),
  "timber_140": section("timber_140", "140×140 H4 Timber", "timber", 140, 140, null),
  "merbau_195": section("merbau_195", "195×195 Merbau Laminate", "timber", 195, 195, null),
  "lvl_150x45": section("lvl_150x45", "150×45 LVL", "timber", 45, 150, null),
  "lvl_200x45": section("lvl_200x45", "200×45 LVL", "timber", 45, 200, null),
  "lvl_240x45": section("lvl_240x45", "240×45 LVL", "timber", 45, 240, null),
  "lvl_300x45": section("lvl_300x45", "300×45 LVL", "timber", 45, 300, null),
  "tp_70x35": section("tp_70x35", "70×35 Treated Pine", "timber", 35, 70, null),
  "tp_90x45": section("tp_90x45", "90×45 Treated Pine", "timber", 45, 90, null),
  "tp_140x45": section("tp_140x45", "140×45 Treated Pine", "timber", 45, 140, null),
  "tp_190x45": section("tp_190x45", "190×45 Treated Pine", "timber", 45, 190, null),
  "tp_240x45": section("tp_240x45", "240×45 Treated Pine", "timber", 45, 240, null),
  "merbau_140x45": section("merbau_140x45", "140×45 Merbau Laminate", "timber", 45, 140, null),
  "merbau_190x45": section("merbau_190x45", "190×45 Merbau Laminate", "timber", 45, 190, null),
  "merbau_240x45": section("merbau_240x45", "240×45 Merbau Laminate", "timber", 45, 240, null),
  "brick_pier": section("brick_pier", "Brick Pier (390×390)", "masonry", 390, 390, null)
};

const ROOFING: Record<string, { profile: string; material: RoofingMaterial; coverWidthMm: number; thicknessMm: number; maxSpanMm: number }> = {
  solarspan75: { profile: "SolarSpan 75mm", material: "insulated-panel", coverWidthMm: 1000, thicknessMm: 75, maxSpanMm: 4500 },
  solarspan100: { profile: "SolarSpan 100mm", material: "insulated-panel", coverWidthMm: 1000, thicknessMm: 100, maxSpanMm: 5500 },
  solarspan150: { profile: "SolarSpan 150mm", material: "insulated-panel", coverWidthMm: 1000, thicknessMm: 150, maxSpanMm: 7000 },
  solarspan200: { profile: "SolarSpan 200mm", material: "insulated-panel", coverWidthMm: 1000, thicknessMm: 200, maxSpanMm: 8500 },
  stratco_cgi75: { profile: "Stratco CGI 75mm (1m)", material: "insulated-panel", coverWidthMm: 1000, thicknessMm: 75, maxSpanMm: 4500 },
  stratco_cgi75_760: { profile: "Stratco CGI 75mm (760mm)", material: "insulated-panel", coverWidthMm: 760, thicknessMm: 75, maxSpanMm: 4500 },
  stratco_cgi100: { profile: "Stratco CGI 100mm (1m)", material: "insulated-panel", coverWidthMm: 1000, thicknessMm: 100, maxSpanMm: 5500 },
  stratco_cgi100_760: { profile: "Stratco CGI 100mm (760mm)", material: "insulated-panel", coverWidthMm: 760, thicknessMm: 100, maxSpanMm: 5500 },
  trimdek: { profile: "Trimdek", material: "steel-sheet", coverWidthMm: 762, thicknessMm: 0, maxSpanMm: 1900 },
  corrugated: { profile: "Corrugated", material: "steel-sheet", coverWidthMm: 762, thicknessMm: 0, maxSpanMm: 1200 },
  spandek: { profile: "Spandek", material: "steel-sheet", coverWidthMm: 760, thicknessMm: 0, maxSpanMm: 2400 },
  spanplus330: { profile: "SpanPlus 330", material: "steel-sheet", coverWidthMm: 330, thicknessMm: 0, maxSpanMm: 4500 },
  polycarb_trimdek: { profile: "Polycarb Trimdek", material: "polycarbonate", coverWidthMm: 760, thicknessMm: 1, maxSpanMm: 2100 },
  polycarb_corrugated: { profile: "Polycarb Corrugated", material: "polycarbonate", coverWidthMm: 760, thicknessMm: 1, maxSpanMm: 1100 }
};

function section(id: string, label: string, material: FrameMaterial, widthMm: number, depthMm: number, wallThicknessMm: number | null): StructuralSectionV1 {
  return { id, label, material, widthMm, depthMm, wallThicknessMm } as StructuralSectionV1;
}

function cloneSection(id: unknown, fallback: string): StructuralSectionV1 {
  const key = typeof id === "string" && SECTION_MAP[id] ? id : fallback;
  return { ...SECTION_MAP[key] };
}

function numberFromLegacy(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Legacy boundary only: current V18 config stores these values as metre strings. */
function legacyMetresToMm(value: unknown, fallbackMetres: number): number {
  return Math.round(numberFromLegacy(value, fallbackMetres) * 1000);
}

function legacyMm(value: unknown, fallbackMm: number): number {
  return Math.round(numberFromLegacy(value, fallbackMm));
}

function legacyBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "1" || value === 1 || value === "true") return true;
  if (value === "0" || value === 0 || value === "false") return false;
  return fallback;
}

function legacyString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function normalizeRoofType(value: unknown): PatioModelV1["roof"]["type"] {
  if (value === "reverse_skillion" || value === "reverse-skillion") return "reverse-skillion";
  if (value === "skillion" || value === "gable") return value;
  if (value === "hip") throw new RangeError("Legacy hip scopes are outside patio-geometry/v1 launch support");
  throw new RangeError(`Unsupported legacy roof style: ${String(value)}`);
}

function assertLaunchRectangle(config: Record<string, unknown>): void {
  const shape = legacyString(config.patioShape, "rectangle");
  const unsupported: string[] = [];
  if (shape !== "rectangle") unsupported.push(`patioShape=${shape}`);
  if (Array.isArray(config.zones) && config.zones.length > 1) unsupported.push("multi-zone");
  if (config.polygon) unsupported.push("polygon");
  if (legacyBoolean(config.skew)) unsupported.push("front-skew");
  if (legacyString(config.sideSkew, "none") !== "none") unsupported.push("side-skew");
  if (legacyString(config.wraparound, "none") !== "none") unsupported.push("wraparound");
  if (legacyString(config.lShape, "none") !== "none") unsupported.push("legacy-l-shape");
  if (legacyBoolean(config.cantilever)) unsupported.push("cantilever");
  if (legacyBoolean(config.houseJog)) unsupported.push("house-jog");
  if (legacyBoolean(config.betweenStructures)) unsupported.push("between-structures");
  if (unsupported.length) throw new RangeError(`Legacy scope uses features outside patio-geometry/v1 launch support: ${unsupported.join(", ")}`);
}

function configOf(scope: LegacyScopeV18): Record<string, unknown> {
  return scope.config && typeof scope.config === "object" && !Array.isArray(scope.config)
    ? scope.config
    : {};
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function customArray(config: Record<string, unknown>, key: string, quantity: number): number[] {
  const root = nestedRecord(config[key]);
  const source = Array.isArray(root["0"]) ? root["0"] as unknown[] : [];
  return Array.from({ length: quantity }, (_, index) => legacyMm(source[index], 0));
}

function postPositions(config: Record<string, unknown>, quantity: number): number[] | null {
  const root = nestedRecord(config.customPostPositions);
  const source = Array.isArray(root["0"]) ? root["0"] as unknown[] : null;
  if (!source || source.length !== quantity) return null;
  return source.map((position) => legacyMm(position, 0));
}

function mapAttachment(config: Record<string, unknown>, riserSection: StructuralSectionV1, lengthMm: number): AttachmentV1 {
  const type = enumOr(config.connection, ["freestanding", "wall", "fascia", "riser", "flyover"] as const, "riser");
  const fasciaHeightMm = legacyMm(config.fasciaHeight, 2700);
  switch (type) {
    case "freestanding": return { type };
    case "wall": return { type, wallHeightMm: fasciaHeightMm };
    case "fascia": return {
      type,
      fasciaHeightMm,
      bracketQuantity: Math.max(2, legacyMm(config.fasciaBracketQty, 4))
    };
    case "riser": return {
      type,
      fasciaHeightMm,
      riserHeightMm: legacyMm(config.riserHeight, 400),
      riserOffsetMm: legacyMm(config.riserOffset, 150),
      riserQuantity: Math.max(2, legacyMm(config.riserQty, Math.max(2, Math.ceil(lengthMm / 1200)))),
      riserSection
    };
    case "flyover": return {
      type,
      fasciaHeightMm,
      houseRoofPitchDeg: numberFromLegacy(config.houseRoofPitch, 22.5),
      houseRoofDepthMm: legacyMm(config.houseRoofDepth, 1500),
      setbackMm: legacyMm(config.flyoverSetback, 600),
      clearanceMm: legacyMm(config.flyoverClearance, 150)
    };
  }
}

function mapExistingSite(scope: LegacyScopeV18): ExistingSiteV1 {
  const source = nestedRecord(scope.existingSite);
  const conditionRaw = legacyString(source.existing, "clear");
  const condition = enumOr(conditionRaw, ["clear", "existing-patio", "partial-structure", "other"] as const, conditionRaw === "clear" ? "clear" : "other");
  const electricalRaw = legacyString(source.electrical, "none");
  const electrical = electricalRaw === "downlights" ? "lights"
    : enumOr(electricalRaw, ["none", "lights", "fan", "both", "other"] as const, "other");
  return {
    condition,
    demolitionNotes: legacyString(source.demoNotes),
    electrical
  };
}

function mapFlashings(scope: LegacyScopeV18): FlashingProfileV1[] {
  if (!Array.isArray(scope.flashings)) return [];
  return scope.flashings.flatMap((raw, index) => {
    const flashing = nestedRecord(raw);
    if (Object.keys(flashing).length === 0) return [];
    const pointsRaw = Array.isArray(flashing.points) ? flashing.points : [];
    const pointsMm = pointsRaw.map((rawPoint) => {
      if (Array.isArray(rawPoint)) return { xMm: legacyMm(rawPoint[0], 0), yMm: legacyMm(rawPoint[1], 0) };
      const source = nestedRecord(rawPoint);
      return { xMm: legacyMm(source.x ?? source.xMm, 0), yMm: legacyMm(source.y ?? source.yMm, 0) };
    });
    const colourSideRaw = legacyString(flashing.colourSide, "inside");
    return [{
      id: legacyString(flashing.id, `legacy-flashing-${index + 1}`),
      name: legacyString(flashing.name, `Flashing ${index + 1}`),
      colour: legacyString(flashing.colour, "Surfmist"),
      gaugeMm: numberFromLegacy(flashing.gauge, 0.55),
      lengthMm: legacyMm(flashing.length, 4500),
      quantity: Math.max(1, legacyMm(flashing.qty, 1)),
      colourSide: enumOr(colourSideRaw, ["inside", "outside", "both"] as const, "inside"),
      pointsMm,
      girthMm: legacyMm(flashing.girth, 0),
      legs: Math.max(0, legacyMm(flashing.legs, Math.max(0, pointsMm.length - 1))),
      startTreatment: typeof flashing.startTreatment === "string" ? flashing.startTreatment : null,
      endTreatment: typeof flashing.endTreatment === "string" ? flashing.endTreatment : null
    } as FlashingProfileV1];
  });
}

function purlinRows(config: Record<string, unknown>, roofType: PatioModelV1["roof"]["type"], roofingId: string, projectionMm: number, lengthMm: number, pitchDeg: number): number {
  const product = ROOFING[roofingId];
  if (!product || product.material === "insulated-panel") return 0;
  const extra = Math.trunc(numberFromLegacy(config.extraBattens, 0));
  if (roofType !== "gable") return Math.max(0, Math.ceil(projectionMm / product.maxSpanMm) - 1 + extra);
  const orientation = enumOr(config.orientation, ["lengthways", "perpendicular", "housefacing"] as const, "lengthways");
  const spanMm = orientation === "lengthways" ? projectionMm : lengthMm;
  const rafterMm = (spanMm / 2) / Math.cos(pitchDeg * Math.PI / 180);
  const effectiveMm = Math.max(rafterMm - 75, 100);
  return Math.max(0, Math.ceil(effectiveMm / product.maxSpanMm) + 1 + extra);
}

function jobType(value: unknown): PatioModelV1["jobType"] {
  const map: Record<string, PatioModelV1["jobType"]> = {
    full: "full",
    resheet: "resheet",
    partial_sheet: "partial-sheet",
    no_sheet: "frame-only",
    quote_only: "quote-only"
  };
  return map[legacyString(value, "full")] ?? "full";
}

/**
 * Explicit migration boundary from the legacy V18 envelope. String parsing happens here only;
 * the returned PatioModelV1 contains numeric millimetres and passes strict runtime validation.
 */
export function adaptLegacyScope(scope: LegacyScopeV18): LegacyAdaptationResult {
  const config = configOf(scope);
  assertLaunchRectangle(config);
  const warnings: string[] = [];
  const roofType = normalizeRoofType(config.roofStyle ?? "skillion");
  const lengthMm = legacyMetresToMm(config.length, 6);
  const projectionMm = legacyMetresToMm(config.projection, 3);
  const pitchDeg = numberFromLegacy(config.pitch, 10);
  const legacyOrientation = enumOr(config.orientation, ["lengthways", "perpendicular", "housefacing"] as const, "lengthways");
  const orientation: GableOrientation = legacyOrientation === "housefacing" ? "house-facing" : legacyOrientation;
  const roofingId = ROOFING[legacyString(config.roofing)] ? legacyString(config.roofing) : "corrugated";
  if (roofingId !== config.roofing) warnings.push(`Unknown legacy roofing ${String(config.roofing)} defaulted to corrugated`);
  const roofing = ROOFING[roofingId];
  const frameMaterial = enumOr(config.frameMaterial, ["steel", "timber"] as const, "steel");
  const postSection = cloneSection(config.postSize, frameMaterial === "timber" ? "timber_90" : "90x90");
  const beamSection = cloneSection(config.beamSize, frameMaterial === "timber" ? "lvl_200x45" : "100x50");
  const frontBeamSection = cloneSection(config.gutterBeamSize, beamSection.id);
  const backBeamSection = cloneSection(config.riserBeamSize, beamSection.id);
  const rafterSection = cloneSection(config.rafterSize, frameMaterial === "timber" ? "tp_140x45" : "76x38");
  const purlinSection = cloneSection(config.purlinSize, frameMaterial === "timber" ? "tp_70x35" : "76x38");
  const trussSection = cloneSection(config.trussSteel, "76x38");
  const riserSection = cloneSection(config.riserSteel, "76x38");
  const distributionMm = roofType === "gable" && orientation !== "lengthways" ? projectionMm : lengthMm;
  const postQuantity = Math.max(2, legacyMm(config.posts, Math.ceil(distributionMm / 2400) + 1));
  const trussQuantity = Math.max(2, legacyMm(config.trusses, Math.ceil(distributionMm / 2000) + 1));
  const scopeDetails = nestedRecord(scope.scope);
  const notes = nestedRecord(scope.notes);
  const trussLeft = nestedRecord(config.trussRiserLeft);
  const trussRight = nestedRecord(config.trussRiserRight);
  const trussRisersEnabled = legacyBoolean(trussLeft.enabled) || legacyBoolean(trussRight.enabled);
  const polyEnabled = legacyBoolean(config.polycarbEnabled);
  const dpSelection = Array.isArray(config.dpSelection) ? config.dpSelection : [];
  const partialPattern = legacyString(config.polycarbPattern, "3");
  const mappedJobType = jobType(config.jobType);
  const rawCoverage = numberFromLegacy(config.partialSheetCoverage, 50);
  const coverageFraction = mappedJobType === "partial-sheet"
    ? Math.max(0.05, Math.min(0.95, rawCoverage > 1 ? rawCoverage / 100 : rawCoverage))
    : 1;
  if (mappedJobType === "partial-sheet") {
    warnings.push("Canonical sheet counts use the covered roof range; the legacy calculateSheets summary uses full structural width");
  } else if (mappedJobType === "frame-only" || mappedJobType === "quote-only") {
    warnings.push("Canonical geometry reports zero installed sheets for this job type; the legacy calculateSheets summary remains populated");
  }

  const model: PatioModelV1 = {
    schemaVersion: PATIO_MODEL_SCHEMA_VERSION,
    units: "mm",
    scopeId: legacyString(nestedRecord(scope.client).jobRef).trim() || "legacy-shadow-scope",
    optionId: null,
    jobType: mappedJobType,
    footprint: {
      type: "rectangle",
      lengthMm,
      projectionMm,
      rearRoofOverhangMm: legacyMm(config.rearOverhang, 0),
      endOverhangMm: legacyMm(config.endOverhang, 0),
      patioPastHouseLeftMm: legacyMm(config.patioPastHouseLeft, 0),
      patioPastHouseRightMm: legacyMm(config.patioPastHouseRight, 0)
    },
    roof: roofType === "gable"
      ? { type: "gable", pitchDeg, orientation, eaveOverhangMm: legacyMm(config.overhang, 0) }
      : { type: roofType, pitchDeg },
    attachment: mapAttachment(config, riserSection, lengthMm),
    structure: {
      frameMaterial: postSection.material,
      postHeightMm: legacyMetresToMm(config.postHeight, 2.4),
      posts: {
        section: postSection,
        fixing: enumOr(config.postFix, ["concrete", "base-plate", "stirrup"] as const, "concrete"),
        embedmentMm: enumOr(config.postFix, ["concrete", "base-plate", "stirrup"] as const, "concrete") === "concrete" ? 300 : 0,
        quantity: postQuantity,
        positionsMm: postPositions(config, postQuantity),
        frontSetbacksMm: customArray(config, "customPostDepths", postQuantity),
        backSetbacksMm: customArray(config, "customPostBackDepths", postQuantity)
      },
      beams: {
        front: frontBeamSection,
        back: backBeamSection,
        fascia: beamSection
      },
      rafters: {
        section: rafterSection,
        spacingMm: legacyMm(config.rafterSpacing, 900),
        quantityOverride: legacyMm(config.rafterQtyOverride, 0) >= 2 ? legacyMm(config.rafterQtyOverride, 0) : null
      },
      purlins: {
        section: purlinSection,
        rowsPerPlane: purlinRows(config, roofType, roofingId, projectionMm, lengthMm, pitchDeg)
      },
      trusses: {
        quantity: trussQuantity,
        section: trussSection,
        webStyle: enumOr(config.trussBase, ["kingpost", "kingverticals", "web"] as const, "kingpost") === "kingverticals" ? "king-verticals" : enumOr(config.trussBase, ["kingpost", "web"] as const, "kingpost"),
        chord: enumOr(config.trussChord, ["bottom", "mid", "none"] as const, "bottom"),
        extenderMm: nestedRecord(config.trussExtender).enabled ? legacyMm(nestedRecord(config.trussExtender).length, 300) : 0,
        heelRisers: {
          enabled: trussRisersEnabled,
          type: enumOr(config.riserType, ["welded", "separate"] as const, "welded"),
          leftHorizontalMm: legacyMm(trussLeft.length, 200),
          leftVerticalMm: legacyMm(trussLeft.height, 150),
          rightHorizontalMm: legacyMm(trussRight.length, 200),
          rightVerticalMm: legacyMm(trussRight.height, 150)
        }
      },
      externalFrame: config.externalFrame === "yes" || legacyBoolean(config.externalFrame),
      tieBeams: {
        left: legacyBoolean(config.tieBeamLeft),
        right: legacyBoolean(config.tieBeamRight),
        blindBelowLeft: legacyBoolean(config.tieBeamBlindLeft),
        blindBelowRight: legacyBoolean(config.tieBeamBlindRight),
        polycarbonateInfillLeft: legacyBoolean(config.tieBeamInfillLeft),
        polycarbonateInfillRight: legacyBoolean(config.tieBeamInfillRight)
      }
    },
    roofing: {
      productId: roofingId,
      profile: roofing.profile,
      material: roofing.material,
      coverWidthMm: roofing.coverWidthMm,
      panelThicknessMm: roofing.thicknessMm,
      bmtMm: roofing.material === "steel-sheet" ? numberFromLegacy(config.sheetBMT, 0.42) : null,
      colour: legacyString(config.sheetColor, "Surfmist"),
      ceilingFinish: enumOr(config.ceilingFinish, ["plain", "vj", "cedar"] as const, "plain"),
      skylightCount: Math.max(0, legacyMm(config.skylightCount, 0)),
      coverage: {
        fraction: coverageFraction,
        openSide: enumOr(config.partialSheetOpenSide, ["left", "right"] as const, "right")
      },
      polycarbonate: {
        enabled: polyEnabled,
        brand: polyEnabled ? legacyString(config.polycarbBrand, "ampelite") : null,
        tint: polyEnabled ? legacyString(config.polycarbTint, "Clear") : null,
        patternEvery: polyEnabled ? Math.max(2, legacyMm(partialPattern === "custom" ? config.polycarbCustom : partialPattern, 3)) : null,
        level: polyEnabled ? Math.max(1, legacyMm(config.polycarbLevel, 1)) : null
      }
    },
    drainage: {
      includeGutters: config.includeGutters === undefined ? true : legacyBoolean(config.includeGutters),
      includeDownpipes: config.includeDownpipes === undefined ? true : legacyBoolean(config.includeDownpipes),
      includeFlashings: config.includeFlashings === undefined ? true : legacyBoolean(config.includeFlashings),
      houseGutter: enumOr(config.houseGutter, ["none", "quad", "box"] as const, "quad"),
      riserGutter: enumOr(config.riserGutter, ["none", "quad", "box"] as const, "none"),
      downpipePostIndices: dpSelection.map((index) => Math.max(0, legacyMm(index, 0)))
    },
    infill: {
      gable: enumOr(config.infill, ["none", "colorbond", "polycarbonate", "louvre"] as const, "none"),
      riser: enumOr(config.riserInfill, ["none", "colorbond", "polycarbonate"] as const, "none"),
      ceilingFinish: enumOr(config.ceilingFinish, ["plain", "vj", "cedar"] as const, "plain")
    },
    finishes: {
      steelColour: legacyString(config.steelColor, "Surfmist"),
      sheetColour: legacyString(config.sheetColor, "Surfmist"),
      flashingColour: legacyString(config.flashingColor, "Surfmist")
    },
    existingSite: mapExistingSite(scope),
    services: {
      downlights: { included: legacyBoolean(scopeDetails.elecDownlights), quantity: Math.max(0, legacyMm(scopeDetails.elecDownlightsQty, 4)) },
      fans: { included: legacyBoolean(scopeDetails.elecFan), quantity: Math.max(0, legacyMm(scopeDetails.elecFanQty, 1)) },
      gpos: { included: legacyBoolean(scopeDetails.elecGPO), quantity: Math.max(0, legacyMm(scopeDetails.elecGPOQty, 1)) },
      demolitionIncluded: legacyBoolean(scopeDetails.scopeDemo),
      skipBinIncluded: legacyBoolean(scopeDetails.scopeSkip),
      permitIncluded: legacyBoolean(scopeDetails.scopePermit)
    },
    flashings: mapFlashings(scope),
    notes: {
      quote: legacyString(notes.noteQuote),
      workOrder: legacyString(notes.noteWorkOrder),
      materialOrder: legacyString(notes.noteMaterialOrder),
      internal: legacyString(notes.noteInternal),
      pricing: legacyString(notes.pricingNotes)
    },
    capabilities: ["rectangle", roofType]
  };
  assertValidPatioModel(model);
  return { model, warnings };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/**
 * Pure port of the rectangular dimensions/counts from legacy getInputs(), calculateRafters()
 * and calculateSheets(). It has no DOM access and exists only as a shadow parity reference.
 */
export function computeLegacyGeometryReference(scope: LegacyScopeV18): ComparableGeometrySnapshot {
  const { model } = adaptLegacyScope(scope);
  const pitchRad = model.roof.pitchDeg * Math.PI / 180;
  const lengthMm = model.footprint.lengthMm;
  const projectionMm = model.footprint.projectionMm;
  const fasciaBeamDepthMm = model.structure.beams.fascia.depthMm;
  const pitchRiseMm = projectionMm * Math.tan(pitchRad);
  let frontBeamBottomMm = model.structure.postHeightMm;
  let backBeamBottomMm = model.structure.postHeightMm;
  let fasciaBeamBottomMm: number | null = null;

  if (model.roof.type === "gable") {
    switch (model.attachment.type) {
      case "freestanding": break;
      case "wall": frontBeamBottomMm = backBeamBottomMm = model.attachment.wallHeightMm; break;
      case "fascia": {
        fasciaBeamBottomMm = model.attachment.fasciaHeightMm - 155;
        const doglegVerticalMm = model.structure.trusses.heelRisers.enabled ? model.structure.trusses.heelRisers.leftVerticalMm : 300;
        frontBeamBottomMm = backBeamBottomMm = fasciaBeamBottomMm + doglegVerticalMm + fasciaBeamDepthMm;
        break;
      }
      case "riser":
        fasciaBeamBottomMm = model.attachment.fasciaHeightMm - 155;
        frontBeamBottomMm = backBeamBottomMm = model.attachment.fasciaHeightMm + fasciaBeamDepthMm + model.attachment.riserSection.widthMm + model.attachment.riserHeightMm;
        break;
      case "flyover":
        fasciaBeamBottomMm = model.attachment.fasciaHeightMm;
        frontBeamBottomMm = backBeamBottomMm = model.attachment.fasciaHeightMm
          + model.attachment.setbackMm * Math.tan(model.attachment.houseRoofPitchDeg * Math.PI / 180)
          + model.attachment.clearanceMm;
        break;
    }
  } else {
    const reverse = model.roof.type === "reverse-skillion";
    switch (model.attachment.type) {
      case "freestanding":
        if (reverse) frontBeamBottomMm += pitchRiseMm;
        else backBeamBottomMm += pitchRiseMm;
        break;
      case "wall":
        backBeamBottomMm = model.attachment.wallHeightMm;
        frontBeamBottomMm = reverse ? backBeamBottomMm + pitchRiseMm : backBeamBottomMm - pitchRiseMm;
        break;
      case "fascia":
        fasciaBeamBottomMm = model.attachment.fasciaHeightMm - 155;
        backBeamBottomMm = fasciaBeamBottomMm;
        frontBeamBottomMm = reverse ? backBeamBottomMm + pitchRiseMm : backBeamBottomMm - pitchRiseMm;
        break;
      case "riser":
        fasciaBeamBottomMm = model.attachment.fasciaHeightMm - 155;
        backBeamBottomMm = model.attachment.fasciaHeightMm + fasciaBeamDepthMm + model.attachment.riserSection.widthMm + model.attachment.riserHeightMm;
        frontBeamBottomMm = reverse ? backBeamBottomMm + pitchRiseMm : backBeamBottomMm - pitchRiseMm;
        break;
      case "flyover":
        fasciaBeamBottomMm = model.attachment.fasciaHeightMm;
        backBeamBottomMm = model.attachment.fasciaHeightMm
          + model.attachment.setbackMm * Math.tan(model.attachment.houseRoofPitchDeg * Math.PI / 180)
          + model.attachment.clearanceMm;
        frontBeamBottomMm = reverse ? backBeamBottomMm + pitchRiseMm : backBeamBottomMm - pitchRiseMm;
        break;
    }
  }

  const gableSpan = model.roof.type === "gable" && model.roof.orientation !== "lengthways" ? lengthMm : projectionMm;
  const riseMm = model.roof.type === "gable" ? (gableSpan / 2) * Math.tan(pitchRad) : backBeamBottomMm - frontBeamBottomMm;
  const rafterLengthMm = model.roof.type === "gable"
    ? Math.hypot(gableSpan / 2, riseMm)
    : Math.hypot(projectionMm, riseMm);
  const rafterLayout = calculateRafterLayout(lengthMm, model.structure.rafters.spacingMm, model.structure.rafters.quantityOverride);
  const sheetDistribution = model.roof.type === "gable" && model.roof.orientation !== "lengthways" ? projectionMm : lengthMm;
  const sheetsPerPlane = Math.max(1, Math.ceil(sheetDistribution / model.roofing.coverWidthMm));
  return {
    roofType: model.roof.type,
    lengthMm,
    projectionMm,
    pitchDeg: model.roof.pitchDeg,
    frontBeamBottomMm: round(frontBeamBottomMm),
    backBeamBottomMm: round(backBeamBottomMm),
    fasciaBeamBottomMm: fasciaBeamBottomMm === null ? null : round(fasciaBeamBottomMm),
    verticalRiseMm: round(Math.abs(riseMm)),
    rafterLengthMm: round(rafterLengthMm),
    postQuantityPerRow: model.structure.posts.quantity,
    postPositionsMm: calculatePostPositionsMm(model),
    rafterQuantity: model.roof.type === "gable" ? 0 : rafterLayout.quantity,
    trussQuantity: model.roof.type === "gable" ? model.structure.trusses.quantity : 0,
    sheetsPerPlane,
    totalSheets: sheetsPerPlane * (model.roof.type === "gable" ? 2 : 1)
  };
}

export function canonicalComparableSnapshot(model: PatioModelV1, geometry: PatioGeometryV1): ComparableGeometrySnapshot {
  // Read positions/counts back from the engine's rendered frame rather than re-calling the
  // layout helpers, so this snapshot reflects what computePatioGeometry actually emitted and the
  // parity comparison is a real engine-vs-legacy check rather than helper-vs-itself.
  const frontRowPostXsMm = geometry.frame.posts
    .filter((post) => post.role === "front-row")
    .map((post) => post.startMm.xMm);
  return {
    roofType: geometry.metrics.roofType,
    lengthMm: geometry.metrics.lengthMm,
    projectionMm: geometry.metrics.projectionMm,
    pitchDeg: geometry.metrics.pitchDeg,
    frontBeamBottomMm: geometry.metrics.frontBeamBottomMm,
    backBeamBottomMm: geometry.metrics.backBeamBottomMm,
    fasciaBeamBottomMm: geometry.metrics.fasciaBeamBottomMm,
    verticalRiseMm: geometry.metrics.verticalRiseMm,
    // Legacy calc.rafter excludes the separate rear roof overhang; compare that structural run.
    rafterLengthMm: round(model.roof.type === "gable"
      ? geometry.metrics.rafterLengthMm
      : Math.hypot(model.footprint.projectionMm, geometry.metrics.signedBackMinusFrontRiseMm)),
    postQuantityPerRow: model.structure.posts.quantity,
    postPositionsMm: frontRowPostXsMm,
    rafterQuantity: geometry.metrics.rafterCount,
    trussQuantity: geometry.metrics.trussCount,
    sheetsPerPlane: geometry.metrics.sheetsPerPlane,
    totalSheets: geometry.metrics.totalSheets
  };
}

function flattenSnapshot(snapshot: ComparableGeometrySnapshot): Array<[string, string | number | null]> {
  const rows: Array<[string, string | number | null]> = [];
  Object.entries(snapshot).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item, index) => rows.push([`${key}[${index}]`, item]));
    else rows.push([key, value]);
  });
  return rows;
}

export type LegacyGeometryComputation = (scope: LegacyScopeV18) => ComparableGeometrySnapshot;

/** Run the new engine in shadow and return an itemised, side-effect-free parity report. */
export function compareLegacyScope(
  scope: LegacyScopeV18,
  options: { toleranceMm?: number; legacyComputation?: LegacyGeometryComputation } = {}
): ShadowComparisonReport {
  const toleranceMm = options.toleranceMm ?? 0.001;
  const adaptation = adaptLegacyScope(scope);
  const geometry = computePatioGeometry(adaptation.model);
  const canonical = canonicalComparableSnapshot(adaptation.model, geometry);
  const legacy = (options.legacyComputation ?? computeLegacyGeometryReference)(scope);
  const legacyRows = new Map(flattenSnapshot(legacy));
  const canonicalRows = new Map(flattenSnapshot(canonical));
  const paths = [...new Set([...legacyRows.keys(), ...canonicalRows.keys()])].sort();
  const differences: GeometryDifference[] = [];

  paths.forEach((path) => {
    const legacyValue = legacyRows.get(path) ?? null;
    const canonicalValue = canonicalRows.get(path) ?? null;
    if (typeof legacyValue === "number" && typeof canonicalValue === "number") {
      const delta = round(canonicalValue - legacyValue);
      const isDimension = path.toLowerCase().includes("mm") || path.includes("Position") || path.includes("Length") || path.includes("Rise") || path.includes("Beam");
      const tolerance = isDimension ? toleranceMm : 0;
      if (Math.abs(delta) > tolerance) differences.push({ path, legacy: legacyValue, canonical: canonicalValue, delta, tolerance });
    } else if (legacyValue !== canonicalValue) {
      differences.push({ path, legacy: legacyValue, canonical: canonicalValue, delta: null, tolerance: 0 });
    }
  });

  return {
    supported: true,
    parity: differences.length === 0,
    toleranceMm,
    comparisons: paths.length,
    warnings: adaptation.warnings,
    differences,
    legacy,
    canonical,
    model: adaptation.model,
    geometry,
    structuredJobScope: deriveStructuredJobScope(adaptation.model)
  };
}
