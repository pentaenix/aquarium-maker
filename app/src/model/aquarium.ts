import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import {
  fitFootprint,
  fitRadii,
  insetFootprint,
  insetProfile,
  offsetRadii,
  scaleRadii,
  type Footprint,
} from './profile';
import type { AquariumSettings, CornerRadii } from './settings';
import { createSandTexture, createWaterTextures } from './textures';

export interface AquariumBuild {
  group: THREE.Group;
  triangles: number;
  vertices: number;
  dispose: () => void;
}

function roundedPath(
  width: number,
  depth: number,
  radii: CornerRadii,
  clockwise: boolean,
): THREE.Path {
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const path = new THREE.Path();

  if (!clockwise) {
    path.moveTo(-halfWidth + radii.frontLeft, -halfDepth);
    path.lineTo(halfWidth - radii.frontRight, -halfDepth);
    path.quadraticCurveTo(halfWidth, -halfDepth, halfWidth, -halfDepth + radii.frontRight);
    path.lineTo(halfWidth, halfDepth - radii.backRight);
    path.quadraticCurveTo(halfWidth, halfDepth, halfWidth - radii.backRight, halfDepth);
    path.lineTo(-halfWidth + radii.backLeft, halfDepth);
    path.quadraticCurveTo(-halfWidth, halfDepth, -halfWidth, halfDepth - radii.backLeft);
    path.lineTo(-halfWidth, -halfDepth + radii.frontLeft);
    path.quadraticCurveTo(-halfWidth, -halfDepth, -halfWidth + radii.frontLeft, -halfDepth);
  } else {
    path.moveTo(-halfWidth + radii.frontLeft, -halfDepth);
    path.quadraticCurveTo(-halfWidth, -halfDepth, -halfWidth, -halfDepth + radii.frontLeft);
    path.lineTo(-halfWidth, halfDepth - radii.backLeft);
    path.quadraticCurveTo(-halfWidth, halfDepth, -halfWidth + radii.backLeft, halfDepth);
    path.lineTo(halfWidth - radii.backRight, halfDepth);
    path.quadraticCurveTo(halfWidth, halfDepth, halfWidth, halfDepth - radii.backRight);
    path.lineTo(halfWidth, -halfDepth + radii.frontRight);
    path.quadraticCurveTo(halfWidth, -halfDepth, halfWidth - radii.frontRight, -halfDepth);
  }
  path.closePath();
  return path;
}

function solidShape(width: number, depth: number, radii: CornerRadii): THREE.Shape {
  const fitted = fitRadii(width, depth, radii);
  const path = roundedPath(width, depth, fitted, false);
  const shape = new THREE.Shape();
  shape.curves = path.curves;
  shape.currentPoint.copy(path.currentPoint);
  return shape;
}

function ringShape(outer: Footprint, inset: number): THREE.Shape {
  const inner = insetFootprint(outer, inset);
  const shape = roundedPath(outer.width, outer.depth, outer.radii, false);
  const ring = new THREE.Shape();
  ring.curves = shape.curves;
  ring.currentPoint.copy(shape.currentPoint);
  ring.holes.push(roundedPath(inner.width, inner.depth, inner.radii, true));
  return ring;
}

function planarUVs(geometry: THREE.BufferGeometry, width: number, depth: number): void {
  const positions = geometry.getAttribute('position');
  const uv = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    uv[i * 2] = x / width + 0.5;
    uv[i * 2 + 1] = z / depth + 0.5;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function extrude(
  shape: THREE.Shape,
  height: number,
  yBottom: number,
  curveSegments: number,
  uvDimensions?: Dimensions,
): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    steps: 1,
    bevelEnabled: false,
    curveSegments,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, yBottom, 0);
  geometry.computeVertexNormals();
  if (uvDimensions) planarUVs(geometry, uvDimensions.width, uvDimensions.depth);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function roundedLoop(
  width: number,
  depth: number,
  radii: CornerRadii,
  curveSegments: number,
): THREE.Vector2[] {
  const sampled = roundedPath(width, depth, radii, false).getPoints(Math.max(2, curveSegments));
  const points: THREE.Vector2[] = [];
  for (const point of sampled) {
    if (!points.length || points.at(-1)!.distanceToSquared(point) > 1e-12) points.push(point);
  }
  if (points.length > 1 && points[0]!.distanceToSquared(points.at(-1)!) < 1e-12) points.pop();
  return points;
}

