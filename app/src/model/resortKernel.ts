import * as THREE from 'three';
import createAquariumGeometryModule from '../generated/aquarium_geometry.mjs';
import type { AquariumBuild } from './aquarium';
import {
  L_SHAPE_CORNER_KEYS,
  U_SHAPE_CORNER_KEYS,
  activePassages,
  type AquariumSettings,
  type ShapeCornerKey,
} from './settings';

const KERNEL_ABI_VERSION = 6;
const WORLD_UNITS_PER_METRE = 16;
const EPSILON = 1e-6;

type KernelMaterial = 'structure' | 'sand' | 'water-volume' | 'water-surface' | 'glass';

interface KernelMesh {
  material: KernelMaterial;
  vertexStrideFloats: number;
  vertices: number[];
  indices: number[];
}

interface KernelResult {
  valid: boolean;
  kernelAbiVersion: number;
  contentHash?: string;
  diagnostics: Array<string | { message?: string }>;
  meshes?: KernelMesh[];
  navigation?: {
    layers: Array<{ floorY: number; ceilingY: number; outer: number[][]; holes: number[][][] }>;
    suggestedSpawns: number[][];
  };
  statistics?: { triangleCount: number; vertexCount: number; waterVolumeLitres: number };
}

interface CompatibleTank {
  shape: 'rectangle' | 'l' | 'u';
  widthCells: number;
  depthCells: number;
  notchWidthCells?: number;
  notchDepthCells?: number;
  heightSteps: number;
  depthSteps: number;
  cornerRadiusSteps: number;
  cornerRadii: Array<{ vertex: { column: number; row: number }; radiusSteps: number }>;
  rotationQuarterTurns: number;
}

export interface ResortKernelCompatibility {
  compatible: boolean;
  reason?: string;
  tank?: CompatibleTank;
}

let kernelModule: Promise<Awaited<ReturnType<typeof createAquariumGeometryModule>>> | undefined;

function whole(value: number): number | undefined {
  const rounded = Math.round(value);
  return Number.isFinite(value) && Math.abs(value - rounded) <= EPSILON ? rounded : undefined;
}

function stepped(value: number, stepsPerUnit: number): number | undefined {
  return whole(value * stepsPerUnit);
}

function resortCornerSteps(settings: AquariumSettings): Map<string, number> | undefined {
  const result = new Map<string, number>();
  if (settings.footprint === 'rectangle') {
    for (const key of Object.keys(settings.radii)) {
      const corner = key as keyof typeof settings.radii;
      const mode = settings.cornerModes[corner];
      if (mode === 'chamfer') return undefined;
      const value = mode === 'square' ? 0 : stepped(settings.radii[corner], 4);
      if (value === undefined) return undefined;
      result.set(corner, value);
    }
    return result;
  }

  const keys = settings.footprint === 'lShape'
    ? L_SHAPE_CORNER_KEYS : U_SHAPE_CORNER_KEYS;
  const concave = new Set<ShapeCornerKey>(settings.footprint === 'lShape'
    ? ['lInnerElbow'] : ['uInnerRight', 'uInnerLeft']);
  for (const key of keys) {
    const mode = settings.shapeCornerModes[key];
    if (concave.has(key)) {
      if (mode !== 'square') return undefined;
      continue;
    }
    if (mode === 'chamfer') return undefined;
    const value = mode === 'square' ? 0 : stepped(settings.shapeCornerRadii[key], 4);
    if (value === undefined) return undefined;
    result.set(key, value);
  }
  return result;
}

function rotateVertex(
  column: number, row: number, width: number, depth: number, rotation: number,
): { column: number; row: number } {
  if (rotation === 1) return { column: depth - row, row: column };
  if (rotation === 2) return { column: width - column, row: depth - row };
  if (rotation === 3) return { column: row, row: width - column };
  return { column, row };
}

