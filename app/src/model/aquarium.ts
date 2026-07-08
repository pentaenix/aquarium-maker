import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { AquariumSettings, CornerRadii } from './settings';
import { createSandTexture, createWaterTextures } from './textures';

export interface AquariumBuild {
  group: THREE.Group;
  triangles: number;
  vertices: number;
  dispose: () => void;
}

/**
 * Browser port of the Python aquarium generator.
 *
 * The geometry deliberately mirrors generate_public_aquarium.py:
 * - one shared rounded footprint drives glass, rims, sand, and water;
 * - each 90-degree corner uses an explicit circular arc;
 * - solid caps and vertical walls have separate vertices for crisp edges;
 * - the water volume has side walls plus a bottom cap hidden inside the sand;
 * - the visible water surface is a separate flat, continuously UV-mapped mesh.
 *
 * Authored coordinates are Y-up, with the viewing/front side at +Z. This is
 * equivalent to the Python asset after its -90-degree X export rotation.
 */

function fitRadii(width: number, depth: number, radii: CornerRadii): CornerRadii {
  const frontLeft = Math.max(0.002, radii.frontLeft);
  const frontRight = Math.max(0.002, radii.frontRight);
  const backRight = Math.max(0.002, radii.backRight);
  const backLeft = Math.max(0.002, radii.backLeft);
  const scale = Math.min(
    1,
    width / Math.max(frontLeft + frontRight, 1e-9),
    width / Math.max(backLeft + backRight, 1e-9),
    depth / Math.max(frontLeft + backLeft, 1e-9),
    depth / Math.max(frontRight + backRight, 1e-9),
  );
  return {
    frontLeft: frontLeft * scale,
    frontRight: frontRight * scale,
    backRight: backRight * scale,
    backLeft: backLeft * scale,
  };
}

function offsetRadii(radii: CornerRadii, amount: number, minimum = 0.002): CornerRadii {
  return {
    frontLeft: Math.max(minimum, radii.frontLeft + amount),
    frontRight: Math.max(minimum, radii.frontRight + amount),
    backRight: Math.max(minimum, radii.backRight + amount),
    backLeft: Math.max(minimum, radii.backLeft + amount),
  };
}

/** Return the exact same 4 × (segments + 1) rounded loop used by Python. */
function roundedRectLoop(
  width: number,
  depth: number,
  inputRadii: CornerRadii,
  segmentsPerCorner: number,
): THREE.Vector2[] {
  if (width <= 0 || depth <= 0) throw new Error('Rounded rectangle dimensions must be positive.');

  const segments = Math.max(1, Math.round(segmentsPerCorner));
  const radii = fitRadii(width, depth, inputRadii);
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;

  // Corner definitions are authored in the Python XY footprint where front is
  // -Y. We convert to Three.js XZ with front at +Z by storing z = -pythonY.
  const corners: Array<[number, number, number, number, number]> = [
    [halfWidth - radii.frontRight, -halfDepth + radii.frontRight, radii.frontRight, -90, 0],
    [halfWidth - radii.backRight, halfDepth - radii.backRight, radii.backRight, 0, 90],
    [-halfWidth + radii.backLeft, halfDepth - radii.backLeft, radii.backLeft, 90, 180],
    [-halfWidth + radii.frontLeft, -halfDepth + radii.frontLeft, radii.frontLeft, 180, 270],
  ];

  const points: THREE.Vector2[] = [];
  for (const [centerX, centerPythonY, radius, startDegrees, endDegrees] of corners) {
    for (let step = 0; step <= segments; step += 1) {
      const t = step / segments;
      const angle = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(startDegrees, endDegrees, t));
      const x = centerX + radius * Math.cos(angle);
      const pythonY = centerPythonY + radius * Math.sin(angle);
      points.push(new THREE.Vector2(x, -pythonY));
    }
  }
  return points;
}

function planarUV(x: number, z: number, loop: THREE.Vector2[]): [number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of loop) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.y);
    maxZ = Math.max(maxZ, point.y);
  }
  return [
    (x - minX) / Math.max(maxX - minX, 1e-9),
    (z - minZ) / Math.max(maxZ - minZ, 1e-9),
  ];
}