function openSideWall(
  width: number,
  depth: number,
  radii: CornerRadii,
  yBottom: number,
  yTop: number,
  curveSegments: number,
): THREE.BufferGeometry {
  const loop = roundedLoop(width, depth, radii, curveSegments);
  const positions = new Float32Array(loop.length * 2 * 3);
  const indices: number[] = [];

  for (let index = 0; index < loop.length; index += 1) {
    const point = loop[index]!;
    positions[index * 3] = point.x;
    positions[index * 3 + 1] = yBottom;
    positions[index * 3 + 2] = point.y;
    const topIndex = loop.length + index;
    positions[topIndex * 3] = point.x;
    positions[topIndex * 3 + 1] = yTop;
    positions[topIndex * 3 + 2] = point.y;
  }

  for (let index = 0; index < loop.length; index += 1) {
    const next = (index + 1) % loop.length;
    const bottom = index;
    const bottomNext = next;
    const top = loop.length + index;
    const topNext = loop.length + next;
    // Winding faces outward for the counter-clockwise top-view loop.
    indices.push(bottom, top, topNext, bottom, topNext, bottomNext);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function flatSurface(
  width: number,
  depth: number,
  radii: CornerRadii,
  y: number,
  curveSegments: number,
): THREE.ShapeGeometry {
  const geometry = new THREE.ShapeGeometry(solidShape(width, depth, radii), curveSegments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  planarUVs(geometry, width, depth);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function meshStats(group: THREE.Group): { triangles: number; vertices: number } {
  let triangles = 0;
  let vertices = 0;
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute('position');
    vertices += position?.count ?? 0;
    triangles += geometry.index ? geometry.index.count / 3 : (position?.count ?? 0) / 3;
  });
  return { triangles: Math.round(triangles), vertices };
}

function disposeMaterial(material: THREE.Material): void {
  const possibleTextures = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap'] as const;
  const record = material as unknown as Record<string, unknown>;
  for (const key of possibleTextures) {
    const texture = record[key];
    if (texture instanceof THREE.Texture) texture.dispose();
  }
  material.dispose();
}

export function buildAquarium(settings: AquariumSettings): AquariumBuild {
  const group = new THREE.Group();
  group.name = 'PUBLIC_AQUARIUM';
  group.userData = {
    generator: 'Aquarium Maker',
    authoredUnits: 'meters',
    exportUnitsPerMeter: settings.exportScale,
    openTop: true,
  };

  const bodyFootprint = fitFootprint(settings.width, settings.depth, settings.radii);
  const bodyRadii = bodyFootprint.radii;

  const baseOuter = fitFootprint(
    settings.width + settings.baseOverhang * 2,
    settings.depth + settings.baseOverhang * 2,
    offsetRadii(bodyRadii, settings.baseOverhang),
  );

  const subtleRimRadii = scaleRadii(bodyRadii, settings.rimRoundness);
  const frameOuter = fitFootprint(
    settings.width + settings.frameOverhang * 2,
    settings.depth + settings.frameOverhang * 2,
    offsetRadii(subtleRimRadii, settings.frameOverhang),
  );

  const sandProfile = insetProfile(
    settings.width,
    settings.depth,
    settings.radii,
    settings.glassThickness + settings.sandWallGap,
  );
  const waterProfile = insetProfile(
    settings.width,
    settings.depth,
    settings.radii,
    settings.glassThickness + settings.waterWallGap,
  );

  const baseTop = settings.baseHeight;
  const topRimBottom = settings.height - settings.topRimHeight;
  const glassBottom = baseTop + settings.bottomRimHeight * 0.34;
  const glassTop = settings.height - settings.topRimHeight * 0.34;
  const sandBottom = baseTop + settings.bottomRimHeight * 0.58;
  const sandTop = sandBottom + settings.sandHeight;
  const waterCeiling = topRimBottom - 0.055;
  const waterTop = sandTop + (waterCeiling - sandTop) * settings.waterLevel;
  const waterBottom = sandTop - Math.min(0.032, settings.sandHeight * 0.45);

  const baseMaterial = new THREE.MeshStandardMaterial({
    name: 'Plinth_Painted',
    color: '#30383e',
    metalness: 0,
    roughness: 0.82,
  });
  const frameMaterial = new THREE.MeshStandardMaterial({
    name: 'Frame_Steel',
    color: '#4b525a',
    metalness: 0.54,
    roughness: 0.34,
  });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Acrylic_Glass',
    color: '#d9f4fb',
    metalness: 0,
    roughness: 0.035,
    transmission: 0.965,
    thickness: settings.glassThickness,
    attenuationDistance: 18,
    attenuationColor: new THREE.Color('#d8f4fb'),
    ior: 1.49,
    envMapIntensity: 1.08,
    side: THREE.FrontSide,
  });

  const sandTexture = createSandTexture(
    settings.sandColor,
    settings.sandVariation,
    settings.sandGrain,
    settings.sandSeed,
  );
  const sandMaterial = new THREE.MeshStandardMaterial({
    name: 'Sand_Substrate',
    color: '#ffffff',
    map: sandTexture,
    metalness: 0,
    roughness: 0.94,
  });

  const waterTextures = createWaterTextures(
    settings.waterColor,
    settings.waveStrength,
    settings.waterSeed,
  );
  const waterVolumeColor = new THREE.Color(settings.waterColor).multiplyScalar(0.82);
  const waterVolumeMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Water_Volume',
    color: waterVolumeColor,
    metalness: 0,
    roughness: 0.12,
    transparent: true,
    opacity: THREE.MathUtils.lerp(0.025, 0.16, Math.pow(settings.waterTint, 1.1)),
    depthWrite: false,
    envMapIntensity: 0.55,
    side: THREE.DoubleSide,
  });
  const waterSurfaceColor = new THREE.Color(settings.waterColor).lerp(new THREE.Color('#d9f7ff'), 0.36);
  const waterSurfaceMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Water_Surface',
    color: waterSurfaceColor,
    map: waterTextures.color,
    normalMap: waterTextures.normal,
    normalScale: new THREE.Vector2(0.46 + settings.waveStrength * 0.76, 0.46 + settings.waveStrength * 0.76),
    metalness: 0,
    roughness: 0.07,
    transmission: 0.89,
    thickness: 0.02,
    attenuationDistance: 8,
    attenuationColor: new THREE.Color(settings.waterColor),
    ior: 1.333,
    envMapIntensity: 1.14,
    side: THREE.DoubleSide,
  });

  function addMesh(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    castShadow = true,
    receiveShadow = true,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    group.add(mesh);
    return mesh;
  }

  addMesh(
    'STRUCTURE_BasePlinth',
    extrude(solidShape(baseOuter.width, baseOuter.depth, baseOuter.radii), settings.baseHeight, 0, settings.curveSegments),
    baseMaterial,
  );
  addMesh(
    'STRUCTURE_BottomRim',
    extrude(ringShape(frameOuter, settings.frameOverlap), settings.bottomRimHeight, baseTop, settings.curveSegments),
    frameMaterial,
  );
  const glassMesh = addMesh(
    'GLASS_AcrylicShell',
    extrude(ringShape(bodyFootprint, settings.glassThickness), glassTop - glassBottom, glassBottom, settings.curveSegments),
    glassMaterial,
    false,
    false,
  );
  glassMesh.renderOrder = 4;

  addMesh(
    'INTERIOR_SandFloor',
    extrude(
      solidShape(sandProfile.width, sandProfile.depth, sandProfile.radii),
      settings.sandHeight,
      sandBottom,
      settings.curveSegments,
      sandProfile,
    ),
    sandMaterial,
    false,
    true,
  );

  const waterVolume = addMesh(
    'WATER_Volume',
    openSideWall(
      waterProfile.width,
      waterProfile.depth,
      waterProfile.radii,
      waterBottom,
      waterTop - 0.002,
      settings.curveSegments,
    ),
    waterVolumeMaterial,
    false,
    false,
  );
  waterVolume.renderOrder = 2;

  const waterSurface = addMesh(
    'WATER_Surface',
    flatSurface(waterProfile.width, waterProfile.depth, waterProfile.radii, waterTop, settings.curveSegments),
    waterSurfaceMaterial,
    false,
    false,
  );
  waterSurface.renderOrder = 3;

  addMesh(
    'STRUCTURE_TopRim',
    extrude(ringShape(frameOuter, settings.frameOverlap), settings.topRimHeight, topRimBottom, settings.curveSegments),
    frameMaterial,
  );

  const stats = meshStats(group);
  return {
    group,
    ...stats,
    dispose: () => {
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) disposeMaterial(material);
      });
    },
  };
}

