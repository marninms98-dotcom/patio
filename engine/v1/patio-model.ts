// Patio rendering rebuild foundation — canonical model v1.
// This module is deliberately independent of the legacy DOM, renderer, pricing and quote paths.

export const PATIO_MODEL_SCHEMA_VERSION = "patio-model/v1" as const;
export const PATIO_GEOMETRY_ENGINE_VERSION = "patio-geometry/v1" as const;

export type Millimetres = number & { readonly __unit: "mm" };
export type Degrees = number & { readonly __unit: "degrees" };

export type RoofType = "skillion" | "reverse-skillion" | "gable";
export type GableOrientation = "lengthways" | "perpendicular" | "house-facing";
export type AttachmentType = "freestanding" | "wall" | "fascia" | "riser" | "flyover";
export type FrameMaterial = "steel" | "timber" | "masonry";
export type RoofingMaterial = "insulated-panel" | "steel-sheet" | "polycarbonate";

export interface Point2Mm {
  xMm: Millimetres;
  yMm: Millimetres;
}

export interface StructuralSectionV1 {
  id: string;
  label: string;
  material: FrameMaterial;
  widthMm: Millimetres;
  depthMm: Millimetres;
  wallThicknessMm: Millimetres | null;
}

export interface RectangleFootprintV1 {
  type: "rectangle";
  lengthMm: Millimetres;
  projectionMm: Millimetres;
  rearRoofOverhangMm: Millimetres;
  endOverhangMm: Millimetres;
  patioPastHouseLeftMm: Millimetres;
  patioPastHouseRightMm: Millimetres;
}

export interface SkillionRoofV1 {
  type: "skillion" | "reverse-skillion";
  pitchDeg: Degrees;
}

export interface GableRoofV1 {
  type: "gable";
  pitchDeg: Degrees;
  orientation: GableOrientation;
  eaveOverhangMm: Millimetres;
}

export type RoofV1 = SkillionRoofV1 | GableRoofV1;

export interface FreestandingAttachmentV1 {
  type: "freestanding";
}

export interface WallAttachmentV1 {
  type: "wall";
  wallHeightMm: Millimetres;
}

export interface FasciaAttachmentV1 {
  type: "fascia";
  fasciaHeightMm: Millimetres;
  bracketQuantity: number;
}

export interface RiserAttachmentV1 {
  type: "riser";
  fasciaHeightMm: Millimetres;
  riserHeightMm: Millimetres;
  riserOffsetMm: Millimetres;
  riserQuantity: number;
  riserSection: StructuralSectionV1;
}

export interface FlyoverAttachmentV1 {
  type: "flyover";
  fasciaHeightMm: Millimetres;
  houseRoofPitchDeg: Degrees;
  houseRoofDepthMm: Millimetres;
  setbackMm: Millimetres;
  clearanceMm: Millimetres;
}

export type AttachmentV1 =
  | FreestandingAttachmentV1
  | WallAttachmentV1
  | FasciaAttachmentV1
  | RiserAttachmentV1
  | FlyoverAttachmentV1;

export interface PostLayoutV1 {
  section: StructuralSectionV1;
  fixing: "concrete" | "base-plate" | "stirrup";
  embedmentMm: Millimetres;
  quantity: number;
  /** Offsets from the left edge. null means deterministic even spacing with endOverhangMm. */
  positionsMm: Millimetres[] | null;
  /** Setbacks from the front support line toward the house, one per post. */
  frontSetbacksMm: Millimetres[];
  /** Setbacks from the back support line toward the patio, one per post. */
  backSetbacksMm: Millimetres[];
}

export interface BeamLayoutV1 {
  front: StructuralSectionV1;
  back: StructuralSectionV1;
  fascia: StructuralSectionV1;
}

export interface RafterLayoutV1 {
  section: StructuralSectionV1;
  spacingMm: Millimetres;
  quantityOverride: number | null;
}

export interface PurlinLayoutV1 {
  section: StructuralSectionV1;
  /** Physical rows on each roof plane; one plane for skillion, two for gable. */
  rowsPerPlane: number;
}

export interface TrussHeelRisersV1 {
  enabled: boolean;
  type: "welded" | "separate";
  leftHorizontalMm: Millimetres;
  leftVerticalMm: Millimetres;
  rightHorizontalMm: Millimetres;
  rightVerticalMm: Millimetres;
}