function finishGeometry(
  positions: number[],
  indices: number[],
  uvs?: number[],
  normals?: number[],
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  if (uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (normals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  else geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function pushVertex(
  positions: number[],
  point: THREE.Vector2,
  y: number,
  uvs?: number[],
  uvLoop?: THREE.Vector2[],
): number {
  const index = positions.length / 3;
  positions.push(point.x, y, point.y);
  if (uvs && uvLoop) {
    const [u, v] = planarUV(point.x, point.y, uvLoop);
    uvs.push(u, v);
  }
  return index;
}

function makeSolidPrism(
  loop: THREE.Vector2[],
  yBottom: number,
  yTop: number,
  includePlanarUVs = false,
): THREE.BufferGeometry {
  const count = loop.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs = includePlanarUVs ? [] as number[] : undefined;

  const sideBottom = positions.length / 3;
  for (const point of loop) pushVertex(positions, point, yBottom, uvs, loop);
  const sideTop = positions.length / 3;
  for (const point of loop) pushVertex(positions, point, yTop, uvs, loop);

  // The loop is clockwise when viewed from +Y. This winding faces outward.
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(
      sideBottom + index, sideBottom + next, sideTop + next,
      sideBottom + index, sideTop + next, sideTop + index,
    );
  }

  // Isolated cap rings preserve crisp horizontal edges.
  const bottomRing = positions.length / 3;
  for (const point of loop) pushVertex(positions, point, yBottom, uvs, loop);
  const bottomCenter = positions.length / 3;
  positions.push(0, yBottom, 0);
  if (uvs) uvs.push(0.5, 0.5);
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(bottomCenter, bottomRing + next, bottomRing + index);
  }

  const topRing = positions.length / 3;
  for (const point of loop) pushVertex(positions, point, yTop, uvs, loop);
  const topCenter = positions.length / 3;
  positions.push(0, yTop, 0);
  if (uvs) uvs.push(0.5, 0.5);
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(topCenter, topRing + index, topRing + next);
  }

  return finishGeometry(positions, indices, uvs);
}

function makeRingPrism(
  outerLoop: THREE.Vector2[],
  innerLoop: THREE.Vector2[],
  yBottom: number,
  yTop: number,
): THREE.BufferGeometry {
  if (outerLoop.length !== innerLoop.length) throw new Error('Ring loops must have matching topology.');
  const count = outerLoop.length;
  const positions: number[] = [];
  const indices: number[] = [];

  const outerBottom = positions.length / 3;
  for (const point of outerLoop) pushVertex(positions, point, yBottom);
  const outerTop = positions.length / 3;
  for (const point of outerLoop) pushVertex(positions, point, yTop);
  const innerBottom = positions.length / 3;
  for (const point of innerLoop) pushVertex(positions, point, yBottom);
  const innerTop = positions.length / 3;
  for (const point of innerLoop) pushVertex(positions, point, yTop);

  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    // Outer wall.
    indices.push(
      outerBottom + index, outerBottom + next, outerTop + next,
      outerBottom + index, outerTop + next, outerTop + index,
    );
    // Inner wall faces into the open center.
    indices.push(
      innerBottom + index, innerTop + next, innerBottom + next,
      innerBottom + index, innerTop + index, innerTop + next,
    );
  }

  // Separate horizontal copies provide hard top and bottom edges.
  const bottomOuter = positions.length / 3;
  for (const point of outerLoop) pushVertex(positions, point, yBottom);
  const bottomInner = positions.length / 3;
  for (const point of innerLoop) pushVertex(positions, point, yBottom);
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(
      bottomOuter + index, bottomInner + next, bottomOuter + next,
      bottomOuter + index, bottomInner + index, bottomInner + next,
    );
  }

  const topOuter = positions.length / 3;
  for (const point of outerLoop) pushVertex(positions, point, yTop);
  const topInner = positions.length / 3;
  for (const point of innerLoop) pushVertex(positions, point, yTop);
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(
      topOuter + index, topOuter + next, topInner + next,
      topOuter + index, topInner + next, topInner + index,
    );
  }

  return finishGeometry(positions, indices);
}

