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

const KERNEL_ABI_VERSION = 3;
const WORLD_UNITS_PER_METRE = 16;
const EPSILON = 1e-6;

type KernelMaterial = 'structure' | 'sand' | 'water' | 'glass';

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
  statistics?: { triangleCount: number; vertexCount: number };
}

interface CompatibleTank {
  shape: 'rectangle' | 'l' | 'u';
  widthCells: number;
  depthCells: number;
  notchWidthCells?: number;
  notchDepthCells?: number;
  heightSteps: number;
  cornerRadiusSteps: number;
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

function uniformRadiusSteps(settings: AquariumSettings): number | undefined {
  if (settings.footprint === 'rectangle') {
    const values = Object.keys(settings.radii).map((key) => {
      const corner = key as keyof typeof settings.radii;
      const mode = settings.cornerModes[corner];
      if (mode === 'chamfer') return undefined;
      return mode === 'square' ? 0 : stepped(settings.radii[corner], 4);
    });
    if (values.some((value) => value === undefined) ||
        values.some((value) => value !== values[0])) return undefined;
    return values[0];
  }

  const keys = settings.footprint === 'lShape'
    ? L_SHAPE_CORNER_KEYS : U_SHAPE_CORNER_KEYS;
  const concave = new Set<ShapeCornerKey>(settings.footprint === 'lShape'
    ? ['lInnerElbow'] : ['uInnerRight', 'uInnerLeft']);
  const convexValues: number[] = [];
  for (const key of keys) {
    const mode = settings.shapeCornerModes[key];
    if (concave.has(key)) {
      if (mode !== 'square') return undefined;
      continue;
    }
    if (mode === 'chamfer') return undefined;
    const value = mode === 'square' ? 0 : stepped(settings.shapeCornerRadii[key], 4);
    if (value === undefined) return undefined;
    convexValues.push(value);
  }
  return convexValues.length > 0 && convexValues.every((value) => value === convexValues[0])
    ? convexValues[0] : undefined;
}

export function resortKernelCompatibility(
  settings: AquariumSettings,
): ResortKernelCompatibility {
  if (settings.profile !== 'standard') return { compatible: false, reason: 'standard profile required' };
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
  const heightSteps = stepped(settings.height, 2);
  if (heightSteps === undefined || heightSteps < 4 || heightSteps > 12) {
    return { compatible: false, reason: 'height must use Resort half-cell steps' };
  }
  const cornerRadiusSteps = uniformRadiusSteps(settings);
  if (cornerRadiusSteps === undefined) {
    return { compatible: false, reason: 'corners must share Resort quarter-cell roundness' };
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
  return {
    compatible: true,
    tank: {
      shape,
      widthCells,
      depthCells,
      notchWidthCells,
      notchDepthCells,
      heightSteps,
      cornerRadiusSteps,
      rotationQuarterTurns: ((rotationQuarterTurns % 4) + 4) % 4,
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
    schemaVersion: 2,
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
      cornerRadiusSteps: tank.cornerRadiusSteps,
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
  if (tag === 'water') return new THREE.MeshPhysicalMaterial({
    name: 'KERNEL_Water', color: 0x2a9ed6, roughness: 0.12,
    transmission: 0.5, transparent: true, opacity: 0.68, depthWrite: false,
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
    if (semantic.material === 'water') mesh.renderOrder = 20;
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