export interface TrussLayoutV1 {
  quantity: number;
  section: StructuralSectionV1;
  webStyle: "kingpost" | "king-verticals" | "web";
  chord: "bottom" | "mid" | "none";
  extenderMm: Millimetres;
  heelRisers: TrussHeelRisersV1;
}

export interface TieBeamLayoutV1 {
  left: boolean;
  right: boolean;
  blindBelowLeft: boolean;
  blindBelowRight: boolean;
  polycarbonateInfillLeft: boolean;
  polycarbonateInfillRight: boolean;
}

export interface StructureV1 {
  frameMaterial: FrameMaterial;
  postHeightMm: Millimetres;
  posts: PostLayoutV1;
  beams: BeamLayoutV1;
  rafters: RafterLayoutV1;
  purlins: PurlinLayoutV1;
  trusses: TrussLayoutV1;
  externalFrame: boolean;
  tieBeams: TieBeamLayoutV1;
}

export interface RoofingV1 {
  productId: string;
  profile: string;
  material: RoofingMaterial;
  coverWidthMm: Millimetres;
  panelThicknessMm: Millimetres;
  bmtMm: number | null;
  colour: string;
  ceilingFinish: "plain" | "vj" | "cedar";
  skylightCount: number;
  /** Portion of the structural roof that receives sheets (1 = full coverage). */
  coverage: {
    fraction: number;
    openSide: "left" | "right";
  };
  polycarbonate: {
    enabled: boolean;
    brand: string | null;
    tint: string | null;
    patternEvery: number | null;
    level: number | null;
  };
}

export interface DrainageV1 {
  includeGutters: boolean;
  includeDownpipes: boolean;
  includeFlashings: boolean;
  houseGutter: "none" | "quad" | "box";
  riserGutter: "none" | "quad" | "box";
  downpipePostIndices: number[];
}

export interface InfillV1 {
  gable: "none" | "colorbond" | "polycarbonate" | "louvre";
  riser: "none" | "colorbond" | "polycarbonate";
  ceilingFinish: "plain" | "vj" | "cedar";
}

export interface ExistingSiteV1 {
  condition: "clear" | "existing-patio" | "partial-structure" | "other";
  demolitionNotes: string;
  electrical: "none" | "lights" | "fan" | "both" | "other";
}

export interface ServicesAndScopeV1 {
  downlights: { included: boolean; quantity: number };
  fans: { included: boolean; quantity: number };
  gpos: { included: boolean; quantity: number };
  demolitionIncluded: boolean;
  skipBinIncluded: boolean;
  permitIncluded: boolean;
}

export interface FlashingProfileV1 {
  id: string;
  name: string;
  colour: string;
  gaugeMm: number;
  lengthMm: Millimetres;
  quantity: number;
  colourSide: "inside" | "outside" | "both";
  pointsMm: Point2Mm[];
  girthMm: Millimetres;
  legs: number;
  startTreatment: string | null;
  endTreatment: string | null;
}

export interface ScopeNotesV1 {
  quote: string;
  workOrder: string;
  materialOrder: string;
  internal: string;
  pricing: string;
}

export interface PatioModelV1 {
  schemaVersion: typeof PATIO_MODEL_SCHEMA_VERSION;
  units: "mm";
  scopeId: string;
  optionId: string | null;
  jobType: "full" | "resheet" | "partial-sheet" | "frame-only" | "quote-only";
  footprint: RectangleFootprintV1;
  roof: RoofV1;
  attachment: AttachmentV1;
  structure: StructureV1;
  roofing: RoofingV1;
  drainage: DrainageV1;
  infill: InfillV1;
  finishes: {
    steelColour: string;
    sheetColour: string;
    flashingColour: string;
  };
  existingSite: ExistingSiteV1;
  services: ServicesAndScopeV1;
  flashings: FlashingProfileV1[];
  notes: ScopeNotesV1;
  capabilities: Array<"rectangle" | RoofType>;
}

