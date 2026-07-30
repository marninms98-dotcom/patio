import {
  PATIO_GEOMETRY_ENGINE_VERSION,
  PATIO_MODEL_SCHEMA_VERSION,
  assertValidPatioModel,
  type Millimetres,
  type PatioModelV1,
  type StructuralSectionV1
} from "./patio-model.ts";

export interface Point3Mm {
  xMm: Millimetres;
  yMm: Millimetres;
  zMm: Millimetres;
}

export type StructuralMemberKind =
  | "post"
  | "beam"
  | "rafter"
  | "purlin"
  | "ridge"
  | "truss-rafter"
  | "truss-chord"
  | "truss-web"
  | "attachment-riser"
  | "tie-beam";

export interface StructuralMemberGeometryV1 {
  id: string;
  kind: StructuralMemberKind;
  role: string;
  section: StructuralSectionV1;
  startMm: Point3Mm;
  endMm: Point3Mm;
  lengthMm: Millimetres;
}

export interface RoofPlaneGeometryV1 {
  id: string;
  role: "single" | "back-slope" | "front-slope" | "left-slope" | "right-slope";
  verticesMm: [Point3Mm, Point3Mm, Point3Mm, Point3Mm];
  pitchDeg: number;
  sheetCount: number;
  sheetRunLengthMm: Millimetres;
  partialSheetWidthMm: Millimetres;
  sheetCoverageAxis: "x" | "z";
  sheetCoverageStartMm: Millimetres;
  sheetCoverageEndMm: Millimetres;
  drainageEdge: "front" | "back" | "left" | "right";
}

export interface GeometryMetricsV1 {
  lengthMm: Millimetres;
  projectionMm: Millimetres;
  pitchDeg: number;
  roofType: PatioModelV1["roof"]["type"];
  frontBeamBottomMm: Millimetres;
  backBeamBottomMm: Millimetres;
  fasciaBeamBottomMm: Millimetres | null;
  frontSupportTopMm: Millimetres;
  backSupportTopMm: Millimetres;
  verticalRiseMm: Millimetres;
  signedBackMinusFrontRiseMm: Millimetres;
  rafterLengthMm: Millimetres;
  ridgeHeightMm: Millimetres | null;
  postCount: number;
  rafterCount: number;
  trussCount: number;
  sheetsPerPlane: number;
  totalSheets: number;
}

export interface PatioGeometryV1 {
  engineVersion: typeof PATIO_GEOMETRY_ENGINE_VERSION;
  modelSchemaVersion: typeof PATIO_MODEL_SCHEMA_VERSION;
  units: "mm";
  coordinateSystem: {
    handedness: "right-handed";
    origin: "back-left-ground";
    xAxis: "patio-length-left-to-right";
    yAxis: "height-above-ground";
    zAxis: "projection-house-to-front";
  };
  keyPoints: Record<string, Point3Mm>;
  frame: {
    posts: StructuralMemberGeometryV1[];
    beams: StructuralMemberGeometryV1[];
    rafters: StructuralMemberGeometryV1[];
    purlins: StructuralMemberGeometryV1[];
    trussMembers: StructuralMemberGeometryV1[];
    attachmentMembers: StructuralMemberGeometryV1[];
  };
  roofPlanes: RoofPlaneGeometryV1[];
  metrics: GeometryMetricsV1;
}

interface SupportHeights {
  frontBeamBottomMm: number;
  backBeamBottomMm: number;
  fasciaBeamBottomMm: number | null;
  pitchRiseMm: number;
}