export function resortKernelCompatibility(
  settings: AquariumSettings,
): ResortKernelCompatibility {
  if (settings.profile !== 'standard' && settings.profile !== 'belowFloor') {
    return { compatible: false, reason: 'standard or below-floor profile required' };
  }
  if (settings.footprintMirrored) return { compatible: false, reason: 'mirrored footprints are not supported' };
  if (settings.groundPreset !== 'sand' || settings.groundIrregularity !== 0 ||
      settings.groundMoundHeight !== 0) {
    return { compatible: false, reason: 'flat sand is required' };
  }
  if (Math.abs(settings.glassThickness - 0.055) > EPSILON) {
    return { compatible: false, reason: '55 mm glass is required' };
  }
  if (activePassages(settings).length > 0 || settings.decor.length > 0) {
    return { compatible: false, reason: 'passages and decor use the advanced maker path' };
  }
  if (Object.values(settings.wallModes).some((mode) => mode !== 'glass')) {
    return { compatible: false, reason: 'clear glass walls are required' };
  }
  const heightSteps = stepped(
    settings.profile === 'belowFloor' ? settings.heightAboveFloor : settings.height, 2,
  );
  if (heightSteps === undefined || heightSteps < 4 || heightSteps > 12) {
    return { compatible: false, reason: 'height must use Resort half-cell steps' };
  }
  const depthSteps = settings.profile === 'belowFloor'
    ? stepped(settings.depthBelowFloor, 2) : 0;
  if (depthSteps === undefined || depthSteps < 0 || depthSteps > 12) {
    return { compatible: false, reason: 'below-floor depth must use Resort half-cell steps' };
  }
  const cornerSteps = resortCornerSteps(settings);
  if (cornerSteps === undefined) {
    return { compatible: false, reason: 'corners must use square or Resort quarter-cell roundness' };
  }
  const rotationQuarterTurns = whole(settings.footprintRotation / 90);
  if (rotationQuarterTurns === undefined) {
    return { compatible: false, reason: 'rotation must use Resort quarter turns' };
  }

  let shape: CompatibleTank['shape'] = 'rectangle';
  let widthCells: number | undefined;
  let depthCells: number | undefined;
  let notchWidthCells: number | undefined;
  let notchDepthCells: number | undefined;
  if (settings.footprint === 'rectangle') {
    widthCells = whole(settings.width);
    depthCells = whole(settings.depth);
  } else if (settings.footprint === 'lShape') {
    shape = 'l';
    widthCells = whole(settings.lHorizontalArmLength);
    depthCells = whole(settings.lVerticalArmLength);
    const verticalArm = whole(settings.lVerticalArmWidth);
    const horizontalArm = whole(settings.lHorizontalArmWidth);
    if (widthCells !== undefined && depthCells !== undefined &&
        verticalArm !== undefined && horizontalArm !== undefined) {
      notchWidthCells = widthCells - verticalArm;
      notchDepthCells = depthCells - horizontalArm;
    }
  } else {
    shape = 'u';
    widthCells = whole(settings.uBridgeLength);
    const leftLength = whole(settings.uLeftArmLength);
    const rightLength = whole(settings.uRightArmLength);
    const leftArm = whole(settings.uLeftArmWidth);
    const rightArm = whole(settings.uRightArmWidth);
    const bridge = whole(settings.uBridgeDepth);
    if (leftLength !== undefined && leftLength === rightLength &&
        leftArm !== undefined && leftArm === rightArm &&
        widthCells !== undefined && bridge !== undefined) {
      depthCells = leftLength;
      notchWidthCells = widthCells - leftArm - rightArm;
      notchDepthCells = depthCells - bridge;
    }
  }
  if (widthCells === undefined || depthCells === undefined ||
      (shape !== 'rectangle' && (notchWidthCells === undefined || notchDepthCells === undefined))) {
    return { compatible: false, reason: 'footprint must use whole, symmetric Resort cells' };
  }
  const rotation = ((rotationQuarterTurns % 4) + 4) % 4;
  const vertices: Array<[string, number, number]> = shape === 'rectangle' ? [
    ['backLeft', 0, 0], ['backRight', widthCells, 0],
    ['frontRight', widthCells, depthCells], ['frontLeft', 0, depthCells],
  ] : shape === 'l' ? [
    ['lBackLeft', 0, 0], ['lBackRight', widthCells, 0],
    ['lOuterRight', widthCells, depthCells - notchDepthCells!],
    ['lFrontRight', widthCells - notchWidthCells!, depthCells],
    ['lFrontLeft', 0, depthCells],
  ] : [
    ['uBackLeft', 0, 0], ['uBackRight', widthCells, 0],
    ['uFrontRight', widthCells, depthCells],
    ['uMouthRight', (widthCells + notchWidthCells!) / 2, depthCells],
    ['uMouthLeft', (widthCells - notchWidthCells!) / 2, depthCells],
    ['uFrontLeft', 0, depthCells],
  ];
  const cornerRadii = vertices.map(([key, column, row]) => ({
    vertex: rotateVertex(column, row, widthCells!, depthCells!, rotation),
    radiusSteps: cornerSteps.get(key) ?? 0,
  }));
  const uniformRadius = cornerRadii.length > 0 &&
    cornerRadii.every(({ radiusSteps }) => radiusSteps === cornerRadii[0]!.radiusSteps)
    ? cornerRadii[0]!.radiusSteps : undefined;
  return {
    compatible: true,
    tank: {
      shape,
      widthCells,
      depthCells,
      notchWidthCells,
      notchDepthCells,
      heightSteps,
      depthSteps,
      cornerRadiusSteps: uniformRadius ?? 0,
      cornerRadii: uniformRadius === undefined ? cornerRadii : [],
      rotationQuarterTurns: rotation,
    },
  };
}

