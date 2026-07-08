export interface CornerRadii {
  frontLeft: number;
  frontRight: number;
  backRight: number;
  backLeft: number;
}

export type CornerMode = 'rounded' | 'chamfer' | 'square';

export interface CornerModes {
  frontLeft: CornerMode;
  frontRight: CornerMode;
  backRight: CornerMode;
  backLeft: CornerMode;
}

export interface AquariumSettings {
  width: number;
  depth: number;
  height: number;
  radii: CornerRadii;
  cornerModes: CornerModes;
  curveSegments: number;
  baseHeight: number;
  bottomRimHeight: number;
  topRimHeight: number;
  baseOverhang: number;
  frameOverhang: number;
  frameOverlap: number;
  glassThickness: number;

  sandHeight: number;
  sandWallGap: number;
  sandColor: string;
  sandVariation: number;
  sandGrain: number;
  sandSeed: number;

  waterLevel: number;
  waterWallGap: number;
  waterColor: string;
  waterTint: number;
  waveStrength: number;
  waterSurfaceStyle: number;
  waterWaveScale: number;
  waterSeed: number;

  tunnelEnabled: boolean;
  tunnelWidth: number;
  tunnelWallHeight: number;
  tunnelRoundness: number;
  tunnelGlassThickness: number;
  tunnelCurveSegments: number;
  tunnelEndExtension: number;
  portalFrameWidth: number;
  portalFrameDepth: number;
  tunnelWaterClearance: number;

  exportScale: number;
}

export const DEFAULT_SETTINGS: AquariumSettings = {
  width: 10,
  depth: 4.8,
  height: 4.15,
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
  curveSegments: 6,
  baseHeight: 0.075,
  bottomRimHeight: 0.075,
  topRimHeight: 0.095,
  baseOverhang: 0.1,
  frameOverhang: 0.055,
  frameOverlap: 0.045,
  glassThickness: 0.055,

  sandHeight: 0.07,
  sandWallGap: 0.045,
  sandColor: '#c8ad79',
  sandVariation: 0.22,
  sandGrain: 0.52,
  sandSeed: 13579,

  waterLevel: 0.91,
  waterWallGap: 0.018,
  waterColor: '#2a9ed6',
  waterTint: 0.68,
  waveStrength: 0.58,
  waterSurfaceStyle: 0.24,
  waterWaveScale: 0.46,
  waterSeed: 94817,

  tunnelEnabled: false,
  tunnelWidth: 2.45,
  tunnelWallHeight: 1.02,
  tunnelRoundness: 0.86,
  tunnelGlassThickness: 0.075,
  tunnelCurveSegments: 12,
  tunnelEndExtension: 0.2,
  portalFrameWidth: 0.14,
  portalFrameDepth: 0.2,
  tunnelWaterClearance: 0.025,

  exportScale: 10,
};

export function cloneSettings(source: AquariumSettings = DEFAULT_SETTINGS): AquariumSettings {
  return {
    ...source,
    radii: { ...source.radii },
    cornerModes: { ...source.cornerModes },
  };
}

function isCornerMode(value: unknown): value is CornerMode {
  return value === 'rounded' || value === 'chamfer' || value === 'square';
}

export function normalizeSettings(settings: AquariumSettings): AquariumSettings {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  settings.width = clamp(settings.width, 2, 30);
  settings.depth = clamp(settings.depth, 1, 15);
  settings.height = clamp(settings.height, 1, 12);
  const minDimension = Math.min(settings.width, settings.depth);
  const maxRadius = Math.max(0.02, minDimension * 0.49);
  settings.curveSegments = Math.round(clamp(settings.curveSegments, 2, 16));

  for (const key of Object.keys(settings.radii) as Array<keyof CornerRadii>) {
    settings.radii[key] = clamp(settings.radii[key], 0.01, maxRadius);
    if (!isCornerMode(settings.cornerModes[key])) settings.cornerModes[key] = 'rounded';
  }

  settings.baseHeight = clamp(settings.baseHeight, 0.02, 0.5);
  settings.bottomRimHeight = clamp(settings.bottomRimHeight, 0.02, 0.5);
  settings.topRimHeight = clamp(settings.topRimHeight, 0.02, 0.6);
  settings.glassThickness = clamp(settings.glassThickness, 0.01, Math.min(settings.width, settings.depth) * 0.12);
  settings.baseOverhang = clamp(settings.baseOverhang, 0, 0.5);
  settings.frameOverhang = clamp(settings.frameOverhang, 0, 0.3);
  settings.frameOverlap = clamp(settings.frameOverlap, 0.01, 0.3);

  const structuralHeight = settings.baseHeight + settings.bottomRimHeight + settings.topRimHeight;
  if (structuralHeight > settings.height * 0.35) {
    const ratio = (settings.height * 0.35) / structuralHeight;
    settings.baseHeight *= ratio;
    settings.bottomRimHeight *= ratio;
    settings.topRimHeight *= ratio;
  }

  settings.sandHeight = clamp(settings.sandHeight, 0.02, Math.max(0.03, settings.height * 0.15));
  settings.sandWallGap = clamp(settings.sandWallGap, 0.01, 0.3);
  settings.sandVariation = clamp(settings.sandVariation, 0, 1);
  settings.sandGrain = clamp(settings.sandGrain, 0.1, 2.5);

  settings.waterLevel = clamp(settings.waterLevel, 0.2, 0.97);
  settings.waterWallGap = clamp(settings.waterWallGap, 0.005, 0.2);
  settings.waterTint = clamp(settings.waterTint, 0, 1);
  settings.waveStrength = clamp(settings.waveStrength, 0, 1);
  settings.waterSurfaceStyle = clamp(settings.waterSurfaceStyle, 0, 1);
  settings.waterWaveScale = clamp(settings.waterWaveScale, 0, 1);

  settings.tunnelEnabled = Boolean(settings.tunnelEnabled);
  settings.tunnelWidth = clamp(settings.tunnelWidth, 0.8, Math.max(0.9, settings.width - 1));
  settings.tunnelWallHeight = clamp(settings.tunnelWallHeight, 0.35, Math.max(0.45, settings.height * 0.52));
  settings.tunnelRoundness = clamp(settings.tunnelRoundness, 0.3, 1.35);
  settings.tunnelGlassThickness = clamp(settings.tunnelGlassThickness, 0.025, 0.25);
  settings.tunnelCurveSegments = Math.round(clamp(settings.tunnelCurveSegments, 5, 24));
  settings.tunnelEndExtension = clamp(settings.tunnelEndExtension, 0, 0.8);
  settings.portalFrameWidth = clamp(settings.portalFrameWidth, 0.04, 0.45);
  settings.portalFrameDepth = clamp(settings.portalFrameDepth, 0.04, 0.65);
  settings.tunnelWaterClearance = clamp(settings.tunnelWaterClearance, 0.005, 0.12);

  settings.exportScale = clamp(settings.exportScale, 1, 100);
  return settings;
}
