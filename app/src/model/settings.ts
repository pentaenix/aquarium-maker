export interface CornerRadii {
  frontLeft: number;
  frontRight: number;
  backRight: number;
  backLeft: number;
}

export type CornerMode = 'rounded' | 'chamfer' | 'square';
export type TunnelAxis = 'depth' | 'width';
export type GroundPreset = 'sand' | 'dirt' | 'algae' | 'gravel';
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

  lArmWidth: number;
  lRearDepth: number;
  uLeftArmWidth: number;
  uRightArmWidth: number;
  uBackDepth: number;

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

export function normalizeSettings(settings: AquariumSettings): AquariumSettings {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

  if (!isProfile(settings.profile)) settings.profile = 'standard';
  if (!isFootprint(settings.footprint)) settings.footprint = 'rectangle';

  settings.width = clamp(settings.width, 2, 30);
  settings.depth = clamp(settings.depth, 1, 15);
  settings.height = clamp(settings.height, 0.5, 12);
  settings.depthBelowFloor = clamp(settings.depthBelowFloor, 0.2, 12);
  settings.heightAboveFloor = clamp(settings.heightAboveFloor, 0.25, 6);
  settings.floorRimHeight = clamp(settings.floorRimHeight, 0.02, 0.35);
  if (!isHexColor(settings.subFloorBodyColor)) settings.subFloorBodyColor = DEFAULT_SETTINGS.subFloorBodyColor;

  const minDimension = Math.min(settings.width, settings.depth);
  const maxRadius = Math.max(0.02, minDimension * 0.49);
  settings.curveSegments = Math.round(clamp(settings.curveSegments, 2, 16));

  for (const key of Object.keys(settings.radii) as Array<keyof CornerRadii>) {
    settings.radii[key] = clamp(settings.radii[key], 0.002, maxRadius);
    if (!isCornerMode(settings.cornerModes[key])) settings.cornerModes[key] = 'rounded';
  }

  for (const key of Object.keys(DEFAULT_SETTINGS.shapeCornerRadii) as ShapeCornerKey[]) {
    settings.shapeCornerRadii[key] = clamp(settings.shapeCornerRadii[key], 0.002, maxRadius);
    if (!isCornerMode(settings.shapeCornerModes[key])) settings.shapeCornerModes[key] = 'rounded';
  }

  settings.lArmWidth = clamp(settings.lArmWidth, 0.8, settings.width - 0.8);
  settings.lRearDepth = clamp(settings.lRearDepth, 0.8, settings.depth - 0.8);
  settings.uLeftArmWidth = clamp(settings.uLeftArmWidth, 0.55, settings.width * 0.45);
  settings.uRightArmWidth = clamp(settings.uRightArmWidth, 0.55, settings.width * 0.45);
  if (settings.uLeftArmWidth + settings.uRightArmWidth > settings.width - 0.9) {
    const scale = (settings.width - 0.9) / (settings.uLeftArmWidth + settings.uRightArmWidth);
    settings.uLeftArmWidth *= scale;
    settings.uRightArmWidth *= scale;
  }
  settings.uBackDepth = clamp(settings.uBackDepth, 0.7, settings.depth - 0.7);

  settings.touchPoolHeight = clamp(settings.touchPoolHeight, 0.25, 1.8);
  settings.touchRimHeight = clamp(settings.touchRimHeight, 0.03, Math.min(0.3, settings.touchPoolHeight * 0.35));
  settings.touchRimWidth = clamp(settings.touchRimWidth, 0.08, minDimension * 0.22);
  settings.touchPedestalHeight = clamp(settings.touchPedestalHeight, 0, Math.max(0, settings.touchPoolHeight - 0.2));
  settings.touchBasinInset = clamp(settings.touchBasinInset, 0.05, minDimension * 0.28);
  settings.touchWaterDepth = clamp(settings.touchWaterDepth, 0.08, Math.max(0.1, settings.touchPoolHeight - settings.touchRimHeight - 0.08));

  settings.baseHeight = clamp(settings.baseHeight, 0.02, 0.5);
  settings.bottomRimHeight = clamp(settings.bottomRimHeight, 0.02, 0.5);
  settings.topRimHeight = clamp(settings.topRimHeight, 0.02, 0.6);
  settings.glassThickness = clamp(settings.glassThickness, 0.01, minDimension * 0.12);
  settings.baseOverhang = clamp(settings.baseOverhang, 0, 0.5);
  settings.frameOverhang = clamp(settings.frameOverhang, 0, 0.3);
  settings.frameOverlap = clamp(settings.frameOverlap, 0.01, 0.3);

  const activeHeight = settings.profile === 'belowFloor'
    ? settings.heightAboveFloor + settings.depthBelowFloor
    : settings.profile === 'touchPool'
      ? settings.touchPoolHeight
      : settings.height;
  const structuralHeight = settings.baseHeight + settings.bottomRimHeight + settings.topRimHeight;
  if (settings.profile !== 'touchPool' && structuralHeight > activeHeight * 0.35) {
    const ratio = (activeHeight * 0.35) / structuralHeight;
    settings.baseHeight *= ratio;
    settings.bottomRimHeight *= ratio;
    settings.topRimHeight *= ratio;
  }

  if (!isGroundPreset(settings.groundPreset)) settings.groundPreset = 'sand';
  settings.sandHeight = clamp(settings.sandHeight, 0.02, Math.max(0.03, activeHeight * 0.15));
  settings.sandWallGap = clamp(settings.sandWallGap, 0.01, 0.3);
  settings.sandVariation = clamp(settings.sandVariation, 0, 1);
  settings.sandGrain = clamp(settings.sandGrain, 0.1, 2.5);
  settings.groundIrregularity = clamp(settings.groundIrregularity, 0, Math.min(0.6, activeHeight * 0.25));
  settings.groundMoundSize = clamp(settings.groundMoundSize, 0.25, Math.max(0.5, minDimension * 0.8));
  settings.groundMoundCount = Math.round(clamp(settings.groundMoundCount, 1, 10));
  settings.groundTerrainDetail = Math.round(clamp(settings.groundTerrainDetail, 0, 3));
  if (!isHexColor(settings.sandColor)) settings.sandColor = DEFAULT_SETTINGS.sandColor;

  settings.waterLevel = clamp(settings.waterLevel, 0.2, 0.97);
  settings.waterWallGap = clamp(settings.waterWallGap, 0.005, 0.2);
  settings.waterTint = clamp(settings.waterTint, 0, 1);
  settings.waveStrength = clamp(settings.waveStrength, 0, 1);
  settings.waterSurfaceStyle = clamp(settings.waterSurfaceStyle, 0, 1);
  settings.waterWaveScale = clamp(settings.waterWaveScale, 0, 1);
  if (!isHexColor(settings.waterColor)) settings.waterColor = DEFAULT_SETTINGS.waterColor;

  settings.tunnelEnabled = Boolean(settings.tunnelEnabled) && tunnelAllowed(settings);
  if (!isTunnelAxis(settings.tunnelAxis)) settings.tunnelAxis = 'depth';
  const tunnelCrossDimension = settings.tunnelAxis === 'depth' ? settings.width : settings.depth;
  settings.tunnelWidth = clamp(settings.tunnelWidth, 0.8, Math.max(0.9, tunnelCrossDimension - 0.5));
  const tunnelHeightBasis = settings.profile === 'belowFloor' ? settings.heightAboveFloor + 0.35 : settings.height;
  settings.tunnelWallHeight = clamp(settings.tunnelWallHeight, 0.35, Math.max(0.45, tunnelHeightBasis * 0.65));
  settings.tunnelRoundness = clamp(settings.tunnelRoundness, 0, 1.35);
  settings.tunnelGlassThickness = clamp(settings.tunnelGlassThickness, 0.025, 0.25);
  settings.tunnelCurveSegments = Math.round(clamp(settings.tunnelCurveSegments, 5, 24));
  settings.tunnelEndExtension = clamp(settings.tunnelEndExtension, 0, 0.8);
  settings.portalFrameWidth = clamp(settings.portalFrameWidth, 0.04, 0.45);
  settings.portalFrameDepth = clamp(settings.portalFrameDepth, 0.04, 0.65);
  settings.tunnelWaterClearance = clamp(settings.tunnelWaterClearance, 0.005, 0.12);
  settings.tunnelGlassFloor = Boolean(settings.tunnelGlassFloor);
  settings.tunnelSideRimWidth = clamp(settings.tunnelSideRimWidth, 0.03, 0.35);
  const tunnelEdgeMargin = settings.glassThickness + settings.portalFrameWidth + settings.tunnelGlassThickness + 0.12;
  const maxTunnelOffset = Math.max(0, tunnelCrossDimension * 0.5 - settings.tunnelWidth * 0.5 - tunnelEdgeMargin);
  settings.tunnelOffset = clamp(settings.tunnelOffset, -maxTunnelOffset, maxTunnelOffset);

  settings.exportScale = clamp(settings.exportScale, 1, 100);
  return settings;
}