function designJson(tank: CompatibleTank): string {
  const footprint: Record<string, unknown> = {
    shape: tank.shape,
    originCell: { column: 0, row: 0 },
    widthCells: tank.widthCells,
    depthCells: tank.depthCells,
    rotationQuarterTurns: tank.rotationQuarterTurns,
  };
  if (tank.shape !== 'rectangle') {
    footprint.notch = {
      widthCells: tank.notchWidthCells,
      depthCells: tank.notchDepthCells,
    };
  }
  return JSON.stringify({
    schema: 'pokemon-resort-aquarium-design',
    schemaVersion: 4,
    designId: 'aqd_maker_resort_preview',
    mapId: 'aquarium12',
    revision: 0,
    grid: {
      tileWorldUnits: 16,
      metresPerCell: 1,
      verticalStepWorldUnits: 8,
      radiusStepWorldUnits: 4,
      origin: 'map-north-west',
      placementOffsetCells: [0.5, 0.5],
      cellConvention: 'integer-boundaries-half-cell-centres',
    },
    populationPolicy: { id: 'placeholder-wishiwashi', version: 1 },
    tanks: [{
      id: 'tank_maker_resort_preview',
      footprint,
      heightSteps: tank.heightSteps,
      depthSteps: tank.depthSteps,
      cornerRadiusSteps: tank.cornerRadiusSteps,
      cornerRadii: tank.cornerRadii,
      substrate: { kind: 'sand-flat' },
      glass: { style: 'clear-fixed-v1' },
      tunnels: [],
    }],
  });
}

function materialFor(tag: KernelMaterial): THREE.Material {
  if (tag === 'glass') return new THREE.MeshPhysicalMaterial({
    name: 'KERNEL_Glass_ClearFixedV1', color: 0xd7f5ff, roughness: 0.025,
    transmission: 0.97, transparent: true, opacity: 0.115, depthWrite: false,
    ior: 1.49, thickness: 0.055,
  });
  if (tag === 'water-volume') return new THREE.MeshPhysicalMaterial({
    name: 'KERNEL_WaterVolume', color: 0x1a7eae, roughness: 0.18,
    transmission: 0.58, transparent: true, opacity: 0.18, depthWrite: false,
  });
  if (tag === 'water-surface') return new THREE.MeshPhysicalMaterial({
    name: 'KERNEL_WaterSurface', color: 0x42bddf, roughness: 0.1,
    transmission: 0.5, transparent: true, opacity: 0.36, depthWrite: false,
    side: THREE.DoubleSide,
  });
  if (tag === 'sand') return new THREE.MeshStandardMaterial({
    name: 'KERNEL_Sand_Flat', color: 0xc8ad79, roughness: 0.92,
  });
  return new THREE.MeshStandardMaterial({
    name: 'KERNEL_Structure', color: 0x4a5158, metalness: 0.4, roughness: 0.42,
  });
}