function cloneForExport(source: THREE.Group, scale: number): THREE.Group {
  const clone = source.clone(true);
  clone.name = source.name;
  clone.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry = object.geometry.clone();
    object.geometry.scale(scale, scale, scale);
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const clonedMaterials = sourceMaterials.map((material) => {
      const cloned = material.clone();
      if (cloned instanceof THREE.MeshPhysicalMaterial) {
        cloned.thickness *= scale;
        if (Number.isFinite(cloned.attenuationDistance)) cloned.attenuationDistance *= scale;
      }
      return cloned;
    });
    object.material = Array.isArray(object.material) ? clonedMaterials : clonedMaterials[0]!;
  });
  clone.userData = {
    ...source.userData,
    outputUnitsPerMeter: scale,
  };
  return clone;
}

function disposeExportClone(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

export async function exportAquariumGLB(group: THREE.Group, scale: number): Promise<ArrayBuffer> {
  const exportGroup = cloneForExport(group, scale);
  const exporter = new GLTFExporter();
  try {
    const result = await exporter.parseAsync(exportGroup, {
      binary: true,
      onlyVisible: true,
      trs: false,
      maxTextureSize: 2048,
    });
    if (!(result instanceof ArrayBuffer)) throw new Error('The exporter did not return a binary GLB.');
    return result;
  } finally {
    disposeExportClone(exportGroup);
  }
}
