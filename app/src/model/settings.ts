export interface CornerRadii {
  frontLeft: number;
  frontRight: number;
  backRight: number;
  backLeft: number;
}

export type CornerMode = 'rounded' | 'chamfer' | 'square';
export type TunnelAxis = 'depth' | 'width';
export type GroundPreset = 'sand' | 'dirt' | 'algae' | 'gravel';
export type WaterSurfacePreset = 'calm' | 'realistic' | 'balanced' | 'cartoon' | 'pixel';
export type AquariumProfile = 'standard' | 'belowFloor' | 'touchPool';
export type FootprintType = 'rectangle' | 'lShape' | 'uShape';

export interface CornerModes {
  frontLeft: CornerMode;
  frontRight: CornerMode;
  backRight: CornerMode;
  backLeft: CornerMode;
}

export type ShapeCornerKey =
  | 'lBackLeft'
  | 'lBackRight'
  | 'lOuterRight'
  | 'lInnerElbow'
  | 'lFrontRight'
  | 'lFrontLeft'
  | 'uBackLeft'
  | 'uBackRight'
  | 'uFrontRight'
  | 'uMouthRight'
  | 'uInnerRight'
  | 'uInnerLeft'
  | 'uMouthLeft'
  | 'uFrontLeft';

export type ShapeCornerRadii = Record<ShapeCornerKey, number>;
export type ShapeCornerModes = Record<ShapeCornerKey, CornerMode>;

export const L_SHAPE_CORNER_KEYS: ShapeCornerKey[] = [
  'lBackLeft', 'lBackRight', 'lOuterRight', 'lInnerElbow', 'lFrontRight', 'lFrontLeft',
];

export const U_SHAPE_CORNER_KEYS: ShapeCornerKey[] = [
  'uBackLeft', 'uBackRight', 'uFrontRight', 'uMouthRight',
  'uInnerRight', 'uInnerLeft', 'uMouthLeft', 'uFrontLeft',
];

export const SHAPE_CORNER_LABELS: Record<ShapeCornerKey, string> = {
  lBackLeft: 'Back left',
  lBackRight: 'Back right',
  lOuterRight: 'Outer shoulder',
  lInnerElbow: 'Inner elbow',
  lFrontRight: 'Front right',
  lFrontLeft: 'Front left',
  uBackLeft: 'Back left',
  uBackRight: 'Back right',
  uFrontRight: 'Front right',
  uMouthRight: 'Right mouth',
  uInnerRight: 'Inner right',
  uInnerLeft: 'Inner left',
  uMouthLeft: 'Left mouth',
  uFrontLeft: 'Front left',
};

export function activeShapeCornerKeys(footprint: FootprintType): ShapeCornerKey[] {
  if (footprint === 'lShape') return L_SHAPE_CORNER_KEYS;
  if (footprint === 'uShape') return U_SHAPE_CORNER_KEYS;
  return [];
}

export interface AquariumSettings {
  width: number;
  depth: number;
  height: number;
  profile: AquariumProfile;
  footprint: FootprintType;
  radii: CornerRadii;
  cornerModes: CornerModes;
  shapeCornerRadii: ShapeCornerRadii;
  shapeCornerModes: ShapeCornerModes;
  curveSegments: number;
  baseHeight: number;
  bottomRimHeight: number;
  topRimHeight: number;
  baseOverhang: number;
  frameOverhang: number;
  frameOverlap: number;
  glassThickness: number;

  depthBelowFloor: number;
  heightAboveFloor: number;
  floorRimHeight: number;
  subFloorBodyColor: string;

  // Canonical arm measurements used by the geometry.
  lArmWidth: number;
  lRearDepth: number;
  uLeftArmWidth: number;
  uRightArmWidth: number;
  uBackDepth: number;
  // Derived opening measurements exposed by the UI for direct editing.
  lOpeningWidth: number;
  lOpeningDepth: number;
  uOpeningWidth: number;
  uOpeningDepth: number;
  uOpeningOffset: number;

  touchPoolHeight: number;
  touchWaterDepth: number;
  touchRimHeight: number;
  touchRimWidth: number;
  touchPedestalHeight: number;
  touchBasinInset: number;