function aquariumBuildFromKernel(result: KernelResult): AquariumBuild {
  const group = new THREE.Group();
  group.name = 'RESORT_SHARED_KERNEL_AQUARIUM';
  const ownedMaterials: THREE.Material[] = [];
  for (const semantic of result.meshes ?? []) {
    if (semantic.vertexStrideFloats !== 8) throw new Error('Unsupported aquarium kernel vertex format');
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    for (let offset = 0; offset < semantic.vertices.length; offset += 8) {
      positions.push(
        semantic.vertices[offset]! / WORLD_UNITS_PER_METRE,
        semantic.vertices[offset + 1]! / WORLD_UNITS_PER_METRE,
        semantic.vertices[offset + 2]! / WORLD_UNITS_PER_METRE,
      );
      normals.push(
        semantic.vertices[offset + 3]!,
        semantic.vertices[offset + 4]!,
        semantic.vertices[offset + 5]!,
      );
      uvs.push(semantic.vertices[offset + 6]!, semantic.vertices[offset + 7]!);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(semantic.indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = materialFor(semantic.material);
    ownedMaterials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `KERNEL_${semantic.material.toUpperCase()}`;
    if (semantic.material === 'glass') mesh.renderOrder = 30;
    if (semantic.material === 'water-volume') mesh.renderOrder = 20;
    if (semantic.material === 'water-surface') mesh.renderOrder = 21;
    group.add(mesh);
  }
  const navigation = result.navigation;
  group.userData = {
    generator: 'Pokemon Resort shared aquarium geometry kernel',
    geometryProfile: 'resort-compatible-v1',
    kernelAbiVersion: result.kernelAbiVersion,
    kernelContentHash: result.contentHash,
    navigation: {
      schema: 'aquarium-maker-navigation', schemaVersion: 4,
      regions: [], portals: [], dryPassages: [], decorObstacles: [],
      swimVolumeLayers: (navigation?.layers ?? []).map((layer, index) => ({
        id: `swim-layer-${index + 1}`,
        yBottom: layer.floorY / WORLD_UNITS_PER_METRE,
        yTop: layer.ceilingY / WORLD_UNITS_PER_METRE,
        polygons: [{
          outer: layer.outer.map(([x, z]) => [x! / WORLD_UNITS_PER_METRE, z! / WORLD_UNITS_PER_METRE]),
          holes: layer.holes.map((hole) => hole.map(([x, z]) =>
            [x! / WORLD_UNITS_PER_METRE, z! / WORLD_UNITS_PER_METRE])),
        }],
      })),
      spawnSuggestions: (navigation?.suggestedSpawns ?? []).map(([x, y, z]) =>
        [x! / WORLD_UNITS_PER_METRE, y! / WORLD_UNITS_PER_METRE, z! / WORLD_UNITS_PER_METRE]),
      approximateWaterVolumeM3: (result.statistics?.waterVolumeLitres ?? 0) / 1000,
    },
  };
  return {
    group,
    triangles: result.statistics?.triangleCount ?? 0,
    vertices: result.statistics?.vertexCount ?? 0,
    dispose: () => {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const material of ownedMaterials) material.dispose();
    },
  };
}

export async function buildResortKernelAquarium(
  settings: AquariumSettings,
): Promise<AquariumBuild | null> {
  const compatibility = resortKernelCompatibility(settings);
  if (!compatibility.compatible || !compatibility.tank) return null;
  kernelModule ??= createAquariumGeometryModule();
  const module = await kernelModule;
  const result = JSON.parse(module.buildAquariumDocument(
    designJson(compatibility.tank))) as KernelResult;
  if (result.kernelAbiVersion !== KERNEL_ABI_VERSION) {
    throw new Error(`Stale aquarium kernel artifact: expected ABI ${KERNEL_ABI_VERSION}, got ${result.kernelAbiVersion}`);
  }
  if (!result.valid) {
    const detail = result.diagnostics.map((entry) =>
      typeof entry === 'string' ? entry : entry.message ?? 'invalid geometry').join('; ');
    throw new Error(`Resort-compatible aquarium was rejected: ${detail}`);
  }
  return aquariumBuildFromKernel(result);
}