function makeWaterVolume(
  loop: THREE.Vector2[],
  yBottom: number,
  yTop: number,
): THREE.BufferGeometry {
  const count = loop.length;
  const positions: number[] = [];
  const indices: number[] = [];

  const bottom = positions.length / 3;
  for (const point of loop) pushVertex(positions, point, yBottom);
  const top = positions.length / 3;
  for (const point of loop) pushVertex(positions, point, yTop);

  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(
      bottom + index, bottom + next, top + next,
      bottom + index, top + next, top + index,
    );
  }

  // The bottom is buried inside the substrate. There is deliberately no top
  // cap because WATER_Surface is the visible, normal-mapped top.
  const capRing = positions.length / 3;
  for (const point of loop) pushVertex(positions, point, yBottom);
  const center = positions.length / 3;
  positions.push(0, yBottom, 0);
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(center, capRing + next, capRing + index);
  }

  return finishGeometry(positions, indices);
}

function makeFlatWaterSurface(loop: THREE.Vector2[], y: number): THREE.BufferGeometry {
  const count = loop.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];

  for (const point of loop) {
    pushVertex(positions, point, y, uvs, loop);
    normals.push(0, 1, 0);
  }
  const center = positions.length / 3;
  positions.push(0, y, 0);
  uvs.push(0.5, 0.5);
  normals.push(0, 1, 0);

  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(center, index, next);
  }
  return finishGeometry(positions, indices, uvs, normals);
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
  group.name = 'PROFESSIONAL_PUBLIC_AQUARIUM';
  group.userData = {
    generator: 'Aquarium Maker',
    geometryProfile: 'Python parity',
    authoredUnits: 'meters',
    exportUnitsPerMeter: settings.exportScale,
    frontAxis: '+Z',
    upAxis: '+Y',
    openTop: true,
    opaqueBackPanel: false,
  };

  const bodyRadii = fitRadii(settings.width, settings.depth, settings.radii);

  const glassOuter = roundedRectLoop(
    settings.width,
    settings.depth,
    bodyRadii,
    settings.curveSegments,
  );
  const glassInner = roundedRectLoop(
    settings.width - settings.glassThickness * 2,
    settings.depth - settings.glassThickness * 2,
    offsetRadii(bodyRadii, -settings.glassThickness),
    settings.curveSegments,
  );

  // The trim follows the same corner profile as the acrylic, exactly as in the
  // Python generator. Adjusting any corner therefore updates every nested part.
  const baseOuter = roundedRectLoop(
    settings.width + settings.baseOverhang * 2,
    settings.depth + settings.baseOverhang * 2,
    offsetRadii(bodyRadii, settings.baseOverhang),
    settings.curveSegments,
  );
  const frameOuter = roundedRectLoop(
    settings.width + settings.frameOverhang * 2,
    settings.depth + settings.frameOverhang * 2,
    offsetRadii(bodyRadii, settings.frameOverhang),
    settings.curveSegments,
  );
  const frameInner = roundedRectLoop(
    settings.width - settings.frameOverlap * 2,
    settings.depth - settings.frameOverlap * 2,
    offsetRadii(bodyRadii, -settings.frameOverlap),
    settings.curveSegments,
  );

  const sandInset = settings.glassThickness + settings.sandWallGap;
  const sandLoop = roundedRectLoop(
    settings.width - sandInset * 2,
    settings.depth - sandInset * 2,
    offsetRadii(bodyRadii, -sandInset),
    settings.curveSegments,
  );

  const waterInset = settings.glassThickness + settings.waterWallGap;
  const waterLoop = roundedRectLoop(
    settings.width - waterInset * 2,
    settings.depth - waterInset * 2,
    offsetRadii(bodyRadii, -waterInset),
    settings.curveSegments,
  );

  const baseTop = settings.baseHeight;
  const bottomRimTop = baseTop + settings.bottomRimHeight;
  const topRimBottom = settings.height - settings.topRimHeight;
  const glassBottom = baseTop + settings.bottomRimHeight * 0.34;
  const glassTop = settings.height - settings.topRimHeight * 0.34;
  const sandBottom = baseTop + settings.bottomRimHeight * 0.58;
  const sandTop = sandBottom + settings.sandHeight;
  const interiorWaterCeiling = topRimBottom - 0.055;
  const waterTop = sandTop + (interiorWaterCeiling - sandTop) * settings.waterLevel;
  const waterBottom = sandTop - Math.min(0.032, settings.sandHeight * 0.45);
  const waterDepth = Math.max(0.001, waterTop - waterBottom);

  const baseMaterial = new THREE.MeshStandardMaterial({
    name: 'Plinth_Painted',
    color: new THREE.Color(0.19, 0.215, 0.235),
    metalness: 0,
    roughness: 0.82,
  });
  const frameMaterial = new THREE.MeshStandardMaterial({
    name: 'Frame_Steel',
    color: new THREE.Color(0.29, 0.315, 0.34),
    metalness: 0.54,
    roughness: 0.34,
  });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Acrylic_Glass',
    color: new THREE.Color(0.84, 0.96, 1),
    metalness: 0,
    roughness: 0.025,
    transmission: 0.965,
    thickness: settings.glassThickness,
    attenuationDistance: 18,
    attenuationColor: new THREE.Color(0.86, 0.96, 1),
    ior: 1.49,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    envMapIntensity: 1.05,
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
    color: 0xffffff,
    map: sandTexture,
    metalness: 0,
    roughness: 0.93,
  });

  const waterTextures = createWaterTextures(
    settings.waterColor,
    settings.waveStrength,
    settings.waterSeed,
  );
  const attenuationDistance = THREE.MathUtils.lerp(12, 1, settings.waterTint);
  const volumeOpacity = THREE.MathUtils.lerp(0.035, 0.11, settings.waterTint);
  const waterVolumeMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Water_Volume',
    color: new THREE.Color(settings.waterColor),
    metalness: 0,
    roughness: 0.05,
    transmission: 0.985,
    thickness: waterDepth,
    attenuationDistance,
    attenuationColor: new THREE.Color(settings.waterColor),
    ior: 1.333,
    transparent: true,
    opacity: volumeOpacity,
    depthWrite: false,
    envMapIntensity: 0.7,
    side: THREE.FrontSide,
  });
  const waterSurfaceMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Water_Surface',
    color: 0xffffff,
    map: waterTextures.color,
    normalMap: waterTextures.normal,
    normalScale: new THREE.Vector2(
      0.40 + settings.waveStrength * 0.72,
      0.40 + settings.waveStrength * 0.72,
    ),
    metalness: 0,
    roughness: 0.055,
    transmission: 0.91,
    thickness: 0.02,
    attenuationDistance: 8,
    attenuationColor: new THREE.Color(settings.waterColor),
    ior: 1.333,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    envMapIntensity: 1.1,
    side: THREE.DoubleSide,
  });

  function addMesh(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    castShadow = true,
    receiveShadow = true,
  ): THREE.Mesh {
    geometry.name = name;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    group.add(mesh);
    return mesh;
  }

  addMesh(
    'STRUCTURE_BasePlinth',
    makeSolidPrism(baseOuter, 0, baseTop),
    baseMaterial,
  );
  addMesh(
    'STRUCTURE_BottomRim',
    makeRingPrism(frameOuter, frameInner, baseTop, bottomRimTop),
    frameMaterial,
  );

  const glassMesh = addMesh(
    'GLASS_AcrylicShell',
    makeRingPrism(glassOuter, glassInner, glassBottom, glassTop),
    glassMaterial,
    false,
    false,
  );
  glassMesh.renderOrder = 4;

  addMesh(
    'INTERIOR_SandFloor',
    makeSolidPrism(sandLoop, sandBottom, sandTop, true),
    sandMaterial,
    false,
    true,
  );

  const waterVolume = addMesh(
    'WATER_Volume',
    makeWaterVolume(waterLoop, waterBottom, waterTop - 0.002),
    waterVolumeMaterial,
    false,
    false,
  );
  waterVolume.renderOrder = 2;

  const waterSurface = addMesh(
    'WATER_Surface',
    makeFlatWaterSurface(waterLoop, waterTop),
    waterSurfaceMaterial,
    false,
    false,
  );
  waterSurface.renderOrder = 3;

  addMesh(
    'STRUCTURE_TopRim',
    makeRingPrism(frameOuter, frameInner, topRimBottom, settings.height),
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