export interface StructuredJobScopeV1 {
  schema_version: typeof PATIO_MODEL_SCHEMA_VERSION;
  scope_id: string;
  option_id: string | null;
  shape: "rectangle";
  length_mm: number;
  projection_mm: number;
  post_height_mm: number;
  fascia_height_mm: number | null;
  riser_height_mm: number | null;
  riser_offset_mm: number | null;
  roof_type: RoofType;
  roof_orientation: GableOrientation | null;
  roof_pitch_deg: number;
  attachment_method: AttachmentType;
  post_count: number;
  frame_material: FrameMaterial;
  roofing_product_id: string;
  roofing_cover_width_mm: number;
  roofing_panel_thickness_mm: number;
  steel_colour: string;
  sheet_colour: string;
  flashing_colour: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integer(value: unknown): value is number {
  return finiteNumber(value) && Number.isInteger(value);
}

function checkString(value: unknown, path: string, errors: string[], allowEmpty = true): void {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    errors.push(`${path} must be ${allowEmpty ? "a string" : "a non-empty string"}`);
  }
}

function checkEnum(value: unknown, allowed: readonly string[], path: string, errors: string[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${path} must be one of: ${allowed.join(", ")}`);
  }
}

function checkMm(value: unknown, path: string, errors: string[], options: { positive?: boolean; max?: number } = {}): void {
  if (!integer(value)) {
    errors.push(`${path} must be an integer millimetre value`);
    return;
  }
  if (options.positive ? value <= 0 : value < 0) errors.push(`${path} is outside its allowed range`);
  if (options.max !== undefined && value > options.max) errors.push(`${path} must be <= ${options.max}mm`);
}

function checkQuantity(value: unknown, path: string, errors: string[], minimum = 0): void {
  if (!integer(value) || value < minimum) errors.push(`${path} must be an integer >= ${minimum}`);
}

function checkSection(value: unknown, path: string, errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  checkString(value.id, `${path}.id`, errors, false);
  checkString(value.label, `${path}.label`, errors, false);
  checkEnum(value.material, ["steel", "timber", "masonry"], `${path}.material`, errors);
  checkMm(value.widthMm, `${path}.widthMm`, errors, { positive: true });
  checkMm(value.depthMm, `${path}.depthMm`, errors, { positive: true });
  if (value.wallThicknessMm !== null && (!finiteNumber(value.wallThicknessMm) || value.wallThicknessMm <= 0)) {
    errors.push(`${path}.wallThicknessMm must be null or a positive millimetre value`);
  }
}

function checkBoolean(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "boolean") errors.push(`${path} must be a boolean`);
}

function checkAttachment(value: unknown, errors: string[]): void {
  if (!isObject(value)) {
    errors.push("attachment must be an object");
    return;
  }
  checkEnum(value.type, ["freestanding", "wall", "fascia", "riser", "flyover"], "attachment.type", errors);
  switch (value.type) {
    case "wall":
      checkMm(value.wallHeightMm, "attachment.wallHeightMm", errors, { positive: true });
      break;
    case "fascia":
      checkMm(value.fasciaHeightMm, "attachment.fasciaHeightMm", errors, { positive: true });
      checkQuantity(value.bracketQuantity, "attachment.bracketQuantity", errors, 2);
      break;
    case "riser":
      checkMm(value.fasciaHeightMm, "attachment.fasciaHeightMm", errors, { positive: true });
      checkMm(value.riserHeightMm, "attachment.riserHeightMm", errors);
      checkMm(value.riserOffsetMm, "attachment.riserOffsetMm", errors);
      checkQuantity(value.riserQuantity, "attachment.riserQuantity", errors, 2);
      checkSection(value.riserSection, "attachment.riserSection", errors);
      break;
    case "flyover":
      checkMm(value.fasciaHeightMm, "attachment.fasciaHeightMm", errors, { positive: true });
      if (!finiteNumber(value.houseRoofPitchDeg) || value.houseRoofPitchDeg <= 0 || value.houseRoofPitchDeg >= 60) {
        errors.push("attachment.houseRoofPitchDeg must be > 0 and < 60 degrees");
      }
      checkMm(value.houseRoofDepthMm, "attachment.houseRoofDepthMm", errors, { positive: true });
      checkMm(value.setbackMm, "attachment.setbackMm", errors);
      checkMm(value.clearanceMm, "attachment.clearanceMm", errors, { positive: true });
      break;
  }
}

function checkPointArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((point, index) => {
    if (!isObject(point)) {
      errors.push(`${path}[${index}] must be an object`);
      return;
    }
    checkMm(point.xMm, `${path}[${index}].xMm`, errors);
    checkMm(point.yMm, `${path}[${index}].yMm`, errors);
  });
}

/** Runtime validation is the trust boundary. UI strings are invalid canonical data. */
export function validatePatioModel(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(value)) return { valid: false, errors: ["model must be an object"] };

  if (value.schemaVersion !== PATIO_MODEL_SCHEMA_VERSION) errors.push(`schemaVersion must be ${PATIO_MODEL_SCHEMA_VERSION}`);
  if (value.units !== "mm") errors.push("units must be mm");
  checkString(value.scopeId, "scopeId", errors, false);
  if (value.optionId !== null) checkString(value.optionId, "optionId", errors, false);
  checkEnum(value.jobType, ["full", "resheet", "partial-sheet", "frame-only", "quote-only"], "jobType", errors);

  if (!isObject(value.footprint)) {
    errors.push("footprint must be an object");
  } else {
    if (value.footprint.type !== "rectangle") errors.push("footprint.type must be rectangle; advanced shapes are not supported by v1");
    checkMm(value.footprint.lengthMm, "footprint.lengthMm", errors, { positive: true });
    checkMm(value.footprint.projectionMm, "footprint.projectionMm", errors, { positive: true });
    checkMm(value.footprint.rearRoofOverhangMm, "footprint.rearRoofOverhangMm", errors, { max: 800 });
    checkMm(value.footprint.endOverhangMm, "footprint.endOverhangMm", errors);
    checkMm(value.footprint.patioPastHouseLeftMm, "footprint.patioPastHouseLeftMm", errors);
    checkMm(value.footprint.patioPastHouseRightMm, "footprint.patioPastHouseRightMm", errors);
    if (finiteNumber(value.footprint.lengthMm) && finiteNumber(value.footprint.endOverhangMm)
      && value.footprint.endOverhangMm * 2 > value.footprint.lengthMm - 200) {
      errors.push("footprint.endOverhangMm must leave at least 200mm between end posts");
    }
  }

  if (!isObject(value.roof)) {
    errors.push("roof must be an object");
  } else {
    checkEnum(value.roof.type, ["skillion", "reverse-skillion", "gable"], "roof.type", errors);
    if (!finiteNumber(value.roof.pitchDeg) || value.roof.pitchDeg <= 0 || value.roof.pitchDeg >= 45) {
      errors.push("roof.pitchDeg must be > 0 and < 45 degrees");
    }
    if (value.roof.type === "gable") {
      checkEnum(value.roof.orientation, ["lengthways", "perpendicular", "house-facing"], "roof.orientation", errors);
      checkMm(value.roof.eaveOverhangMm, "roof.eaveOverhangMm", errors);
    }
  }

  checkAttachment(value.attachment, errors);

  if (!isObject(value.structure)) {
    errors.push("structure must be an object");
  } else {
    checkEnum(value.structure.frameMaterial, ["steel", "timber", "masonry"], "structure.frameMaterial", errors);
    checkMm(value.structure.postHeightMm, "structure.postHeightMm", errors, { positive: true });
    if (!isObject(value.structure.posts)) {
      errors.push("structure.posts must be an object");
    } else {
      checkSection(value.structure.posts.section, "structure.posts.section", errors);
      checkEnum(value.structure.posts.fixing, ["concrete", "base-plate", "stirrup"], "structure.posts.fixing", errors);
      checkMm(value.structure.posts.embedmentMm, "structure.posts.embedmentMm", errors);
      checkQuantity(value.structure.posts.quantity, "structure.posts.quantity", errors, 2);
      const postCount = integer(value.structure.posts.quantity) ? value.structure.posts.quantity : 0;
      if (value.structure.posts.positionsMm !== null) {
        if (!Array.isArray(value.structure.posts.positionsMm) || value.structure.posts.positionsMm.length !== postCount) {
          errors.push("structure.posts.positionsMm must be null or contain one position per post");
        } else {
          value.structure.posts.positionsMm.forEach((position, index) => checkMm(position, `structure.posts.positionsMm[${index}]`, errors));
          if (isObject(value.footprint) && finiteNumber(value.footprint.lengthMm)) {
            value.structure.posts.positionsMm.forEach((position, index) => {
              if (finiteNumber(position) && position > value.footprint.lengthMm) errors.push(`structure.posts.positionsMm[${index}] exceeds footprint length`);
            });
          }
        }
      }
      for (const key of ["frontSetbacksMm", "backSetbacksMm"] as const) {
        const setbacks = value.structure.posts[key];
        if (!Array.isArray(setbacks) || setbacks.length !== postCount) {
          errors.push(`structure.posts.${key} must contain one value per post`);
        } else {
          setbacks.forEach((setback, index) => checkMm(setback, `structure.posts.${key}[${index}]`, errors));
        }
      }
    }
    if (!isObject(value.structure.beams)) {
      errors.push("structure.beams must be an object");
    } else {
      checkSection(value.structure.beams.front, "structure.beams.front", errors);
      checkSection(value.structure.beams.back, "structure.beams.back", errors);
      checkSection(value.structure.beams.fascia, "structure.beams.fascia", errors);
    }
    if (!isObject(value.structure.rafters)) {
      errors.push("structure.rafters must be an object");
    } else {
      checkSection(value.structure.rafters.section, "structure.rafters.section", errors);
      checkMm(value.structure.rafters.spacingMm, "structure.rafters.spacingMm", errors, { positive: true });
      if (value.structure.rafters.quantityOverride !== null) checkQuantity(value.structure.rafters.quantityOverride, "structure.rafters.quantityOverride", errors, 2);
    }
    if (!isObject(value.structure.purlins)) {
      errors.push("structure.purlins must be an object");
    } else {
      checkSection(value.structure.purlins.section, "structure.purlins.section", errors);
      checkQuantity(value.structure.purlins.rowsPerPlane, "structure.purlins.rowsPerPlane", errors);
    }
    if (!isObject(value.structure.trusses)) {
      errors.push("structure.trusses must be an object");
    } else {
      checkQuantity(value.structure.trusses.quantity, "structure.trusses.quantity", errors, 2);
      checkSection(value.structure.trusses.section, "structure.trusses.section", errors);
      checkEnum(value.structure.trusses.webStyle, ["kingpost", "king-verticals", "web"], "structure.trusses.webStyle", errors);
      checkEnum(value.structure.trusses.chord, ["bottom", "mid", "none"], "structure.trusses.chord", errors);
      checkMm(value.structure.trusses.extenderMm, "structure.trusses.extenderMm", errors);
      if (!isObject(value.structure.trusses.heelRisers)) {
        errors.push("structure.trusses.heelRisers must be an object");
      } else {
        checkBoolean(value.structure.trusses.heelRisers.enabled, "structure.trusses.heelRisers.enabled", errors);
        checkEnum(value.structure.trusses.heelRisers.type, ["welded", "separate"], "structure.trusses.heelRisers.type", errors);
        for (const key of ["leftHorizontalMm", "leftVerticalMm", "rightHorizontalMm", "rightVerticalMm"] as const) {
          checkMm(value.structure.trusses.heelRisers[key], `structure.trusses.heelRisers.${key}`, errors);
        }
      }
    }
    checkBoolean(value.structure.externalFrame, "structure.externalFrame", errors);
    if (!isObject(value.structure.tieBeams)) {
      errors.push("structure.tieBeams must be an object");
    } else {
      Object.entries(value.structure.tieBeams).forEach(([key, enabled]) => checkBoolean(enabled, `structure.tieBeams.${key}`, errors));
    }
  }

  if (!isObject(value.roofing)) {
    errors.push("roofing must be an object");
  } else {
    checkString(value.roofing.productId, "roofing.productId", errors, false);
    checkString(value.roofing.profile, "roofing.profile", errors, false);
    checkEnum(value.roofing.material, ["insulated-panel", "steel-sheet", "polycarbonate"], "roofing.material", errors);
    checkMm(value.roofing.coverWidthMm, "roofing.coverWidthMm", errors, { positive: true });
    checkMm(value.roofing.panelThicknessMm, "roofing.panelThicknessMm", errors);
    if (value.roofing.bmtMm !== null && (!finiteNumber(value.roofing.bmtMm) || value.roofing.bmtMm <= 0)) errors.push("roofing.bmtMm must be null or a positive number");
    checkString(value.roofing.colour, "roofing.colour", errors, false);
    checkEnum(value.roofing.ceilingFinish, ["plain", "vj", "cedar"], "roofing.ceilingFinish", errors);
    checkQuantity(value.roofing.skylightCount, "roofing.skylightCount", errors);
    if (!isObject(value.roofing.coverage)) {
      errors.push("roofing.coverage must be an object");
    } else {
      if (!finiteNumber(value.roofing.coverage.fraction) || value.roofing.coverage.fraction <= 0 || value.roofing.coverage.fraction > 1) {
        errors.push("roofing.coverage.fraction must be > 0 and <= 1");
      } else if (value.jobType === "partial-sheet" && value.roofing.coverage.fraction >= 1) {
        errors.push("partial-sheet jobs require roofing.coverage.fraction < 1");
      } else if (value.jobType !== "partial-sheet" && value.roofing.coverage.fraction !== 1) {
        errors.push("only partial-sheet jobs may use roofing.coverage.fraction < 1");
      }
      checkEnum(value.roofing.coverage.openSide, ["left", "right"], "roofing.coverage.openSide", errors);
    }
    if (!isObject(value.roofing.polycarbonate)) {
      errors.push("roofing.polycarbonate must be an object");
    } else {
      checkBoolean(value.roofing.polycarbonate.enabled, "roofing.polycarbonate.enabled", errors);
      if (value.roofing.polycarbonate.brand !== null) checkString(value.roofing.polycarbonate.brand, "roofing.polycarbonate.brand", errors, false);
      if (value.roofing.polycarbonate.tint !== null) checkString(value.roofing.polycarbonate.tint, "roofing.polycarbonate.tint", errors, false);
      if (value.roofing.polycarbonate.patternEvery !== null) checkQuantity(value.roofing.polycarbonate.patternEvery, "roofing.polycarbonate.patternEvery", errors, 2);
      if (value.roofing.polycarbonate.level !== null) checkQuantity(value.roofing.polycarbonate.level, "roofing.polycarbonate.level", errors, 1);
    }
  }

  if (!isObject(value.drainage)) {
    errors.push("drainage must be an object");
  } else {
    for (const key of ["includeGutters", "includeDownpipes", "includeFlashings"] as const) checkBoolean(value.drainage[key], `drainage.${key}`, errors);
    checkEnum(value.drainage.houseGutter, ["none", "quad", "box"], "drainage.houseGutter", errors);
    checkEnum(value.drainage.riserGutter, ["none", "quad", "box"], "drainage.riserGutter", errors);
    if (!Array.isArray(value.drainage.downpipePostIndices)) {
      errors.push("drainage.downpipePostIndices must be an array");
    } else {
      value.drainage.downpipePostIndices.forEach((index, position) => checkQuantity(index, `drainage.downpipePostIndices[${position}]`, errors));
    }
  }

  if (!isObject(value.infill)) {
    errors.push("infill must be an object");
  } else {
    checkEnum(value.infill.gable, ["none", "colorbond", "polycarbonate", "louvre"], "infill.gable", errors);
    checkEnum(value.infill.riser, ["none", "colorbond", "polycarbonate"], "infill.riser", errors);
    checkEnum(value.infill.ceilingFinish, ["plain", "vj", "cedar"], "infill.ceilingFinish", errors);
  }

  if (!isObject(value.finishes)) {
    errors.push("finishes must be an object");
  } else {
    checkString(value.finishes.steelColour, "finishes.steelColour", errors, false);
    checkString(value.finishes.sheetColour, "finishes.sheetColour", errors, false);
    checkString(value.finishes.flashingColour, "finishes.flashingColour", errors, false);
  }

  if (!isObject(value.existingSite)) {
    errors.push("existingSite must be an object");
  } else {
    checkEnum(value.existingSite.condition, ["clear", "existing-patio", "partial-structure", "other"], "existingSite.condition", errors);
    checkString(value.existingSite.demolitionNotes, "existingSite.demolitionNotes", errors);
    checkEnum(value.existingSite.electrical, ["none", "lights", "fan", "both", "other"], "existingSite.electrical", errors);
  }

  if (!isObject(value.services)) {
    errors.push("services must be an object");
  } else {
    for (const key of ["downlights", "fans", "gpos"] as const) {
      const service = value.services[key];
      if (!isObject(service)) errors.push(`services.${key} must be an object`);
      else {
        checkBoolean(service.included, `services.${key}.included`, errors);
        checkQuantity(service.quantity, `services.${key}.quantity`, errors);
      }
    }
    for (const key of ["demolitionIncluded", "skipBinIncluded", "permitIncluded"] as const) checkBoolean(value.services[key], `services.${key}`, errors);
  }

  if (!Array.isArray(value.flashings)) {
    errors.push("flashings must be an array");
  } else {
    value.flashings.forEach((flashing, index) => {
      const path = `flashings[${index}]`;
      if (!isObject(flashing)) {
        errors.push(`${path} must be an object`);
        return;
      }
      checkString(flashing.id, `${path}.id`, errors, false);
      checkString(flashing.name, `${path}.name`, errors, false);
      checkString(flashing.colour, `${path}.colour`, errors, false);
      if (!finiteNumber(flashing.gaugeMm) || flashing.gaugeMm <= 0) errors.push(`${path}.gaugeMm must be positive`);
      checkMm(flashing.lengthMm, `${path}.lengthMm`, errors, { positive: true });
      checkQuantity(flashing.quantity, `${path}.quantity`, errors, 1);
      checkEnum(flashing.colourSide, ["inside", "outside", "both"], `${path}.colourSide`, errors);
      checkPointArray(flashing.pointsMm, `${path}.pointsMm`, errors);
      checkMm(flashing.girthMm, `${path}.girthMm`, errors);
      checkQuantity(flashing.legs, `${path}.legs`, errors);
      if (flashing.startTreatment !== null) checkString(flashing.startTreatment, `${path}.startTreatment`, errors);
      if (flashing.endTreatment !== null) checkString(flashing.endTreatment, `${path}.endTreatment`, errors);
    });
  }

  if (!isObject(value.notes)) {
    errors.push("notes must be an object");
  } else {
    for (const key of ["quote", "workOrder", "materialOrder", "internal", "pricing"] as const) checkString(value.notes[key], `notes.${key}`, errors);
  }

  if (!Array.isArray(value.capabilities)) {
    errors.push("capabilities must be an array");
  } else {
    value.capabilities.forEach((capability, index) => checkEnum(capability, ["rectangle", "skillion", "reverse-skillion", "gable"], `capabilities[${index}]`, errors));
    if (isObject(value.roof) && typeof value.roof.type === "string" && !value.capabilities.includes(value.roof.type)) {
      errors.push("capabilities must include the selected roof type");
    }
    if (!value.capabilities.includes("rectangle")) errors.push("capabilities must include rectangle");
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidPatioModel(value: unknown): asserts value is PatioModelV1 {
  const result = validatePatioModel(value);
  if (!result.valid) throw new TypeError(`Invalid PatioModelV1:\n- ${result.errors.join("\n- ")}`);
}

/** Return a detached, validated canonical model. No coercion or UI-string parsing occurs here. */
export function parsePatioModel(value: unknown): PatioModelV1 {
  assertValidPatioModel(value);
  return JSON.parse(JSON.stringify(value)) as PatioModelV1;
}

/** Structured job_scope columns come only from canonical numeric fields. */
export function deriveStructuredJobScope(model: PatioModelV1): StructuredJobScopeV1 {
  assertValidPatioModel(model);
  const fasciaHeightMm = model.attachment.type === "wall"
    ? model.attachment.wallHeightMm
    : model.attachment.type === "freestanding"
      ? null
      : model.attachment.fasciaHeightMm;
  return {
    schema_version: PATIO_MODEL_SCHEMA_VERSION,
    scope_id: model.scopeId,
    option_id: model.optionId,
    shape: "rectangle",
    length_mm: model.footprint.lengthMm,
    projection_mm: model.footprint.projectionMm,
    post_height_mm: model.structure.postHeightMm,
    fascia_height_mm: fasciaHeightMm,
    riser_height_mm: model.attachment.type === "riser" ? model.attachment.riserHeightMm : null,
    riser_offset_mm: model.attachment.type === "riser" ? model.attachment.riserOffsetMm : null,
    roof_type: model.roof.type,
    roof_orientation: model.roof.type === "gable" ? model.roof.orientation : null,
    roof_pitch_deg: model.roof.pitchDeg,
    attachment_method: model.attachment.type,
    post_count: model.structure.posts.quantity,
    frame_material: model.structure.frameMaterial,
    roofing_product_id: model.roofing.productId,
    roofing_cover_width_mm: model.roofing.coverWidthMm,
    roofing_panel_thickness_mm: model.roofing.panelThicknessMm,
    steel_colour: model.finishes.steelColour,
    sheet_colour: model.finishes.sheetColour,
    flashing_colour: model.finishes.flashingColour
  };
}