const round = (value: number, places = 3): number => {
  const factor = 10 ** places;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const asMm = (value: number): Millimetres => round(value) as Millimetres;
const point = (xMm: number, yMm: number, zMm: number): Point3Mm => ({
  xMm: asMm(xMm),
  yMm: asMm(yMm),
  zMm: asMm(zMm)
});

const distance = (startMm: Point3Mm, endMm: Point3Mm): Millimetres => asMm(Math.hypot(
  endMm.xMm - startMm.xMm,
  endMm.yMm - startMm.yMm,
  endMm.zMm - startMm.zMm
));

function member(
  id: string,
  kind: StructuralMemberKind,
  role: string,
  section: StructuralSectionV1,
  startMm: Point3Mm,
  endMm: Point3Mm
): StructuralMemberGeometryV1 {
  return { id, kind, role, section, startMm, endMm, lengthMm: distance(startMm, endMm) };
}

function pitchRise(spanMm: number, pitchDeg: number): number {
  return spanMm * Math.tan(pitchDeg * Math.PI / 180);
}

/**
 * Height rules intentionally mirror the current rectangular legacy calculation.
 * Values are beam-bottom/post-top datums; section depth is added separately for support tops.
 */
function calculateSupportHeights(model: PatioModelV1): SupportHeights {
  const projectionMm = model.footprint.projectionMm;
  const riseMm = pitchRise(projectionMm, model.roof.pitchDeg);
  const postHeightMm = model.structure.postHeightMm;
  const fasciaBeamDepthMm = model.structure.beams.fascia.depthMm;
  let frontBeamBottomMm = postHeightMm;
  let backBeamBottomMm = postHeightMm;
  let fasciaBeamBottomMm: number | null = null;

  if (model.roof.type === "gable") {
    switch (model.attachment.type) {
      case "freestanding":
        break;
      case "wall":
        frontBeamBottomMm = model.attachment.wallHeightMm;
        backBeamBottomMm = model.attachment.wallHeightMm;
        break;
      case "fascia": {
        fasciaBeamBottomMm = model.attachment.fasciaHeightMm - 155;
        const doglegVerticalMm = model.structure.trusses.heelRisers.enabled
          ? model.structure.trusses.heelRisers.leftVerticalMm
          : 300;
        const elevatedMm = fasciaBeamBottomMm + doglegVerticalMm + fasciaBeamDepthMm;
        frontBeamBottomMm = elevatedMm;
        backBeamBottomMm = elevatedMm;
        break;
      }
      case "riser": {
        fasciaBeamBottomMm = model.attachment.fasciaHeightMm - 155;
        const elevatedMm = model.attachment.fasciaHeightMm
          + fasciaBeamDepthMm
          + model.attachment.riserSection.widthMm
          + model.attachment.riserHeightMm;
        frontBeamBottomMm = elevatedMm;
        backBeamBottomMm = elevatedMm;
        break;
      }
      case "flyover": {
        fasciaBeamBottomMm = model.attachment.fasciaHeightMm;
        const roofHeightAtPostMm = pitchRise(model.attachment.setbackMm, model.attachment.houseRoofPitchDeg);
        const flyoverMm = model.attachment.fasciaHeightMm + roofHeightAtPostMm + model.attachment.clearanceMm;
        frontBeamBottomMm = flyoverMm;
        backBeamBottomMm = flyoverMm;
        break;
      }
    }
    return { frontBeamBottomMm, backBeamBottomMm, fasciaBeamBottomMm, pitchRiseMm: pitchRise(gableSpanMm(model), model.roof.pitchDeg) / 2 };
  }

  const reverse = model.roof.type === "reverse-skillion";
  switch (model.attachment.type) {
    case "freestanding":
      if (reverse) frontBeamBottomMm = postHeightMm + riseMm;
      else backBeamBottomMm = postHeightMm + riseMm;
      break;
    case "wall":
      backBeamBottomMm = model.attachment.wallHeightMm;
      frontBeamBottomMm = reverse ? backBeamBottomMm + riseMm : backBeamBottomMm - riseMm;
      break;
    case "fascia":
      fasciaBeamBottomMm = model.attachment.fasciaHeightMm - 155;
      backBeamBottomMm = fasciaBeamBottomMm;
      frontBeamBottomMm = reverse ? backBeamBottomMm + riseMm : backBeamBottomMm - riseMm;
      break;
    case "riser":
      fasciaBeamBottomMm = model.attachment.fasciaHeightMm - 155;
      backBeamBottomMm = model.attachment.fasciaHeightMm
        + fasciaBeamDepthMm
        + model.attachment.riserSection.widthMm
        + model.attachment.riserHeightMm;
      frontBeamBottomMm = reverse ? backBeamBottomMm + riseMm : backBeamBottomMm - riseMm;
      break;
    case "flyover": {
      fasciaBeamBottomMm = model.attachment.fasciaHeightMm;
      const roofHeightAtPostMm = pitchRise(model.attachment.setbackMm, model.attachment.houseRoofPitchDeg);
      backBeamBottomMm = model.attachment.fasciaHeightMm + roofHeightAtPostMm + model.attachment.clearanceMm;
      frontBeamBottomMm = reverse ? backBeamBottomMm + riseMm : backBeamBottomMm - riseMm;
      break;
    }
  }
  return { frontBeamBottomMm, backBeamBottomMm, fasciaBeamBottomMm, pitchRiseMm: riseMm };
}

function gableSpanMm(model: PatioModelV1): number {
  if (model.roof.type !== "gable") return model.footprint.projectionMm;
  return model.roof.orientation === "lengthways"
    ? model.footprint.projectionMm
    : model.footprint.lengthMm;
}

function gableDistributionMm(model: PatioModelV1): number {
  if (model.roof.type !== "gable") return model.footprint.lengthMm;
  return model.roof.orientation === "lengthways"
    ? model.footprint.lengthMm
    : model.footprint.projectionMm;
}

function evenPositions(lengthMm: number, quantity: number): number[] {
  if (quantity <= 1) return [lengthMm / 2];
  return Array.from({ length: quantity }, (_, index) => round(lengthMm * index / (quantity - 1)));
}

export function calculatePostPositionsMm(model: PatioModelV1): Millimetres[] {
  const layout = model.structure.posts;
  if (layout.positionsMm) return layout.positionsMm.map((value) => asMm(value));
  const insetMm = Math.min(
    model.footprint.endOverhangMm,
    Math.max(0, model.footprint.lengthMm / 2 - 100)
  );
  const supportedLengthMm = model.footprint.lengthMm - insetMm * 2;
  return evenPositions(supportedLengthMm, layout.quantity).map((offset) => asMm(insetMm + offset));
}

export function calculateRafterLayout(lengthMm: number, spacingMm: number, quantityOverride: number | null): { quantity: number; spacingMm: Millimetres } {
  const quantity = quantityOverride && quantityOverride > 0
    ? quantityOverride
    : Math.max(2, Math.floor(lengthMm / Math.max(300, spacingMm)) + 1);
  return {
    quantity,
    spacingMm: asMm(quantity > 1 ? Math.round(lengthMm / (quantity - 1)) : lengthMm)
  };
}

function sheetLayout(distributionMm: number, coverWidthMm: number): { count: number; partialWidthMm: Millimetres } {
  if (distributionMm <= 0) return { count: 0, partialWidthMm: asMm(0) };
  const count = Math.ceil(distributionMm / coverWidthMm);
  const remainder = distributionMm - coverWidthMm * (count - 1);
  return { count, partialWidthMm: asMm(remainder === coverWidthMm ? 0 : remainder) };
}

function sheetCoverage(model: PatioModelV1, distributionMm: number): { startMm: Millimetres; endMm: Millimetres; coveredMm: number } {
  if (model.jobType === "frame-only" || model.jobType === "quote-only") {
    return { startMm: asMm(0), endMm: asMm(0), coveredMm: 0 };
  }
  const coveredMm = distributionMm * model.roofing.coverage.fraction;
  const startMm = model.roofing.coverage.openSide === "left" ? distributionMm - coveredMm : 0;
  return { startMm: asMm(startMm), endMm: asMm(startMm + coveredMm), coveredMm };
}

function addPerimeterBeams(
  model: PatioModelV1,
  heights: SupportHeights,
  beams: StructuralMemberGeometryV1[]
): void {
  const lengthMm = model.footprint.lengthMm;
  const projectionMm = model.footprint.projectionMm;
  beams.push(member(
    "beam-front",
    "beam",
    "front-support",
    model.structure.beams.front,
    point(0, heights.frontBeamBottomMm, projectionMm),
    point(lengthMm, heights.frontBeamBottomMm, projectionMm)
  ));

  const hasBackBeam = model.attachment.type === "freestanding"
    || model.attachment.type === "riser"
    || model.attachment.type === "flyover"
    || model.roof.type === "gable";
  if (hasBackBeam) {
    const backZMm = model.attachment.type === "riser" ? model.attachment.riserOffsetMm : 0;
    beams.push(member(
      "beam-back",
      "beam",
      "back-support",
      model.structure.beams.back,
      point(0, heights.backBeamBottomMm, backZMm),
      point(lengthMm, heights.backBeamBottomMm, backZMm)
    ));
  }

  if (heights.fasciaBeamBottomMm !== null && model.attachment.type !== "flyover") {
    beams.push(member(
      "beam-fascia",
      "beam",
      "house-fascia",
      model.structure.beams.fascia,
      point(0, heights.fasciaBeamBottomMm, 0),
      point(lengthMm, heights.fasciaBeamBottomMm, 0)
    ));
  }

  if (model.roof.type === "gable" && model.roof.orientation !== "lengthways") {
    const eaveBottomMm = (heights.frontBeamBottomMm + heights.backBeamBottomMm) / 2;
    beams.push(member(
      "beam-eave-left",
      "beam",
      "left-eave-support",
      model.structure.beams.front,
      point(0, eaveBottomMm, 0),
      point(0, eaveBottomMm, projectionMm)
    ));
    beams.push(member(
      "beam-eave-right",
      "beam",
      "right-eave-support",
      model.structure.beams.front,
      point(lengthMm, eaveBottomMm, 0),
      point(lengthMm, eaveBottomMm, projectionMm)
    ));
  }
}

function addPosts(
  model: PatioModelV1,
  heights: SupportHeights,
  posts: StructuralMemberGeometryV1[]
): void {
  const projectionMm = model.footprint.projectionMm;
  const positionsMm = calculatePostPositionsMm(model);
  positionsMm.forEach((xMm, index) => {
    const setbackMm = Math.min(model.structure.posts.frontSetbacksMm[index] ?? 0, projectionMm);
    const fraction = projectionMm === 0 ? 0 : setbackMm / projectionMm;
    const topMm = heights.frontBeamBottomMm + fraction * (heights.backBeamBottomMm - heights.frontBeamBottomMm);
    posts.push(member(
      `post-front-${index + 1}`,
      "post",
      "front-row",
      model.structure.posts.section,
      point(xMm, 0, projectionMm - setbackMm),
      point(xMm, topMm, projectionMm - setbackMm)
    ));
  });

  if (model.attachment.type === "freestanding") {
    positionsMm.forEach((xMm, index) => {
      const setbackMm = Math.min(model.structure.posts.backSetbacksMm[index] ?? 0, projectionMm);
      const fraction = projectionMm === 0 ? 0 : setbackMm / projectionMm;
      const topMm = heights.backBeamBottomMm + fraction * (heights.frontBeamBottomMm - heights.backBeamBottomMm);
      posts.push(member(
        `post-back-${index + 1}`,
        "post",
        "back-row",
        model.structure.posts.section,
        point(xMm, 0, setbackMm),
        point(xMm, topMm, setbackMm)
      ));
    });
  } else {
    if (model.footprint.patioPastHouseLeftMm > 0) {
      posts.push(member(
        "post-back-overhang-left",
        "post",
        "back-overhang",
        model.structure.posts.section,
        point(0, 0, 0),
        point(0, heights.backBeamBottomMm, 0)
      ));
    }
    if (model.footprint.patioPastHouseRightMm > 0) {
      posts.push(member(
        "post-back-overhang-right",
        "post",
        "back-overhang",
        model.structure.posts.section,
        point(model.footprint.lengthMm, 0, 0),
        point(model.footprint.lengthMm, heights.backBeamBottomMm, 0)
      ));
    }
  }
}

function addAttachmentMembers(
  model: PatioModelV1,
  heights: SupportHeights,
  attachmentMembers: StructuralMemberGeometryV1[]
): void {
  if (model.attachment.type !== "riser" || heights.fasciaBeamBottomMm === null) return;
  const positionsMm = evenPositions(model.footprint.lengthMm, model.attachment.riserQuantity);
  const baseMm = heights.fasciaBeamBottomMm + model.structure.beams.fascia.depthMm;
  const topMm = heights.backBeamBottomMm;
  positionsMm.forEach((xMm, index) => {
    attachmentMembers.push(member(
      `attachment-riser-${index + 1}`,
      "attachment-riser",
      "riser",
      model.attachment.riserSection,
      point(xMm, baseMm, model.attachment.riserOffsetMm),
      point(xMm, topMm, model.attachment.riserOffsetMm)
    ));
  });
}

function addTieBeams(
  model: PatioModelV1,
  heights: SupportHeights,
  attachmentMembers: StructuralMemberGeometryV1[]
): void {
  if (model.roof.type === "gable") return;
  const add = (side: "left" | "right", enabled: boolean): void => {
    if (!enabled) return;
    const xMm = side === "left" ? 0 : model.footprint.lengthMm;
    attachmentMembers.push(member(
      `tie-beam-${side}`,
      "tie-beam",
      `${side}-end-horizontal-tie`,
      model.structure.beams.front,
      point(xMm, heights.frontBeamBottomMm, 0),
      point(xMm, heights.frontBeamBottomMm, model.footprint.projectionMm)
    ));
  };
  add("left", model.structure.tieBeams.left);
  add("right", model.structure.tieBeams.right);
}

function skillionGeometry(
  model: PatioModelV1,
  heights: SupportHeights,
  rafters: StructuralMemberGeometryV1[],
  purlins: StructuralMemberGeometryV1[]
): { roofPlanes: RoofPlaneGeometryV1[]; rafterCount: number; rafterLengthMm: number; sheetCount: number; keyPoints: Record<string, Point3Mm> } {
  const lengthMm = model.footprint.lengthMm;
  const projectionMm = model.footprint.projectionMm;
  const rearOverhangMm = model.attachment.type === "freestanding" ? 0 : model.footprint.rearRoofOverhangMm;
  const frontTopMm = heights.frontBeamBottomMm + model.structure.beams.front.depthMm;
  const backTopMm = heights.backBeamBottomMm + model.structure.beams.back.depthMm;
  const reverse = model.roof.type === "reverse-skillion";
  const overhangDeltaMm = pitchRise(rearOverhangMm, model.roof.pitchDeg) * (reverse ? -1 : 1);
  const roofBackZMm = -rearOverhangMm;
  const roofBackHeightMm = backTopMm + overhangDeltaMm;
  const slopeRunMm = projectionMm + rearOverhangMm;
  const rafterLengthMm = Math.hypot(slopeRunMm, frontTopMm - roofBackHeightMm);
  const rafterLayout = calculateRafterLayout(lengthMm, model.structure.rafters.spacingMm, model.structure.rafters.quantityOverride);
  const renderRafters = model.structure.externalFrame || model.roofing.material !== "insulated-panel";
  if (renderRafters) {
    evenPositions(lengthMm, rafterLayout.quantity).forEach((xMm, index) => {
      rafters.push(member(
        `rafter-${index + 1}`,
        "rafter",
        "roof-rafter",
        model.structure.rafters.section,
        point(xMm, roofBackHeightMm, roofBackZMm),
        point(xMm, frontTopMm, projectionMm)
      ));
    });
  }

  for (let row = 1; row <= model.structure.purlins.rowsPerPlane; row += 1) {
    const fraction = row / (model.structure.purlins.rowsPerPlane + 1);
    const zMm = roofBackZMm + slopeRunMm * fraction;
    const yMm = roofBackHeightMm + (frontTopMm - roofBackHeightMm) * fraction;
    purlins.push(member(
      `purlin-${row}`,
      "purlin",
      "roof-purlin",
      model.structure.purlins.section,
      point(0, yMm, zMm),
      point(lengthMm, yMm, zMm)
    ));
  }

  const coverage = sheetCoverage(model, lengthMm);
  const sheets = sheetLayout(coverage.coveredMm, model.roofing.coverWidthMm);
  const plane: RoofPlaneGeometryV1 = {
    id: "roof-plane-1",
    role: "single",
    verticesMm: [
      point(0, roofBackHeightMm, roofBackZMm),
      point(lengthMm, roofBackHeightMm, roofBackZMm),
      point(lengthMm, frontTopMm, projectionMm),
      point(0, frontTopMm, projectionMm)
    ],
    pitchDeg: model.roof.pitchDeg,
    sheetCount: sheets.count,
    sheetRunLengthMm: asMm(rafterLengthMm),
    partialSheetWidthMm: sheets.partialWidthMm,
    sheetCoverageAxis: "x",
    sheetCoverageStartMm: coverage.startMm,
    sheetCoverageEndMm: coverage.endMm,
    drainageEdge: reverse ? "back" : "front"
  };
  return {
    roofPlanes: [plane],
    rafterCount: renderRafters ? rafterLayout.quantity : 0,
    rafterLengthMm,
    sheetCount: sheets.count,
    keyPoints: {
      roofBackLeft: plane.verticesMm[0],
      roofBackRight: plane.verticesMm[1],
      roofFrontRight: plane.verticesMm[2],
      roofFrontLeft: plane.verticesMm[3]
    }
  };
}

function addTrussWebs(
  model: PatioModelV1,
  trussIndex: number,
  axisPositionMm: number,
  eaveA: Point3Mm,
  ridge: Point3Mm,
  eaveB: Point3Mm,
  trussMembers: StructuralMemberGeometryV1[]
): void {
  const section = model.structure.trusses.section;
  const horizontalAxis = model.roof.type === "gable" && model.roof.orientation === "lengthways" ? "z" : "x";
  const chordHeightMm = (eaveA.yMm + eaveB.yMm) / 2;
  const at = (horizontalMm: number, yMm: number): Point3Mm => horizontalAxis === "z"
    ? point(axisPositionMm, yMm, horizontalMm)
    : point(horizontalMm, yMm, axisPositionMm);
  const spanStart = horizontalAxis === "z" ? eaveA.zMm : eaveA.xMm;
  const spanEnd = horizontalAxis === "z" ? eaveB.zMm : eaveB.xMm;
  const spanMid = (spanStart + spanEnd) / 2;

  if (model.structure.trusses.chord !== "none") {
    const chordY = model.structure.trusses.chord === "bottom"
      ? chordHeightMm
      : chordHeightMm + (ridge.yMm - chordHeightMm) / 2;
    trussMembers.push(member(
      `truss-${trussIndex}-chord`,
      "truss-chord",
      model.structure.trusses.chord,
      section,
      at(spanStart, chordY),
      at(spanEnd, chordY)
    ));
  }

  trussMembers.push(member(
    `truss-${trussIndex}-web-king`,
    "truss-web",
    "king-post",
    section,
    at(spanMid, chordHeightMm),
    at(spanMid, ridge.yMm)
  ));

  if (model.structure.trusses.webStyle === "king-verticals") {
    [0.25, 0.75].forEach((fraction, index) => {
      const horizontalMm = spanStart + (spanEnd - spanStart) * fraction;
      const roofY = chordHeightMm + (ridge.yMm - chordHeightMm) * (fraction <= 0.5 ? fraction * 2 : (1 - fraction) * 2);
      trussMembers.push(member(
        `truss-${trussIndex}-web-vertical-${index + 1}`,
        "truss-web",
        "vertical",
        section,
        at(horizontalMm, chordHeightMm),
        at(horizontalMm, roofY)
      ));
    });
  } else if (model.structure.trusses.webStyle === "web") {
    const quarterA = spanStart + (spanEnd - spanStart) * 0.25;
    const quarterB = spanStart + (spanEnd - spanStart) * 0.75;
    trussMembers.push(member(`truss-${trussIndex}-web-1`, "truss-web", "diagonal", section, at(spanStart, chordHeightMm), at(quarterA, chordHeightMm + (ridge.yMm - chordHeightMm) / 2)));
    trussMembers.push(member(`truss-${trussIndex}-web-2`, "truss-web", "diagonal", section, at(quarterA, chordHeightMm), at(spanMid, ridge.yMm)));
    trussMembers.push(member(`truss-${trussIndex}-web-3`, "truss-web", "diagonal", section, at(spanMid, ridge.yMm), at(quarterB, chordHeightMm)));
    trussMembers.push(member(`truss-${trussIndex}-web-4`, "truss-web", "diagonal", section, at(quarterB, chordHeightMm + (ridge.yMm - chordHeightMm) / 2), at(spanEnd, chordHeightMm)));
  }
}

function gableGeometry(
  model: PatioModelV1,
  heights: SupportHeights,
  purlins: StructuralMemberGeometryV1[],
  trussMembers: StructuralMemberGeometryV1[]
): { roofPlanes: RoofPlaneGeometryV1[]; rafterLengthMm: number; sheetCount: number; keyPoints: Record<string, Point3Mm> } {
  if (model.roof.type !== "gable") throw new TypeError("gableGeometry requires a gable roof");
  const lengthMm = model.footprint.lengthMm;
  const projectionMm = model.footprint.projectionMm;
  const orientation = model.roof.orientation;
  const spanMm = gableSpanMm(model);
  const distributionMm = gableDistributionMm(model);
  const eaveReferenceMm = (
    heights.frontBeamBottomMm + model.structure.beams.front.depthMm
    + heights.backBeamBottomMm + model.structure.beams.back.depthMm
  ) / 2;
  const riseMm = pitchRise(spanMm / 2, model.roof.pitchDeg);
  const ridgeHeightMm = eaveReferenceMm + riseMm;
  const rafterLengthMm = Math.hypot(spanMm / 2, riseMm);
  const eaveOverhangMm = model.roof.eaveOverhangMm;
  const roofEaveHeightMm = eaveReferenceMm - pitchRise(eaveOverhangMm, model.roof.pitchDeg);
  const sheetRunLengthMm = rafterLengthMm + eaveOverhangMm / Math.cos(model.roof.pitchDeg * Math.PI / 180);
  const sheetDistributionMm = distributionMm;
  const coverage = sheetCoverage(model, sheetDistributionMm);
  const sheets = sheetLayout(coverage.coveredMm, model.roofing.coverWidthMm);
  const roofPlanes: RoofPlaneGeometryV1[] = [];
  const keyPoints: Record<string, Point3Mm> = {};

  if (orientation === "lengthways") {
    const ridgeZMm = projectionMm / 2;
    const backPlane: RoofPlaneGeometryV1 = {
      id: "roof-plane-back",
      role: "back-slope",
      verticesMm: [
        point(0, roofEaveHeightMm, -eaveOverhangMm),
        point(lengthMm, roofEaveHeightMm, -eaveOverhangMm),
        point(lengthMm, ridgeHeightMm, ridgeZMm),
        point(0, ridgeHeightMm, ridgeZMm)
      ],
      pitchDeg: model.roof.pitchDeg,
      sheetCount: sheets.count,
      sheetRunLengthMm: asMm(sheetRunLengthMm),
      partialSheetWidthMm: sheets.partialWidthMm,
      sheetCoverageAxis: "x",
      sheetCoverageStartMm: coverage.startMm,
      sheetCoverageEndMm: coverage.endMm,
      drainageEdge: "back"
    };
    const frontPlane: RoofPlaneGeometryV1 = {
      id: "roof-plane-front",
      role: "front-slope",
      verticesMm: [
        point(0, ridgeHeightMm, ridgeZMm),
        point(lengthMm, ridgeHeightMm, ridgeZMm),
        point(lengthMm, roofEaveHeightMm, projectionMm + eaveOverhangMm),
        point(0, roofEaveHeightMm, projectionMm + eaveOverhangMm)
      ],
      pitchDeg: model.roof.pitchDeg,
      sheetCount: sheets.count,
      sheetRunLengthMm: asMm(sheetRunLengthMm),
      partialSheetWidthMm: sheets.partialWidthMm,
      sheetCoverageAxis: "x",
      sheetCoverageStartMm: coverage.startMm,
      sheetCoverageEndMm: coverage.endMm,
      drainageEdge: "front"
    };
    roofPlanes.push(backPlane, frontPlane);
    keyPoints.ridgeStart = point(0, ridgeHeightMm, ridgeZMm);
    keyPoints.ridgeEnd = point(lengthMm, ridgeHeightMm, ridgeZMm);

    evenPositions(lengthMm, model.structure.trusses.quantity).forEach((xMm, index) => {
      const number = index + 1;
      const backEave = point(xMm, eaveReferenceMm, 0);
      const ridge = point(xMm, ridgeHeightMm, ridgeZMm);
      const frontEave = point(xMm, eaveReferenceMm, projectionMm);
      trussMembers.push(member(`truss-${number}-rafter-back`, "truss-rafter", "back-slope", model.structure.trusses.section, backEave, ridge));
      trussMembers.push(member(`truss-${number}-rafter-front`, "truss-rafter", "front-slope", model.structure.trusses.section, ridge, frontEave));
      addTrussWebs(model, number, xMm, backEave, ridge, frontEave, trussMembers);
    });
    trussMembers.push(member("ridge", "ridge", "ridge", model.structure.trusses.section, keyPoints.ridgeStart, keyPoints.ridgeEnd));

    for (const side of ["back", "front"] as const) {
      for (let row = 1; row <= model.structure.purlins.rowsPerPlane; row += 1) {
        const fraction = row / (model.structure.purlins.rowsPerPlane + 1);
        const zMm = side === "back" ? ridgeZMm * fraction : ridgeZMm + ridgeZMm * fraction;
        const yMm = side === "back"
          ? eaveReferenceMm + riseMm * fraction
          : ridgeHeightMm - riseMm * fraction;
        purlins.push(member(
          `purlin-${side}-${row}`,
          "purlin",
          `${side}-slope-purlin`,
          model.structure.purlins.section,
          point(0, yMm, zMm),
          point(lengthMm, yMm, zMm)
        ));
      }
    }
  } else {
    const ridgeXMm = lengthMm / 2;
    const leftPlane: RoofPlaneGeometryV1 = {
      id: "roof-plane-left",
      role: "left-slope",
      verticesMm: [
        point(-eaveOverhangMm, roofEaveHeightMm, 0),
        point(ridgeXMm, ridgeHeightMm, 0),
        point(ridgeXMm, ridgeHeightMm, projectionMm),
        point(-eaveOverhangMm, roofEaveHeightMm, projectionMm)
      ],
      pitchDeg: model.roof.pitchDeg,
      sheetCount: sheets.count,
      sheetRunLengthMm: asMm(sheetRunLengthMm),
      partialSheetWidthMm: sheets.partialWidthMm,
      sheetCoverageAxis: "z",
      sheetCoverageStartMm: coverage.startMm,
      sheetCoverageEndMm: coverage.endMm,
      drainageEdge: "left"
    };
    const rightPlane: RoofPlaneGeometryV1 = {
      id: "roof-plane-right",
      role: "right-slope",
      verticesMm: [
        point(ridgeXMm, ridgeHeightMm, 0),
        point(lengthMm + eaveOverhangMm, roofEaveHeightMm, 0),
        point(lengthMm + eaveOverhangMm, roofEaveHeightMm, projectionMm),
        point(ridgeXMm, ridgeHeightMm, projectionMm)
      ],
      pitchDeg: model.roof.pitchDeg,
      sheetCount: sheets.count,
      sheetRunLengthMm: asMm(sheetRunLengthMm),
      partialSheetWidthMm: sheets.partialWidthMm,
      sheetCoverageAxis: "z",
      sheetCoverageStartMm: coverage.startMm,
      sheetCoverageEndMm: coverage.endMm,
      drainageEdge: "right"
    };
    roofPlanes.push(leftPlane, rightPlane);
    keyPoints.ridgeStart = point(ridgeXMm, ridgeHeightMm, 0);
    keyPoints.ridgeEnd = point(ridgeXMm, ridgeHeightMm, projectionMm);

    evenPositions(projectionMm, model.structure.trusses.quantity).forEach((zMm, index) => {
      const number = index + 1;
      const leftEave = point(0, eaveReferenceMm, zMm);
      const ridge = point(ridgeXMm, ridgeHeightMm, zMm);
      const rightEave = point(lengthMm, eaveReferenceMm, zMm);
      trussMembers.push(member(`truss-${number}-rafter-left`, "truss-rafter", "left-slope", model.structure.trusses.section, leftEave, ridge));
      trussMembers.push(member(`truss-${number}-rafter-right`, "truss-rafter", "right-slope", model.structure.trusses.section, ridge, rightEave));
      addTrussWebs(model, number, zMm, leftEave, ridge, rightEave, trussMembers);
    });
    trussMembers.push(member("ridge", "ridge", "ridge", model.structure.trusses.section, keyPoints.ridgeStart, keyPoints.ridgeEnd));

    for (const side of ["left", "right"] as const) {
      for (let row = 1; row <= model.structure.purlins.rowsPerPlane; row += 1) {
        const fraction = row / (model.structure.purlins.rowsPerPlane + 1);
        const xMm = side === "left" ? ridgeXMm * fraction : ridgeXMm + ridgeXMm * fraction;
        const yMm = side === "left"
          ? eaveReferenceMm + riseMm * fraction
          : ridgeHeightMm - riseMm * fraction;
        purlins.push(member(
          `purlin-${side}-${row}`,
          "purlin",
          `${side}-slope-purlin`,
          model.structure.purlins.section,
          point(xMm, yMm, 0),
          point(xMm, yMm, projectionMm)
        ));
      }
    }
  }

  return {
    roofPlanes,
    rafterLengthMm,
    sheetCount: sheets.count,
    keyPoints
  };
}

/** Pure deterministic conversion from validated PatioModelV1 to millimetre geometry. */
export function computePatioGeometry(model: PatioModelV1): PatioGeometryV1 {
  assertValidPatioModel(model);
  const heights = calculateSupportHeights(model);
  const posts: StructuralMemberGeometryV1[] = [];
  const beams: StructuralMemberGeometryV1[] = [];
  const rafters: StructuralMemberGeometryV1[] = [];
  const purlins: StructuralMemberGeometryV1[] = [];
  const trussMembers: StructuralMemberGeometryV1[] = [];
  const attachmentMembers: StructuralMemberGeometryV1[] = [];

  addPosts(model, heights, posts);
  addPerimeterBeams(model, heights, beams);
  addAttachmentMembers(model, heights, attachmentMembers);
  addTieBeams(model, heights, attachmentMembers);

  const frontTopMm = heights.frontBeamBottomMm + model.structure.beams.front.depthMm;
  const backTopMm = heights.backBeamBottomMm + model.structure.beams.back.depthMm;
  const commonKeyPoints: Record<string, Point3Mm> = {
    origin: point(0, 0, 0),
    backRightGround: point(model.footprint.lengthMm, 0, 0),
    frontLeftGround: point(0, 0, model.footprint.projectionMm),
    frontRightGround: point(model.footprint.lengthMm, 0, model.footprint.projectionMm),
    backLeftSupportTop: point(0, backTopMm, 0),
    backRightSupportTop: point(model.footprint.lengthMm, backTopMm, 0),
    frontLeftSupportTop: point(0, frontTopMm, model.footprint.projectionMm),
    frontRightSupportTop: point(model.footprint.lengthMm, frontTopMm, model.footprint.projectionMm)
  };

  let roofPlanes: RoofPlaneGeometryV1[];
  let roofKeyPoints: Record<string, Point3Mm>;
  let rafterLengthMm: number;
  let rafterCount = 0;
  let trussCount = 0;
  let sheetsPerPlane: number;
  if (model.roof.type === "gable") {
    const result = gableGeometry(model, heights, purlins, trussMembers);
    roofPlanes = result.roofPlanes;
    roofKeyPoints = result.keyPoints;
    rafterLengthMm = result.rafterLengthMm;
    trussCount = model.structure.trusses.quantity;
    sheetsPerPlane = result.sheetCount;
  } else {
    const result = skillionGeometry(model, heights, rafters, purlins);
    roofPlanes = result.roofPlanes;
    roofKeyPoints = result.keyPoints;
    rafterLengthMm = result.rafterLengthMm;
    rafterCount = result.rafterCount;
    sheetsPerPlane = result.sheetCount;
  }

  const verticalRiseMm = model.roof.type === "gable"
    ? pitchRise(gableSpanMm(model) / 2, model.roof.pitchDeg)
    : Math.abs(heights.backBeamBottomMm - heights.frontBeamBottomMm);
  const ridgeHeightMm = model.roof.type === "gable" ? roofKeyPoints.ridgeStart.yMm : null;

  return {
    engineVersion: PATIO_GEOMETRY_ENGINE_VERSION,
    modelSchemaVersion: PATIO_MODEL_SCHEMA_VERSION,
    units: "mm",
    coordinateSystem: {
      handedness: "right-handed",
      origin: "back-left-ground",
      xAxis: "patio-length-left-to-right",
      yAxis: "height-above-ground",
      zAxis: "projection-house-to-front"
    },
    keyPoints: { ...commonKeyPoints, ...roofKeyPoints },
    frame: { posts, beams, rafters, purlins, trussMembers, attachmentMembers },
    roofPlanes,
    metrics: {
      lengthMm: asMm(model.footprint.lengthMm),
      projectionMm: asMm(model.footprint.projectionMm),
      pitchDeg: round(model.roof.pitchDeg, 6),
      roofType: model.roof.type,
      frontBeamBottomMm: asMm(heights.frontBeamBottomMm),
      backBeamBottomMm: asMm(heights.backBeamBottomMm),
      fasciaBeamBottomMm: heights.fasciaBeamBottomMm === null ? null : asMm(heights.fasciaBeamBottomMm),
      frontSupportTopMm: asMm(frontTopMm),
      backSupportTopMm: asMm(backTopMm),
      verticalRiseMm: asMm(verticalRiseMm),
      signedBackMinusFrontRiseMm: asMm(heights.backBeamBottomMm - heights.frontBeamBottomMm),
      rafterLengthMm: asMm(rafterLengthMm),
      ridgeHeightMm,
      postCount: posts.length,
      rafterCount,
      trussCount,
      sheetsPerPlane,
      totalSheets: sheetsPerPlane * roofPlanes.length
    }
  };
}
