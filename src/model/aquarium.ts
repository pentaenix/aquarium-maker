import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { AquariumSettings, CornerRadii } from './settings';
import { createSandTexture, createWaterTextures } from './textures';

interface Dimensions {
  width: number;
  depth: number;
}

export interface AquariumBuild {
  group: THREE.Group;
  triangles: number;
  vertices: number;
  dispose: () => void;
}

function fitRadii(width: number, depth: number, radii: CornerRadii): CornerRadii {
  const values = {
    frontLeft: Math.max(0.002, radii.frontLeft),
    frontRight: Math.max(0.002, radii.frontRight),
    backRight: Math.max(0.002, radii.backRight),
    backLeft: Math.max(0.002, radii.backLeft),
  };
  const scale = Math.min(
    1,
    width / Math.max(0.0001, values.frontLeft + values.frontRight),
    width / Math.max(0.0001, values.backLeft + values.backRight),
    depth / Math.max(0.0001, values.frontLeft + values.backLeft),
    depth / Math.max(0.0001, values.frontRight + values.backRight),
  );
  return {
    frontLeft: values.frontLeft * scale,
    frontRight: values.frontRight * scale,
    backRight: values.backRight * scale,
    backLeft: values.backLeft * scale,
  };
}

function scaleRadii(radii: CornerRadii, scale: number): CornerRadii {
  return {
    frontLeft: Math.max(0.002, radii.frontLeft * scale),
    frontRight: Math.max(0.002, radii.frontRight * scale),
    backRight: Math.max(0.002, radii.backRight * scale),
    backLeft: Math.max(0.002, radii.backLeft * scale),
  };
}

function offsetRadii(radii: CornerRadii, amount: number): CornerRadii {
  return {
    frontLeft: Math.max(0.002, radii.frontLeft + amount),
    frontRight: Math.max(0.002, radii.frontRight + amount),
    backRight: Math.max(0.002, radii.backRight + amount),
    backLeft: Math.max(0.002, radii.backLeft + amount),
  };
}

function roundedPath(
  width: number,
  depth: number,
  inputRadii: CornerRadii,
  clockwise: boolean,
): THREE.Path {
  const radii = fitRadii(width, depth, inputRadii);
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
  const path = roundedPath(width, depth, radii, false);
  const shape = new THREE.Shape();
  shape.curves = path.curves;
  shape.currentPoint.copy(path.currentPoint);
  return shape;
}

function ringShape(
  outer: Dimensions,
  outerRadii: CornerRadii,
  inner: Dimensions,
  innerRadii: CornerRadii,
): THREE.Shape {
  const shape = solidShape(outer.width, outer.depth, outerRadii);
  shape.holes.push(roundedPath(inner.width, inner.depth, innerRadii, true));
  return shape;
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
    generator: 'Aquarium Studio',
    authoredUnits: 'meters',
    exportUnitsPerMeter: settings.exportScale,
    openTop: true,
  };

  const bodyRadii = fitRadii(settings.width, settings.depth, settings.radii);
  const glassOuter = { width: settings.width, depth: settings.depth };
  const glassInner = {
    width: settings.width - settings.glassThickness * 2,
    depth: settings.depth - settings.glassThickness * 2,
  };
  const glassInnerRadii = offsetRadii(bodyRadii, -settings.glassThickness);

  const baseOuter = {
    width: settings.width + settings.baseOverhang * 2,
    depth: settings.depth + settings.baseOverhang * 2,
  };
  const baseRadii = offsetRadii(bodyRadii, settings.baseOverhang);

  const frameOuter = {
    width: settings.width + settings.frameOverhang * 2,
    depth: settings.depth + settings.frameOverhang * 2,
  };
  const subtleRimRadii = scaleRadii(bodyRadii, settings.rimRoundness);
  const frameOuterRadii = offsetRadii(subtleRimRadii, settings.frameOverhang);
  const frameInner = {
    width: settings.width - settings.frameOverlap * 2,
    depth: settings.depth - settings.frameOverlap * 2,
  };
  const frameInnerRadii = offsetRadii(subtleRimRadii, -settings.frameOverlap);

  const sandInset = settings.glassThickness + settings.sandWallGap;
  const sandDimensions = {
    width: settings.width - sandInset * 2,
    depth: settings.depth - sandInset * 2,
  };
  const sandRadii = offsetRadii(bodyRadii, -sandInset);

  const waterInset = settings.glassThickness + settings.waterWallGap;
  const waterDimensions = {
    width: settings.width - waterInset * 2,
    depth: settings.depth - waterInset * 2,
  };
  const waterRadii = offsetRadii(bodyRadii, -waterInset);

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
  const attenuationDistance = THREE.MathUtils.lerp(17, 2.2, Math.pow(settings.waterTint, 1.15));
  const waterVolumeMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Water_Volume',
    color: settings.waterColor,
    metalness: 0,
    roughness: 0.055,
    transmission: 0.975,
    thickness: Math.max(0.01, waterTop - waterBottom),
    attenuationDistance,
    attenuationColor: new THREE.Color(settings.waterColor),
    ior: 1.333,
    envMapIntensity: 0.92,
    side: THREE.FrontSide,
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
    extrude(solidShape(baseOuter.width, baseOuter.depth, baseRadii), settings.baseHeight, 0, settings.curveSegments),
    baseMaterial,
  );
  addMesh(
    'STRUCTURE_BottomRim',
    extrude(
      ringShape(frameOuter, frameOuterRadii, frameInner, frameInnerRadii),
      settings.bottomRimHeight,
      baseTop,
      settings.curveSegments,
    ),
    frameMaterial,
  );
  const glassMesh = addMesh(
    'GLASS_AcrylicShell',
    extrude(
      ringShape(glassOuter, bodyRadii, glassInner, glassInnerRadii),
      glassTop - glassBottom,
      glassBottom,
      settings.curveSegments,
    ),
    glassMaterial,
    false,
    false,
  );
  glassMesh.renderOrder = 4;

  addMesh(
    'INTERIOR_SandFloor',
    extrude(
      solidShape(sandDimensions.width, sandDimensions.depth, sandRadii),
      settings.sandHeight,
      sandBottom,
      settings.curveSegments,
      sandDimensions,
    ),
    sandMaterial,
    false,
    true,
  );

  const waterMesh = addMesh(
    'WATER_VolumeAndSurface',
    extrude(
      solidShape(waterDimensions.width, waterDimensions.depth, waterRadii),
      waterTop - waterBottom,
      waterBottom,
      settings.curveSegments,
      waterDimensions,
    ),
    [waterSurfaceMaterial, waterVolumeMaterial],
    false,
    false,
  );
  waterMesh.renderOrder = 2;

  addMesh(
    'STRUCTURE_TopRim',
    extrude(
      ringShape(frameOuter, frameOuterRadii, frameInner, frameInnerRadii),
      settings.topRimHeight,
      topRimBottom,
      settings.curveSegments,
    ),
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