  groundPreset: GroundPreset;
  sandHeight: number;
  sandWallGap: number;
  sandColor: string;
  sandVariation: number;
  sandGrain: number;
  sandSeed: number;
  groundIrregularity: number;
  groundMoundSize: number;
  groundMoundCount: number;
  groundTerrainDetail: number;

  waterLevel: number;
  waterWallGap: number;
  waterColor: string;
  waterTint: number;
  waveStrength: number;
  waterSurfaceStyle: number;
  waterWaveScale: number;
  waterSurfacePreset: WaterSurfacePreset;
  waterSeed: number;

  tunnelEnabled: boolean;
  tunnelAxis: TunnelAxis;
  tunnelOffset: number;
  tunnelWidth: number;
  tunnelWallHeight: number;
  tunnelRoundness: number;
  tunnelGlassThickness: number;
  tunnelCurveSegments: number;
  tunnelEndExtension: number;
  portalFrameWidth: number;
  portalFrameDepth: number;
  tunnelWaterClearance: number;
  tunnelGlassFloor: boolean;
  tunnelSideRimWidth: number;
  tunnelBridgeRimHeight: number;
  tunnelBridgeSeparatorSpacing: number;
  tunnelBridgeSeparatorWidth: number;

  exportScale: number;
}

const defaultShapeCornerRadii: ShapeCornerRadii = {
  lBackLeft: 0.42,
  lBackRight: 0.42,
  lOuterRight: 0.34,
  lInnerElbow: 0.58,
  lFrontRight: 0.34,
  lFrontLeft: 0.42,
  uBackLeft: 0.42,
  uBackRight: 0.42,
  uFrontRight: 0.34,
  uMouthRight: 0.26,
  uInnerRight: 0.52,
  uInnerLeft: 0.52,
  uMouthLeft: 0.26,
  uFrontLeft: 0.34,
};

const defaultShapeCornerModes: ShapeCornerModes = Object.fromEntries(
  (Object.keys(defaultShapeCornerRadii) as ShapeCornerKey[]).map((key) => [key, 'rounded']),
) as ShapeCornerModes;

export const DEFAULT_SETTINGS: AquariumSettings = {
  width: 10,
  depth: 4.8,
  height: 4.15,
  profile: 'standard',
  footprint: 'rectangle',
  radii: {
    frontLeft: 0.58,
    frontRight: 0.58,
    backRight: 0.16,
    backLeft: 0.16,
  },
  cornerModes: {
    frontLeft: 'rounded',
    frontRight: 'rounded',
    backRight: 'rounded',
    backLeft: 'rounded',
  },
  shapeCornerRadii: { ...defaultShapeCornerRadii },
  shapeCornerModes: { ...defaultShapeCornerModes },
  curveSegments: 6,
  baseHeight: 0.075,
  bottomRimHeight: 0.075,
  topRimHeight: 0.095,
  baseOverhang: 0.1,
  frameOverhang: 0.055,
  frameOverlap: 0.045,
  glassThickness: 0.055,

  depthBelowFloor: 3.35,
  heightAboveFloor: 1.12,
  floorRimHeight: 0.075,
  subFloorBodyColor: '#525a62',

  lArmWidth: 3.55,
  lRearDepth: 2.9,
  uLeftArmWidth: 2.45,
  uRightArmWidth: 2.45,
  uBackDepth: 2.2,
  lOpeningWidth: 6.45,
  lOpeningDepth: 1.9,
  uOpeningWidth: 5.1,
  uOpeningDepth: 2.6,
  uOpeningOffset: 0,

  touchPoolHeight: 0.5,
  touchWaterDepth: 0.28,
  touchRimHeight: 0.075,
  touchRimWidth: 0.26,
  touchPedestalHeight: 0,
  touchBasinInset: 0.24,

  groundPreset: 'sand',
  sandHeight: 0.07,
  sandWallGap: 0.045,
  sandColor: '#c8ad79',
  sandVariation: 0.22,
  sandGrain: 0.52,
  sandSeed: 13579,
  groundIrregularity: 0.045,
  groundMoundSize: 1.35,
  groundMoundCount: 3,
  groundTerrainDetail: 2,

  waterLevel: 0.91,
  waterWallGap: 0.018,
  waterColor: '#2a9ed6',
  waterTint: 0.68,
  waveStrength: 0.58,
  waterSurfaceStyle: 0.24,
  waterWaveScale: 0.46,
  waterSurfacePreset: 'balanced',
  waterSeed: 94817,

  tunnelEnabled: false,
  tunnelAxis: 'depth',
  tunnelOffset: 0,
  tunnelWidth: 2.45,
  tunnelWallHeight: 1.02,
  tunnelRoundness: 0.86,
  tunnelGlassThickness: 0.075,
  tunnelCurveSegments: 12,
  tunnelEndExtension: 0.2,
  portalFrameWidth: 0.14,
  portalFrameDepth: 0.2,
  tunnelWaterClearance: 0.025,
  tunnelGlassFloor: true,
  tunnelSideRimWidth: 0.1,
  tunnelBridgeRimHeight: 0.085,
  tunnelBridgeSeparatorSpacing: 1.2,
  tunnelBridgeSeparatorWidth: 0.035,

  exportScale: 10,
};

export function cloneSettings(source: AquariumSettings = DEFAULT_SETTINGS): AquariumSettings {
  return {
    ...source,
    radii: { ...source.radii },
    cornerModes: { ...source.cornerModes },
    shapeCornerRadii: { ...source.shapeCornerRadii },
    shapeCornerModes: { ...source.shapeCornerModes },
  };
}

function isTunnelAxis(value: unknown): value is TunnelAxis {
  return value === 'depth' || value === 'width';
}

function isGroundPreset(value: unknown): value is GroundPreset {
  return value === 'sand' || value === 'dirt' || value === 'algae' || value === 'gravel';
}

function isWaterSurfacePreset(value: unknown): value is WaterSurfacePreset {
  return value === 'calm' || value === 'realistic' || value === 'balanced' || value === 'cartoon' || value === 'pixel';
}

function isCornerMode(value: unknown): value is CornerMode {
  return value === 'rounded' || value === 'chamfer' || value === 'square';
}

function isProfile(value: unknown): value is AquariumProfile {
  return value === 'standard' || value === 'belowFloor' || value === 'touchPool';
}

function isFootprint(value: unknown): value is FootprintType {
  return value === 'rectangle' || value === 'lShape' || value === 'uShape';
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export function tunnelAllowed(settings: AquariumSettings): boolean {
  return settings.profile !== 'touchPool';
}

/**
 * Slider ranges are intentionally comfortable editing ranges, not hard model
 * limits. Typed values may exceed those ranges whenever the resulting geometry
 * is still physically meaningful. Only semantic values (percentages, segment
 * counts, and values that must fit inside the tank) receive upper bounds here.
 */
export function normalizeSettings(settings: AquariumSettings): AquariumSettings {
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
  const atLeast = (value: number, minimum: number, fallback = minimum) => Math.max(minimum, finite(value, fallback));
  const clamp = (value: number, min: number, max: number, fallback = min) => Math.min(max, Math.max(min, finite(value, fallback)));

  if (!isProfile(settings.profile)) settings.profile = 'standard';
  if (!isFootprint(settings.footprint)) settings.footprint = 'rectangle';

  settings.width = atLeast(settings.width, 0.8, DEFAULT_SETTINGS.width);
  settings.depth = atLeast(settings.depth, 0.8, DEFAULT_SETTINGS.depth);
  settings.height = atLeast(settings.height, 0.25, DEFAULT_SETTINGS.height);
  settings.depthBelowFloor = atLeast(settings.depthBelowFloor, 0.05, DEFAULT_SETTINGS.depthBelowFloor);
  settings.heightAboveFloor = atLeast(settings.heightAboveFloor, 0.08, DEFAULT_SETTINGS.heightAboveFloor);
  settings.floorRimHeight = clamp(settings.floorRimHeight, 0.005, Math.max(0.01, settings.heightAboveFloor * 0.5), DEFAULT_SETTINGS.floorRimHeight);
  if (!isHexColor(settings.subFloorBodyColor)) settings.subFloorBodyColor = DEFAULT_SETTINGS.subFloorBodyColor;

  const minDimension = Math.min(settings.width, settings.depth);
  const maxRadius = Math.max(0.02, minDimension * 0.49);
  settings.curveSegments = Math.round(clamp(settings.curveSegments, 2, 64, DEFAULT_SETTINGS.curveSegments));

  for (const key of Object.keys(settings.radii) as Array<keyof CornerRadii>) {
    settings.radii[key] = clamp(settings.radii[key], 0.002, maxRadius, DEFAULT_SETTINGS.radii[key]);
    if (!isCornerMode(settings.cornerModes[key])) settings.cornerModes[key] = 'rounded';
  }

  for (const key of Object.keys(DEFAULT_SETTINGS.shapeCornerRadii) as ShapeCornerKey[]) {
    settings.shapeCornerRadii[key] = clamp(settings.shapeCornerRadii[key], 0.002, maxRadius, DEFAULT_SETTINGS.shapeCornerRadii[key]);
    if (!isCornerMode(settings.shapeCornerModes[key])) settings.shapeCornerModes[key] = 'rounded';
  }

  settings.lArmWidth = clamp(settings.lArmWidth, 0.12, Math.max(0.13, settings.width - 0.12), DEFAULT_SETTINGS.lArmWidth);
  settings.lRearDepth = clamp(settings.lRearDepth, 0.12, Math.max(0.13, settings.depth - 0.12), DEFAULT_SETTINGS.lRearDepth);
  settings.lOpeningWidth = Math.max(0.12, settings.width - settings.lArmWidth);
  settings.lOpeningDepth = Math.max(0.12, settings.depth - settings.lRearDepth);

  settings.uLeftArmWidth = atLeast(settings.uLeftArmWidth, 0.1, DEFAULT_SETTINGS.uLeftArmWidth);
  settings.uRightArmWidth = atLeast(settings.uRightArmWidth, 0.1, DEFAULT_SETTINGS.uRightArmWidth);
  const maxArmTotal = Math.max(0.2, settings.width - 0.2);
  if (settings.uLeftArmWidth + settings.uRightArmWidth > maxArmTotal) {
    const scale = maxArmTotal / Math.max(settings.uLeftArmWidth + settings.uRightArmWidth, 1e-6);
    settings.uLeftArmWidth *= scale;
    settings.uRightArmWidth *= scale;
  }
  settings.uBackDepth = clamp(settings.uBackDepth, 0.12, Math.max(0.13, settings.depth - 0.12), DEFAULT_SETTINGS.uBackDepth);
  settings.uOpeningWidth = Math.max(0.2, settings.width - settings.uLeftArmWidth - settings.uRightArmWidth);
  settings.uOpeningDepth = Math.max(0.12, settings.depth - settings.uBackDepth);
  settings.uOpeningOffset = (settings.uLeftArmWidth - settings.uRightArmWidth) * 0.5;

  settings.touchPoolHeight = atLeast(settings.touchPoolHeight, 0.16, DEFAULT_SETTINGS.touchPoolHeight);
  settings.touchRimHeight = clamp(settings.touchRimHeight, 0.015, Math.max(0.02, settings.touchPoolHeight * 0.42), DEFAULT_SETTINGS.touchRimHeight);
  settings.touchRimWidth = clamp(settings.touchRimWidth, 0.04, Math.max(0.05, minDimension * 0.34), DEFAULT_SETTINGS.touchRimWidth);
  settings.touchPedestalHeight = clamp(settings.touchPedestalHeight, 0, Math.max(0, settings.touchPoolHeight - 0.12), DEFAULT_SETTINGS.touchPedestalHeight);
  settings.touchBasinInset = clamp(settings.touchBasinInset, 0.02, Math.max(0.03, minDimension * 0.35), DEFAULT_SETTINGS.touchBasinInset);
  settings.touchWaterDepth = clamp(settings.touchWaterDepth, 0.03, Math.max(0.04, settings.touchPoolHeight - settings.touchRimHeight - 0.035), DEFAULT_SETTINGS.touchWaterDepth);

  settings.baseHeight = atLeast(settings.baseHeight, 0.005, DEFAULT_SETTINGS.baseHeight);
  settings.bottomRimHeight = atLeast(settings.bottomRimHeight, 0.005, DEFAULT_SETTINGS.bottomRimHeight);
  settings.topRimHeight = atLeast(settings.topRimHeight, 0.005, DEFAULT_SETTINGS.topRimHeight);
  settings.glassThickness = clamp(settings.glassThickness, 0.003, Math.max(0.004, minDimension * 0.18), DEFAULT_SETTINGS.glassThickness);
  settings.baseOverhang = atLeast(settings.baseOverhang, 0, DEFAULT_SETTINGS.baseOverhang);
  settings.frameOverhang = atLeast(settings.frameOverhang, 0, DEFAULT_SETTINGS.frameOverhang);
  settings.frameOverlap = clamp(settings.frameOverlap, 0.002, Math.max(0.003, minDimension * 0.18), DEFAULT_SETTINGS.frameOverlap);

  const activeHeight = settings.profile === 'belowFloor'
    ? settings.heightAboveFloor + settings.depthBelowFloor
    : settings.profile === 'touchPool'
      ? settings.touchPoolHeight
      : settings.height;
  const structuralHeight = settings.baseHeight + settings.bottomRimHeight + settings.topRimHeight;
  if (settings.profile !== 'touchPool' && structuralHeight > activeHeight * 0.42) {
    const ratio = (activeHeight * 0.42) / structuralHeight;
    settings.baseHeight *= ratio;
    settings.bottomRimHeight *= ratio;
    settings.topRimHeight *= ratio;
  }

  if (!isGroundPreset(settings.groundPreset)) settings.groundPreset = 'sand';
  settings.sandHeight = clamp(settings.sandHeight, 0.005, Math.max(0.01, activeHeight * 0.2), DEFAULT_SETTINGS.sandHeight);
  settings.sandWallGap = clamp(settings.sandWallGap, 0.002, Math.max(0.003, minDimension * 0.12), DEFAULT_SETTINGS.sandWallGap);
  settings.sandVariation = clamp(settings.sandVariation, 0, 1, DEFAULT_SETTINGS.sandVariation);
  settings.sandGrain = clamp(settings.sandGrain, 0.02, 20, DEFAULT_SETTINGS.sandGrain);
  settings.groundIrregularity = clamp(settings.groundIrregularity, 0, Math.max(0.001, activeHeight * 0.3), DEFAULT_SETTINGS.groundIrregularity);
  settings.groundMoundSize = atLeast(settings.groundMoundSize, 0.05, DEFAULT_SETTINGS.groundMoundSize);
  settings.groundMoundCount = Math.round(clamp(settings.groundMoundCount, 1, 50, DEFAULT_SETTINGS.groundMoundCount));
  settings.groundTerrainDetail = Math.round(clamp(settings.groundTerrainDetail, 0, 4, DEFAULT_SETTINGS.groundTerrainDetail));
  if (!isHexColor(settings.sandColor)) settings.sandColor = DEFAULT_SETTINGS.sandColor;

  settings.waterLevel = clamp(settings.waterLevel, 0.05, 0.985, DEFAULT_SETTINGS.waterLevel);
  settings.waterWallGap = clamp(settings.waterWallGap, 0.001, Math.max(0.002, minDimension * 0.12), DEFAULT_SETTINGS.waterWallGap);
  settings.waterTint = clamp(settings.waterTint, 0, 1, DEFAULT_SETTINGS.waterTint);
  settings.waveStrength = clamp(settings.waveStrength, 0, 1, DEFAULT_SETTINGS.waveStrength);
  settings.waterSurfaceStyle = clamp(settings.waterSurfaceStyle, 0, 1, DEFAULT_SETTINGS.waterSurfaceStyle);
  settings.waterWaveScale = clamp(settings.waterWaveScale, 0, 1, DEFAULT_SETTINGS.waterWaveScale);
  if (!isWaterSurfacePreset(settings.waterSurfacePreset)) settings.waterSurfacePreset = DEFAULT_SETTINGS.waterSurfacePreset;
  if (!isHexColor(settings.waterColor)) settings.waterColor = DEFAULT_SETTINGS.waterColor;

  settings.tunnelEnabled = Boolean(settings.tunnelEnabled) && tunnelAllowed(settings);
  if (!isTunnelAxis(settings.tunnelAxis)) settings.tunnelAxis = 'depth';
  const tunnelCrossDimension = settings.tunnelAxis === 'depth' ? settings.width : settings.depth;
  settings.tunnelWidth = clamp(settings.tunnelWidth, 0.2, Math.max(0.21, tunnelCrossDimension - 0.12), DEFAULT_SETTINGS.tunnelWidth);
  const tunnelHeightBasis = settings.profile === 'belowFloor' ? settings.heightAboveFloor + 0.35 : settings.height;
  settings.tunnelWallHeight = clamp(settings.tunnelWallHeight, 0.15, Math.max(0.16, tunnelHeightBasis * 0.82), DEFAULT_SETTINGS.tunnelWallHeight);
  settings.tunnelRoundness = clamp(settings.tunnelRoundness, 0, 4, DEFAULT_SETTINGS.tunnelRoundness);
  settings.tunnelGlassThickness = clamp(settings.tunnelGlassThickness, 0.005, Math.max(0.006, settings.tunnelWidth * 0.2), DEFAULT_SETTINGS.tunnelGlassThickness);
  settings.tunnelCurveSegments = Math.round(clamp(settings.tunnelCurveSegments, 3, 64, DEFAULT_SETTINGS.tunnelCurveSegments));
  settings.tunnelEndExtension = atLeast(settings.tunnelEndExtension, 0, DEFAULT_SETTINGS.tunnelEndExtension);
  settings.portalFrameWidth = clamp(settings.portalFrameWidth, 0.005, Math.max(0.006, settings.tunnelWidth * 0.35), DEFAULT_SETTINGS.portalFrameWidth);
  settings.portalFrameDepth = atLeast(settings.portalFrameDepth, 0.005, DEFAULT_SETTINGS.portalFrameDepth);
  settings.tunnelWaterClearance = clamp(settings.tunnelWaterClearance, 0.001, Math.max(0.002, settings.tunnelWidth * 0.12), DEFAULT_SETTINGS.tunnelWaterClearance);
  settings.tunnelGlassFloor = Boolean(settings.tunnelGlassFloor);
  settings.tunnelSideRimWidth = clamp(settings.tunnelSideRimWidth, 0.005, Math.max(0.006, settings.tunnelWidth * 0.25), DEFAULT_SETTINGS.tunnelSideRimWidth);
  settings.tunnelBridgeRimHeight = clamp(settings.tunnelBridgeRimHeight, 0.01, Math.max(0.02, settings.tunnelWallHeight * 0.4), DEFAULT_SETTINGS.tunnelBridgeRimHeight);
  settings.tunnelBridgeSeparatorSpacing = atLeast(settings.tunnelBridgeSeparatorSpacing, 0.15, DEFAULT_SETTINGS.tunnelBridgeSeparatorSpacing);
  settings.tunnelBridgeSeparatorWidth = clamp(
    settings.tunnelBridgeSeparatorWidth,
    0.004,
    Math.max(0.005, settings.tunnelBridgeSeparatorSpacing * 0.4),
    DEFAULT_SETTINGS.tunnelBridgeSeparatorWidth,
  );
  const tunnelEdgeMargin = settings.glassThickness + settings.portalFrameWidth + settings.tunnelGlassThickness + 0.04;
  const maxTunnelOffset = Math.max(0, tunnelCrossDimension * 0.5 - settings.tunnelWidth * 0.5 - tunnelEdgeMargin);
  settings.tunnelOffset = clamp(settings.tunnelOffset, -maxTunnelOffset, maxTunnelOffset, DEFAULT_SETTINGS.tunnelOffset);

  settings.exportScale = atLeast(settings.exportScale, 0.001, DEFAULT_SETTINGS.exportScale);
  return settings;
}
