import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as polygonClippingModule from 'polygon-clipping';
import type { MultiPolygon, Polygon as ClipPolygon, Ring } from 'polygon-clipping';
import type { AquariumSettings, CornerMode, CornerModes, CornerRadii, ShapeCornerKey, TunnelAxis } from './settings';
import { createGroundTexture, createWaterTextures } from './textures';

export interface AquariumBuild {
  group: THREE.Group;
  triangles: number;
  vertices: number;
  dispose: () => void;
}

type PolygonClippingApi = {
  difference: (
    subject: ClipPolygon | MultiPolygon,
    ...clips: Array<ClipPolygon | MultiPolygon>
  ) => MultiPolygon;
};

// polygon-clipping is published as CommonJS. Vite exposes named exports while
// Node-based validation sees the API under `default`, so normalize both forms.
const polygonClipping = (
  (polygonClippingModule as unknown as { default?: PolygonClippingApi }).default
  ?? (polygonClippingModule as unknown as PolygonClippingApi)
);
const { difference } = polygonClipping;

const EPSILON = 1e-6;

function effectiveRadii(radii: CornerRadii, modes: CornerModes): CornerRadii {
  return {
    frontLeft: modes.frontLeft === 'square' ? 0.002 : Math.max(0.002, radii.frontLeft),
    frontRight: modes.frontRight === 'square' ? 0.002 : Math.max(0.002, radii.frontRight),
    backRight: modes.backRight === 'square' ? 0.002 : Math.max(0.002, radii.backRight),
    backLeft: modes.backLeft === 'square' ? 0.002 : Math.max(0.002, radii.backLeft),
  };
}

export function fitRadii(width: number, depth: number, radii: CornerRadii): CornerRadii {
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

export function offsetRadii(radii: CornerRadii, amount: number, minimum = 0.002): CornerRadii {
  return {
    frontLeft: Math.max(minimum, radii.frontLeft + amount),
    frontRight: Math.max(minimum, radii.frontRight + amount),
    backRight: Math.max(minimum, radii.backRight + amount),
    backLeft: Math.max(minimum, radii.backLeft + amount),
  };
}

/**
 * Shared footprint generator for glass, frame, sand, water, and the UI preview.
 * Every corner always emits the same number of points, so nested loops remain
 * topologically compatible even when rounded and flat-pane corners are mixed.
 */
export function createFootprintLoop(
  width: number,
  depth: number,
  inputRadii: CornerRadii,
  modes: CornerModes,
  segmentsPerCorner: number,
): THREE.Vector2[] {
  if (width <= 0 || depth <= 0) throw new Error('Footprint dimensions must be positive.');
  const segments = Math.max(1, Math.round(segmentsPerCorner));
  const radii = fitRadii(width, depth, effectiveRadii(inputRadii, modes));
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;

  const corners: Array<{
    key: keyof CornerRadii;
    centerX: number;
    centerPythonY: number;
    radius: number;
    start: number;
    end: number;
  }> = [
    { key: 'frontRight', centerX: halfWidth - radii.frontRight, centerPythonY: -halfDepth + radii.frontRight, radius: radii.frontRight, start: -90, end: 0 },
    { key: 'backRight', centerX: halfWidth - radii.backRight, centerPythonY: halfDepth - radii.backRight, radius: radii.backRight, start: 0, end: 90 },
    { key: 'backLeft', centerX: -halfWidth + radii.backLeft, centerPythonY: halfDepth - radii.backLeft, radius: radii.backLeft, start: 90, end: 180 },
    { key: 'frontLeft', centerX: -halfWidth + radii.frontLeft, centerPythonY: -halfDepth + radii.frontLeft, radius: radii.frontLeft, start: 180, end: 270 },
  ];

  const points: THREE.Vector2[] = [];
  for (const corner of corners) {
    const mode = modes[corner.key];
    const startAngle = THREE.MathUtils.degToRad(corner.start);
    const endAngle = THREE.MathUtils.degToRad(corner.end);
    const startPoint = new THREE.Vector2(
      corner.centerX + corner.radius * Math.cos(startAngle),
      -(corner.centerPythonY + corner.radius * Math.sin(startAngle)),
    );
    const endPoint = new THREE.Vector2(
      corner.centerX + corner.radius * Math.cos(endAngle),
      -(corner.centerPythonY + corner.radius * Math.sin(endAngle)),
    );

    if (mode === 'square') {
      const exactCorner: Record<keyof CornerRadii, THREE.Vector2> = {
        frontRight: new THREE.Vector2(halfWidth, halfDepth),
        backRight: new THREE.Vector2(halfWidth, -halfDepth),
        backLeft: new THREE.Vector2(-halfWidth, -halfDepth),
        frontLeft: new THREE.Vector2(-halfWidth, halfDepth),
      };
      points.push(exactCorner[corner.key]);
      continue;
    }

    if (mode === 'chamfer') {
      points.push(startPoint, endPoint);
      continue;
    }

    for (let step = 0; step <= segments; step += 1) {
      const angle = THREE.MathUtils.lerp(startAngle, endAngle, step / segments);
      const x = corner.centerX + corner.radius * Math.cos(angle);
      const pythonY = corner.centerPythonY + corner.radius * Math.sin(angle);
      points.push(new THREE.Vector2(x, -pythonY));
    }
  }
  return points;
}


function roundedOrthogonalLoop(
  vertices: THREE.Vector2[],
  cornerKeys: ShapeCornerKey[],
  settings: AquariumSettings,
  offset: number,
): THREE.Vector2[] {
  if (vertices.length !== cornerKeys.length) throw new Error('Corner keys must match polygon vertices.');
  const result: THREE.Vector2[] = [];
  const segments = Math.max(1, Math.round(settings.curveSegments));

  for (let index = 0; index < vertices.length; index += 1) {
    const previous = vertices[(index - 1 + vertices.length) % vertices.length]!;
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    const toPrevious = previous.clone().sub(current);
    const toNext = next.clone().sub(current);
    const previousLength = toPrevious.length();
    const nextLength = toNext.length();
    if (previousLength < EPSILON || nextLength < EPSILON) continue;
    toPrevious.divideScalar(previousLength);
    toNext.divideScalar(nextLength);

    const incoming = current.clone().sub(previous);
    const outgoing = next.clone().sub(current);
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
    const convex = cross > 0;
    const key = cornerKeys[index]!;
    const mode: CornerMode = settings.shapeCornerModes[key];
    const offsetRadius = settings.shapeCornerRadii[key] + (convex ? offset : -offset);
    const radius = mode === 'square'
      ? 0
      : THREE.MathUtils.clamp(offsetRadius, 0.002, Math.min(previousLength, nextLength) * 0.45);

    if (radius <= 0.0025) {
      result.push(current.clone());
      continue;
    }

    const start = current.clone().addScaledVector(toPrevious, radius);
    const finish = current.clone().addScaledVector(toNext, radius);
    if (mode === 'chamfer') {
      result.push(start, finish);
      continue;
    }

    const center = current.clone().addScaledVector(toPrevious, radius).addScaledVector(toNext, radius);
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const finishAngle = Math.atan2(finish.y - center.y, finish.x - center.x);
    let delta = finishAngle - startAngle;
    if (convex) {
      while (delta <= 0) delta += Math.PI * 2;
      if (delta > Math.PI) delta -= Math.PI * 2;
    } else {
      while (delta >= 0) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
    }
    for (let step = 0; step <= segments; step += 1) {
      const angle = startAngle + delta * (step / segments);
      result.push(new THREE.Vector2(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius));
    }
  }
  return result;
}

function makeLShapeLoop(settings: AquariumSettings, offset: number): THREE.Vector2[] {
  const width = Math.max(0.8, settings.width + offset * 2);
  const depth = Math.max(0.8, settings.depth + offset * 2);
  const left = -width * 0.5;
  const right = width * 0.5;
  const back = -depth * 0.5;
  const front = depth * 0.5;
  const arm = THREE.MathUtils.clamp(settings.lArmWidth + offset * 2, 0.35, width - 0.35);
  const rear = THREE.MathUtils.clamp(settings.lRearDepth + offset * 2, 0.35, depth - 0.35);
  const vertices = [
    new THREE.Vector2(left, back),
    new THREE.Vector2(right, back),
    new THREE.Vector2(right, back + rear),
    new THREE.Vector2(left + arm, back + rear),
    new THREE.Vector2(left + arm, front),
    new THREE.Vector2(left, front),
  ];
  const keys: ShapeCornerKey[] = [
    'lBackLeft', 'lBackRight', 'lOuterRight', 'lInnerElbow', 'lFrontRight', 'lFrontLeft',
  ];
  return roundedOrthogonalLoop(vertices, keys, settings, offset);
}

function makeUShapeLoop(settings: AquariumSettings, offset: number): THREE.Vector2[] {
  const width = Math.max(1.2, settings.width + offset * 2);
  const depth = Math.max(1.2, settings.depth + offset * 2);
  const left = -width * 0.5;
  const right = width * 0.5;
  const back = -depth * 0.5;
  const front = depth * 0.5;
  let leftArm = settings.uLeftArmWidth + offset * 2;
  let rightArm = settings.uRightArmWidth + offset * 2;
  const maxArmTotal = width - 0.45;
  if (leftArm + rightArm > maxArmTotal) {
    const scale = maxArmTotal / Math.max(leftArm + rightArm, EPSILON);
    leftArm *= scale;
    rightArm *= scale;
  }
  leftArm = THREE.MathUtils.clamp(leftArm, 0.25, width * 0.48);
  rightArm = THREE.MathUtils.clamp(rightArm, 0.25, width * 0.48);
  const bridge = THREE.MathUtils.clamp(settings.uBackDepth + offset * 2, 0.3, depth - 0.3);
  const vertices = [
    new THREE.Vector2(left, back),
    new THREE.Vector2(right, back),
    new THREE.Vector2(right, front),
    new THREE.Vector2(right - rightArm, front),
    new THREE.Vector2(right - rightArm, back + bridge),
    new THREE.Vector2(left + leftArm, back + bridge),
    new THREE.Vector2(left + leftArm, front),
    new THREE.Vector2(left, front),
  ];
  const keys: ShapeCornerKey[] = [
    'uBackLeft', 'uBackRight', 'uFrontRight', 'uMouthRight',
    'uInnerRight', 'uInnerLeft', 'uMouthLeft', 'uFrontLeft',
  ];
  return roundedOrthogonalLoop(vertices, keys, settings, offset);
}

export function createFootprintShapeLoop(settings: AquariumSettings, offset = 0): THREE.Vector2[] {
  if (settings.footprint === 'lShape') return makeLShapeLoop(settings, offset);
  if (settings.footprint === 'uShape') return makeUShapeLoop(settings, offset);
  const radii = offsetRadii(fitRadii(settings.width, settings.depth, effectiveRadii(settings.radii, settings.cornerModes)), offset);
  return createFootprintLoop(
    settings.width + offset * 2,
    settings.depth + offset * 2,
    radii,
    settings.cornerModes,
    settings.curveSegments,
  );
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

function closeRing(loop: THREE.Vector2[]): Ring {
  const ring: Ring = loop.map((point) => [point.x, point.y]);
  if (ring.length > 0) ring.push([ring[0]![0], ring[0]![1]]);
  return ring;
}

function loopPolygon(loop: THREE.Vector2[]): ClipPolygon {
  return [closeRing(loop)];
}

function rectanglePolygon(x0: number, z0: number, x1: number, z1: number): ClipPolygon {
  return [[
    [x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0],
  ]];
}

function cleanRing(ring: Ring): Ring {
  if (ring.length > 1) {
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (Math.abs(first[0] - last[0]) < EPSILON && Math.abs(first[1] - last[1]) < EPSILON) return ring.slice(0, -1);
  }
  return ring.slice();
}

function ringArea(ring: Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area * 0.5;
}

function appendOrientedQuad(
  positions: number[],
  indices: number[],
  points: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
  desiredNormal: THREE.Vector3,
): void {
  const start = positions.length / 3;
  for (const point of points) positions.push(point.x, point.y, point.z);
  const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
  if (normal.dot(desiredNormal) >= 0) {
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  } else {
    indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
  }
}

function appendMultiPolygonCap(
  multi: MultiPolygon,
  y: number,
  upward: boolean,
  positions: number[],
  indices: number[],
): void {
  for (const polygon of multi) {
    const contourRing = cleanRing(polygon[0]!);
    const contour = contourRing.map(([x, z]) => new THREE.Vector2(x, z));
    const holes = polygon.slice(1).map((ring) => cleanRing(ring).map(([x, z]) => new THREE.Vector2(x, z)));
    const flat = [...contour, ...holes.flat()];
    const triangles = THREE.ShapeUtils.triangulateShape(contour, holes);
    const base = positions.length / 3;
    for (const point of flat) positions.push(point.x, y, point.y);
    for (const triangle of triangles) {
      const a = flat[triangle[0]!]!;
      const b = flat[triangle[1]!]!;
      const c = flat[triangle[2]!]!;
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const upwardAsWritten = area < 0;
      const [ia, ib, ic] = triangle;
      if (upwardAsWritten === upward) indices.push(base + ia!, base + ib!, base + ic!);
      else indices.push(base + ia!, base + ic!, base + ib!);
    }
  }
}

interface PolygonPrismOptions {
  includeBottom?: boolean;
  includeTop?: boolean;
  skipSide?: (a: [number, number], b: [number, number]) => boolean;
}

function makePolygonPrism(
  multi: MultiPolygon,
  yBottom: number,
  yTop: number,
  planarUVs = false,
  options: PolygonPrismOptions = {},
): THREE.BufferGeometry {
  const includeBottom = options.includeBottom ?? true;
  const includeTop = options.includeTop ?? true;
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs = planarUVs ? [] as number[] : undefined;
  const allPoints = multi.flat(2);
  const minX = Math.min(...allPoints.map((point) => point[0]));
  const maxX = Math.max(...allPoints.map((point) => point[0]));
  const minZ = Math.min(...allPoints.map((point) => point[1]));
  const maxZ = Math.max(...allPoints.map((point) => point[1]));
  const pushUV = (x: number, z: number) => {
    if (!uvs) return;
    uvs.push((x - minX) / Math.max(maxX - minX, EPSILON), (z - minZ) / Math.max(maxZ - minZ, EPSILON));
  };

  for (const polygon of multi) {
    const rings = polygon.map(cleanRing);
    const contour = rings[0]!.map(([x, z]) => new THREE.Vector2(x, z));
    const holes = rings.slice(1).map((ring) => ring.map(([x, z]) => new THREE.Vector2(x, z)));
    const flat = [...contour, ...holes.flat()];
    const triangles = THREE.ShapeUtils.triangulateShape(contour, holes);

    const bottomBase = positions.length / 3;
    for (const point of flat) { positions.push(point.x, yBottom, point.y); pushUV(point.x, point.y); }
    const topBase = positions.length / 3;
    for (const point of flat) { positions.push(point.x, yTop, point.y); pushUV(point.x, point.y); }
    for (const triangle of triangles) {
      const a = flat[triangle[0]!]!;
      const b = flat[triangle[1]!]!;
      const c = flat[triangle[2]!]!;
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const upwardAsWritten = area < 0;
      const [ia, ib, ic] = triangle;
      if (upwardAsWritten) {
        if (includeTop) indices.push(topBase + ia!, topBase + ib!, topBase + ic!);
        if (includeBottom) indices.push(bottomBase + ia!, bottomBase + ic!, bottomBase + ib!);
      } else {
        if (includeTop) indices.push(topBase + ia!, topBase + ic!, topBase + ib!);
        if (includeBottom) indices.push(bottomBase + ia!, bottomBase + ib!, bottomBase + ic!);
      }
    }

    rings.forEach((ring, ringIndex) => {
      const area = ringArea(ring);
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        if (options.skipSide?.(a, b)) continue;
        const edgeX = b[0] - a[0];
        const edgeZ = b[1] - a[1];
        const enclosedNormal = area > 0
          ? new THREE.Vector3(-edgeZ, 0, edgeX)
          : new THREE.Vector3(edgeZ, 0, -edgeX);
        const desired = ringIndex === 0 ? enclosedNormal.negate() : enclosedNormal;
        appendOrientedQuad(
          positions,
          indices,
          [
            new THREE.Vector3(a[0], yBottom, a[1]),
            new THREE.Vector3(b[0], yBottom, b[1]),
            new THREE.Vector3(b[0], yTop, b[1]),
            new THREE.Vector3(a[0], yTop, a[1]),
          ],
          desired,
        );
        if (uvs) {
          const count = 4;
          for (let j = 0; j < count; j += 1) pushUV(j < 1 || j === 3 ? a[0] : b[0], j < 1 || j === 3 ? a[1] : b[1]);
        }
      }
    });
  }
  return finishGeometry(positions, indices, uvs);
}

function makeSurfaceFromMultiPolygon(multi: MultiPolygon, y: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  appendMultiPolygonCap(multi, y, true, positions, indices);
  const allPoints = multi.flat(2);
  const minX = Math.min(...allPoints.map((point) => point[0]));
  const maxX = Math.max(...allPoints.map((point) => point[0]));
  const minZ = Math.min(...allPoints.map((point) => point[1]));
  const maxZ = Math.max(...allPoints.map((point) => point[1]));
  const uvs: number[] = [];
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]!;
    const z = positions[index + 2]!;
    uvs.push((x - minX) / Math.max(maxX - minX, EPSILON), (z - minZ) / Math.max(maxZ - minZ, EPSILON));
  }
  return finishGeometry(positions, indices, uvs);
}

function subdivideIndexedGeometry(source: THREE.BufferGeometry, levels: number): THREE.BufferGeometry {
  let geometry = source;
  for (let level = 0; level < levels; level += 1) {
    const positionAttribute = geometry.getAttribute('position');
    const uvAttribute = geometry.getAttribute('uv');
    const indexAttribute = geometry.index;
    if (!indexAttribute) break;
    const positions: number[] = Array.from(positionAttribute.array as ArrayLike<number>);
    const uvs: number[] | undefined = uvAttribute ? Array.from(uvAttribute.array as ArrayLike<number>) : undefined;
    const nextIndices: number[] = [];
    const midpointCache = new Map<string, number>();
    const midpoint = (a: number, b: number): number => {
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const key = `${low}:${high}`;
      const cached = midpointCache.get(key);
      if (cached !== undefined) return cached;
      const index = positions.length / 3;
      positions.push(
        (positions[a * 3]! + positions[b * 3]!) * 0.5,
        (positions[a * 3 + 1]! + positions[b * 3 + 1]!) * 0.5,
        (positions[a * 3 + 2]! + positions[b * 3 + 2]!) * 0.5,
      );
      if (uvs) {
        uvs.push(
          (uvs[a * 2]! + uvs[b * 2]!) * 0.5,
          (uvs[a * 2 + 1]! + uvs[b * 2 + 1]!) * 0.5,
        );
      }
      midpointCache.set(key, index);
      return index;
    };
    for (let triangle = 0; triangle < indexAttribute.count; triangle += 3) {
      const a = indexAttribute.getX(triangle);
      const b = indexAttribute.getX(triangle + 1);
      const c = indexAttribute.getX(triangle + 2);
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      nextIndices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    const next = finishGeometry(positions, nextIndices, uvs);
    if (geometry !== source) geometry.dispose();
    geometry = next;
  }
  if (geometry !== source) source.dispose();
  return geometry;
}

function pointInRing(x: number, z: number, ring: Ring): boolean {
  let inside = false;
  const clean = cleanRing(ring);
  for (let i = 0, j = clean.length - 1; i < clean.length; j = i, i += 1) {
    const a = clean[i]!;
    const b = clean[j]!;
    const intersects = ((a[1] > z) !== (b[1] > z))
      && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInMultiPolygon(x: number, z: number, multi: MultiPolygon): boolean {
  for (const polygon of multi) {
    if (!pointInRing(x, z, polygon[0]!)) continue;
    let inHole = false;
    for (const hole of polygon.slice(1)) if (pointInRing(x, z, hole)) inHole = true;
    if (!inHole) return true;
  }
  return false;
}

function distanceToSegment(x: number, z: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared < EPSILON ? 0 : THREE.MathUtils.clamp(((x - a[0]) * dx + (z - a[1]) * dz) / lengthSquared, 0, 1);
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

function distanceToMultiBoundary(x: number, z: number, multi: MultiPolygon): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const polygon of multi) {
    for (const ring of polygon) {
      const clean = cleanRing(ring);
      for (let index = 0; index < clean.length; index += 1) {
        distance = Math.min(distance, distanceToSegment(x, z, clean[index]!, clean[(index + 1) % clean.length]!));
      }
    }
  }
  return distance;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTerrainSurface(multi: MultiPolygon, y: number, settings: AquariumSettings): THREE.BufferGeometry {
  const autoDetail = Math.max(settings.width, settings.depth) > 16 ? 1 : 0;
  let geometry = makeSurfaceFromMultiPolygon(multi, y);
  geometry = subdivideIndexedGeometry(geometry, Math.min(3, settings.groundTerrainDetail + autoDetail));
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  if (settings.groundIrregularity <= 0.0005) {
    geometry.computeVertexNormals();
    return geometry;
  }

  const allPoints = multi.flat(2);
  const minX = Math.min(...allPoints.map((point) => point[0]));
  const maxX = Math.max(...allPoints.map((point) => point[0]));
  const minZ = Math.min(...allPoints.map((point) => point[1]));
  const maxZ = Math.max(...allPoints.map((point) => point[1]));
  const random = seededRandom(settings.sandSeed + 419);
  const mounds: Array<{ x: number; z: number; sigma: number; weight: number }> = [];
  let attempts = 0;
  while (mounds.length < settings.groundMoundCount && attempts < settings.groundMoundCount * 30) {
    attempts += 1;
    const x = THREE.MathUtils.lerp(minX, maxX, random());
    const z = THREE.MathUtils.lerp(minZ, maxZ, random());
    if (!pointInMultiPolygon(x, z, multi)) continue;
    mounds.push({
      x,
      z,
      sigma: settings.groundMoundSize * THREE.MathUtils.lerp(0.62, 1.25, random()),
      weight: THREE.MathUtils.lerp(0.55, 1, random()),
    });
  }

  const rawHeights: number[] = [];
  let maximum = 0;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    let height = 0;
    for (const mound of mounds) {
      const distanceSquared = (x - mound.x) ** 2 + (z - mound.z) ** 2;
      height += Math.exp(-distanceSquared / Math.max(2 * mound.sigma * mound.sigma, EPSILON)) * mound.weight;
    }
    height += 0.08 * (Math.sin(x * 1.37 + z * 0.41 + settings.sandSeed) + 1) * 0.5;
    rawHeights.push(height);
    maximum = Math.max(maximum, height);
  }

  const edgeFadeDistance = Math.max(0.18, settings.groundMoundSize * 0.35);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const edgeDistance = distanceToMultiBoundary(x, z, multi);
    const fade = THREE.MathUtils.smoothstep(edgeDistance, 0, edgeFadeDistance);
    const normalized = maximum > EPSILON ? rawHeights[index]! / maximum : 0;
    position.setY(index, y + settings.groundIrregularity * normalized * fade);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

interface ArchProfile {
  full: THREE.Vector2[];
  roof: THREE.Vector2[];
}

function archProfile(
  halfWidth: number,
  floorY: number,
  wallHeight: number,
  roofRise: number,
  segments: number,
): ArchProfile {
  const springY = floorY + wallHeight;
  if (roofRise <= 0.002) {
    const roof = [new THREE.Vector2(-halfWidth, springY), new THREE.Vector2(halfWidth, springY)];
    return {
      roof,
      full: [new THREE.Vector2(-halfWidth, floorY), ...roof, new THREE.Vector2(halfWidth, floorY)],
    };
  }
  const roof: THREE.Vector2[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = Math.PI - (Math.PI * i) / segments;
    roof.push(new THREE.Vector2(halfWidth * Math.cos(angle), springY + roofRise * Math.sin(angle)));
  }
  return {
    roof,
    full: [new THREE.Vector2(-halfWidth, floorY), new THREE.Vector2(-halfWidth, springY), ...roof.slice(1), new THREE.Vector2(halfWidth, floorY)],
  };
}

function toTunnelLocalPoint(point: THREE.Vector2, axis: TunnelAxis, offset: number): THREE.Vector2 {
  return axis === 'depth'
    ? new THREE.Vector2(point.x - offset, point.y)
    : new THREE.Vector2(point.y - offset, -point.x);
}

function toTunnelLocalLoop(loop: THREE.Vector2[], axis: TunnelAxis, offset: number): THREE.Vector2[] {
  return loop.map((point) => toTunnelLocalPoint(point, axis, offset));
}

function orientTunnelGeometry(geometry: THREE.BufferGeometry, axis: TunnelAxis, offset: number): THREE.BufferGeometry {
  if (axis === 'depth') geometry.translate(offset, 0, 0);
  else {
    geometry.rotateY(-Math.PI * 0.5);
    geometry.translate(0, 0, offset);
  }
  return geometry;
}

interface TunnelSpan {
  exit: number;
  entrance: number;
}

function pointInVectorLoop(point: THREE.Vector2, loop: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i, i += 1) {
    const a = loop[i]!;
    const b = loop[j]!;
    const crosses = (a.y > point.y) !== (b.y > point.y);
    if (!crosses) continue;
    const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < x) inside = !inside;
  }
  return inside;
}

function lineIntervalsAtLocalX(loop: THREE.Vector2[], x: number): TunnelSpan[] {
  const intersections: number[] = [];
  for (let index = 0; index < loop.length; index += 1) {
    const a = loop[index]!;
    const b = loop[(index + 1) % loop.length]!;
    if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) {
      const t = (x - a.x) / (b.x - a.x);
      intersections.push(THREE.MathUtils.lerp(a.y, b.y, t));
    }
  }
  intersections.sort((a, b) => a - b);
  const unique = intersections.filter((value, index) => index === 0 || Math.abs(value - intersections[index - 1]!) > 1e-5);
  const intervals: TunnelSpan[] = [];
  for (let index = 0; index < unique.length - 1; index += 1) {
    const exit = unique[index]!;
    const entrance = unique[index + 1]!;
    if (pointInVectorLoop(new THREE.Vector2(x, (exit + entrance) * 0.5), loop)) intervals.push({ exit, entrance });
  }
  return intervals;
}

function intersectSpan(a: TunnelSpan, b: TunnelSpan): TunnelSpan | null {
  const exit = Math.max(a.exit, b.exit);
  const entrance = Math.min(a.entrance, b.entrance);
  return entrance - exit > 0.05 ? { exit, entrance } : null;
}

function selectTunnelSpan(localLoop: THREE.Vector2[], halfWidth: number): TunnelSpan {
  const centerIntervals = lineIntervalsAtLocalX(localLoop, 0);
  const leftIntervals = lineIntervalsAtLocalX(localLoop, -halfWidth);
  const rightIntervals = lineIntervalsAtLocalX(localLoop, halfWidth);
  const candidates: TunnelSpan[] = [];
  for (const center of centerIntervals) {
    for (const left of leftIntervals) {
      const centerLeft = intersectSpan(center, left);
      if (!centerLeft) continue;
      for (const right of rightIntervals) {
        const common = intersectSpan(centerLeft, right);
        if (common) candidates.push(common);
      }
    }
  }
  const fallback = centerIntervals.slice();
  const selected = [...candidates, ...fallback].sort((a, b) => (b.entrance - b.exit) - (a.entrance - a.exit))[0];
  if (!selected || selected.entrance - selected.exit < 0.35) {
    throw new Error('Move or narrow the tunnel so it passes through a continuous arm of the tank.');
  }
  return selected;
}

function localCorridorPolygon(axis: TunnelAxis, offset: number, halfWidth: number, span: TunnelSpan): ClipPolygon {
  if (axis === 'depth') {
    return rectanglePolygon(offset - halfWidth, span.exit, offset + halfWidth, span.entrance);
  }
  return rectanglePolygon(-span.entrance, offset - halfWidth, -span.exit, offset + halfWidth);
}

function isCorridorBoundaryEdge(
  a: [number, number],
  b: [number, number],
  axis: TunnelAxis,
  offset: number,
  halfWidth: number,
  span: TunnelSpan,
): boolean {
  const localA = toTunnelLocalPoint(new THREE.Vector2(a[0], a[1]), axis, offset);
  const localB = toTunnelLocalPoint(new THREE.Vector2(b[0], b[1]), axis, offset);
  const onSide = (
    Math.abs(Math.abs(localA.x) - halfWidth) < 1e-4
    && Math.abs(Math.abs(localB.x) - halfWidth) < 1e-4
    && Math.min(localA.y, localB.y) >= span.exit - 1e-4
    && Math.max(localA.y, localB.y) <= span.entrance + 1e-4
  );
  const onEnd = (
    (Math.abs(localA.y - span.exit) < 1e-4 && Math.abs(localB.y - span.exit) < 1e-4)
    || (Math.abs(localA.y - span.entrance) < 1e-4 && Math.abs(localB.y - span.entrance) < 1e-4)
  ) && Math.max(Math.abs(localA.x), Math.abs(localB.x)) <= halfWidth + 1e-4;
  return onSide || onEnd;
}

function containingInterval(intervals: TunnelSpan[], coordinate: number): TunnelSpan {
  return intervals.find((interval) => coordinate >= interval.exit - 1e-5 && coordinate <= interval.entrance + 1e-5)
    ?? intervals.sort((a, b) => (b.entrance - b.exit) - (a.entrance - a.exit))[0]
    ?? { exit: -1, entrance: 1 };
}

function makeGenericWaterVolumeWithTunnel(
  localWaterLoop: THREE.Vector2[],
  yBottom: number,
  yTop: number,
  voidProfile: THREE.Vector2[],
  voidRoof: THREE.Vector2[],
  halfWidth: number,
  span: TunnelSpan,
): THREE.BufferGeometry {
  const cutRegion = difference(loopPolygon(localWaterLoop), rectanglePolygon(-halfWidth, span.exit, halfWidth, span.entrance));
  const geometry = makePolygonPrism(
    cutRegion,
    yBottom,
    yTop,
    false,
    {
      includeTop: false,
      includeBottom: true,
      skipSide: (a, b) => isCorridorBoundaryEdge(a, b, 'depth', 0, halfWidth, span),
    },
  );
  const positions = Array.from((geometry.getAttribute('position') as THREE.BufferAttribute).array as ArrayLike<number>);
  const indices = geometry.index ? Array.from(geometry.index.array as ArrayLike<number>) : [];
  geometry.dispose();

  for (let index = 0; index < voidProfile.length - 1; index += 1) {
    const a = voidProfile[index]!;
    const b = voidProfile[index + 1]!;
    const tangent = b.clone().sub(a);
    const inward = new THREE.Vector3(tangent.y, -tangent.x, 0).normalize();
    appendOrientedQuad(positions, indices, [
      new THREE.Vector3(a.x, a.y, span.exit), new THREE.Vector3(a.x, a.y, span.entrance),
      new THREE.Vector3(b.x, b.y, span.entrance), new THREE.Vector3(b.x, b.y, span.exit),
    ], inward);
  }

  const addEnd = (s: number, outward: number) => {
    const sampleS = s + (outward > 0 ? -0.002 : 0.002);
    const cross = containingInterval(lineIntervalsAtLocalX(
      localWaterLoop.map((point) => new THREE.Vector2(point.y, point.x)),
      sampleS,
    ), 0);
    const xMin = cross.exit;
    const xMax = cross.entrance;
    const normal = new THREE.Vector3(0, 0, outward);
    if (-halfWidth > xMin + EPSILON) {
      appendOrientedQuad(positions, indices, [
        new THREE.Vector3(xMin, yBottom, s), new THREE.Vector3(-halfWidth, yBottom, s),
        new THREE.Vector3(-halfWidth, yTop, s), new THREE.Vector3(xMin, yTop, s),
      ], normal);
    }
    if (xMax > halfWidth + EPSILON) {
      appendOrientedQuad(positions, indices, [
        new THREE.Vector3(halfWidth, yBottom, s), new THREE.Vector3(xMax, yBottom, s),
        new THREE.Vector3(xMax, yTop, s), new THREE.Vector3(halfWidth, yTop, s),
      ], normal);
    }
    for (let index = 0; index < voidRoof.length - 1; index += 1) {
      const a = voidRoof[index]!;
      const b = voidRoof[index + 1]!;
      appendOrientedQuad(positions, indices, [
        new THREE.Vector3(a.x, a.y, s), new THREE.Vector3(b.x, b.y, s),
        new THREE.Vector3(b.x, yTop, s), new THREE.Vector3(a.x, yTop, s),
      ], normal);
    }
  };
  addEnd(span.entrance, 1);
  addEnd(span.exit, -1);
  return finishGeometry(positions, indices);
}

function makeProfileShell(
  inner: THREE.Vector2[],
  outer: THREE.Vector2[],
  zFront: number,
  zBack: number,
  capEnds = true,
  closeLowerEdges = true,
): THREE.BufferGeometry {
  if (inner.length !== outer.length) throw new Error('Tunnel profiles must match.');
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < inner.length - 1; i += 1) {
    const next = i + 1;
    const oa = outer[i]!;
    const ob = outer[next]!;
    const ia = inner[i]!;
    const ib = inner[next]!;
    const tangent = ob.clone().sub(oa);
    const outerNormal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
    const innerTangent = ib.clone().sub(ia);
    const innerNormal = new THREE.Vector3(innerTangent.y, -innerTangent.x, 0).normalize();
    appendOrientedQuad(positions, indices, [
      new THREE.Vector3(oa.x, oa.y, zFront), new THREE.Vector3(ob.x, ob.y, zFront),
      new THREE.Vector3(ob.x, ob.y, zBack), new THREE.Vector3(oa.x, oa.y, zBack),
    ], outerNormal);
    appendOrientedQuad(positions, indices, [
      new THREE.Vector3(ia.x, ia.y, zFront), new THREE.Vector3(ia.x, ia.y, zBack),
      new THREE.Vector3(ib.x, ib.y, zBack), new THREE.Vector3(ib.x, ib.y, zFront),
    ], innerNormal);
    if (capEnds) {
      appendOrientedQuad(positions, indices, [
        new THREE.Vector3(oa.x, oa.y, zFront), new THREE.Vector3(ia.x, ia.y, zFront),
        new THREE.Vector3(ib.x, ib.y, zFront), new THREE.Vector3(ob.x, ob.y, zFront),
      ], new THREE.Vector3(0, 0, Math.sign(zFront - zBack)));
      appendOrientedQuad(positions, indices, [
        new THREE.Vector3(oa.x, oa.y, zBack), new THREE.Vector3(ob.x, ob.y, zBack),
        new THREE.Vector3(ib.x, ib.y, zBack), new THREE.Vector3(ia.x, ia.y, zBack),
      ], new THREE.Vector3(0, 0, Math.sign(zBack - zFront)));
    }
  }
  if (closeLowerEdges) {
    for (const index of [0, inner.length - 1]) {
      const o = outer[index]!;
      const inside = inner[index]!;
      const desired = index === 0 ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
      appendOrientedQuad(positions, indices, [
        new THREE.Vector3(o.x, o.y, zFront), new THREE.Vector3(o.x, o.y, zBack),
        new THREE.Vector3(inside.x, inside.y, zBack), new THREE.Vector3(inside.x, inside.y, zFront),
      ], desired);
    }
  }
  return finishGeometry(positions, indices);
}

function makeArchOverheadPanel(
  roof: THREE.Vector2[],
  yTop: number,
  z0: number,
  z1: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < roof.length - 1; i += 1) {
    const a = roof[i]!;
    const b = roof[i + 1]!;
    const tangent = b.clone().sub(a);
    const lowerNormal = new THREE.Vector3(tangent.y, -tangent.x, 0).normalize();
    appendOrientedQuad(positions, indices, [
      new THREE.Vector3(a.x, a.y, z0), new THREE.Vector3(a.x, a.y, z1),
      new THREE.Vector3(b.x, b.y, z1), new THREE.Vector3(b.x, b.y, z0),
    ], lowerNormal);
    appendOrientedQuad(positions, indices, [
      new THREE.Vector3(a.x, yTop, z0), new THREE.Vector3(b.x, yTop, z0),
      new THREE.Vector3(b.x, yTop, z1), new THREE.Vector3(a.x, yTop, z1),
    ], new THREE.Vector3(0, 1, 0));
    appendOrientedQuad(positions, indices, [
      new THREE.Vector3(a.x, a.y, z0), new THREE.Vector3(b.x, b.y, z0),
      new THREE.Vector3(b.x, yTop, z0), new THREE.Vector3(a.x, yTop, z0),
    ], new THREE.Vector3(0, 0, Math.sign(z0 - z1)));
    appendOrientedQuad(positions, indices, [
      new THREE.Vector3(a.x, a.y, z1), new THREE.Vector3(a.x, yTop, z1),
      new THREE.Vector3(b.x, yTop, z1), new THREE.Vector3(b.x, b.y, z1),
    ], new THREE.Vector3(0, 0, Math.sign(z1 - z0)));
  }
  for (const point of [roof[0]!, roof[roof.length - 1]!]) {
    const desired = point.x < 0 ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
    appendOrientedQuad(positions, indices, [
      new THREE.Vector3(point.x, point.y, z0), new THREE.Vector3(point.x, yTop, z0),
      new THREE.Vector3(point.x, yTop, z1), new THREE.Vector3(point.x, point.y, z1),
    ], desired);
  }
  return finishGeometry(positions, indices);
}

function makeBoxGeometry(
  width: number,
  height: number,
  depth: number,
  centerX: number,
  centerY: number,
  centerZ: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  // Portal panels are merged with procedural geometry that has no UV channel.
  // Remove BoxGeometry's automatic UVs so BufferGeometryUtils can merge them.
  geometry.deleteAttribute('uv');
  geometry.translate(centerX, centerY, centerZ);
  return geometry;
}

function makeEndWallWithPortal(
  leftX: number,
  rightX: number,
  z0: number,
  z1: number,
  yBottom: number,
  yTop: number,
  outerHalf: number,
  roof: THREE.Vector2[],
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (-outerHalf > leftX + EPSILON) {
    parts.push(makeBoxGeometry(-outerHalf - leftX, yTop - yBottom, Math.abs(z1 - z0), (leftX - outerHalf) * 0.5, (yBottom + yTop) * 0.5, (z0 + z1) * 0.5));
  }
  if (rightX > outerHalf + EPSILON) {
    parts.push(makeBoxGeometry(rightX - outerHalf, yTop - yBottom, Math.abs(z1 - z0), (rightX + outerHalf) * 0.5, (yBottom + yTop) * 0.5, (z0 + z1) * 0.5));
  }
  parts.push(makeArchOverheadPanel(roof, yTop, z0, z1));
  const merged = mergeGeometries(parts, false);
  for (const part of parts) if (part !== merged) part.dispose();
  if (!merged) throw new Error('Could not build portal wall.');
  return merged;
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
  group.name = settings.tunnelEnabled ? 'PUBLIC_AQUARIUM_WITH_TUNNEL' : 'PROFESSIONAL_PUBLIC_AQUARIUM';
  group.userData = {
    generator: 'Aquarium Maker 1.7',
    geometryProfile: 'composable profile/footprint system',
    profile: settings.profile,
    footprint: settings.footprint,
    authoredUnits: 'meters',
    exportUnitsPerMeter: settings.exportScale,
    frontAxis: '+Z',
    upAxis: '+Y',
    openTop: true,
    opaqueBackPanel: false,
    groundPreset: settings.groundPreset,
    groundIrregularity: settings.groundIrregularity,
    tunnelEnabled: settings.tunnelEnabled,
    tunnelAxis: settings.tunnelEnabled ? settings.tunnelAxis : undefined,
    tunnelOffset: settings.tunnelEnabled ? settings.tunnelOffset : undefined,
    tunnelProfile: settings.tunnelEnabled ? (settings.tunnelRoundness <= 0.015 ? 'square' : 'arched') : undefined,
    tunnelOrder: settings.tunnelEnabled
      ? settings.tunnelAxis === 'depth'
        ? 'ENTRANCE(+Z/front) -> EXIT(-Z/back)'
        : 'ENTRANCE(-X/left) -> EXIT(+X/right)'
      : undefined,
  };

  const glassOuter = createFootprintShapeLoop(settings, 0);
  const glassInner = createFootprintShapeLoop(settings, -settings.glassThickness);
  const baseOuter = createFootprintShapeLoop(settings, settings.baseOverhang);
  const frameOuter = createFootprintShapeLoop(settings, settings.frameOverhang);
  const frameInner = createFootprintShapeLoop(settings, -settings.frameOverlap);
  const sandInset = settings.glassThickness + settings.sandWallGap;
  const sandLoop = createFootprintShapeLoop(settings, -sandInset);
  const waterInset = settings.glassThickness + settings.waterWallGap;
  const waterLoop = createFootprintShapeLoop(settings, -waterInset);

  const profileBottom = settings.profile === 'belowFloor' ? -settings.depthBelowFloor : 0;
  const profileTop = settings.profile === 'belowFloor'
    ? settings.heightAboveFloor
    : settings.profile === 'touchPool'
      ? settings.touchPoolHeight
      : settings.height;
  const baseTop = profileBottom + settings.baseHeight;
  const bottomRimTop = baseTop + settings.bottomRimHeight;
  const topRimHeight = settings.profile === 'touchPool' ? settings.touchRimHeight : settings.topRimHeight;
  const topRimBottom = profileTop - topRimHeight;
  const glassBottom = settings.profile === 'belowFloor' ? 0 : baseTop + settings.bottomRimHeight * 0.34;
  const glassTop = profileTop - topRimHeight * 0.34;
  const sandBottom = baseTop + settings.bottomRimHeight * 0.58;
  const sandTop = sandBottom + settings.sandHeight;
  const interiorWaterCeiling = topRimBottom - 0.055;
  const waterTop = sandTop + (interiorWaterCeiling - sandTop) * settings.waterLevel;
  const waterBottom = sandTop - Math.min(0.032, settings.sandHeight * 0.45);
  const waterDepth = Math.max(0.001, waterTop - waterBottom);

  const baseMaterial = new THREE.MeshStandardMaterial({
    name: 'Plinth_Painted', color: new THREE.Color(0.19, 0.215, 0.235), metalness: 0, roughness: 0.82,
  });
  const frameMaterial = new THREE.MeshStandardMaterial({
    name: 'Frame_Steel', color: new THREE.Color(0.29, 0.315, 0.34), metalness: 0.54, roughness: 0.34,
  });
  const subFloorMaterial = new THREE.MeshStandardMaterial({
    name: 'SubFloor_Body', color: new THREE.Color(settings.subFloorBodyColor), metalness: 0.08, roughness: 0.72,
  });
  const basinMaterial = new THREE.MeshStandardMaterial({
    name: 'TouchPool_Basin', color: new THREE.Color(0.34, 0.39, 0.41), metalness: 0.04, roughness: 0.72,
  });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Acrylic_Glass', color: new THREE.Color(0.84, 0.96, 1), metalness: 0, roughness: 0.025,
    transmission: 0.965, thickness: settings.glassThickness, attenuationDistance: 18,
    attenuationColor: new THREE.Color(0.86, 0.96, 1), ior: 1.49,
    transparent: true, opacity: 0.12, depthWrite: false, envMapIntensity: 1.05, side: THREE.FrontSide,
  });
  const tunnelGlassMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Tunnel_Acrylic', color: new THREE.Color(0.72, 0.92, 1), metalness: 0, roughness: 0.018,
    transmission: 0.975, thickness: settings.tunnelGlassThickness, attenuationDistance: 16,
    attenuationColor: new THREE.Color(0.80, 0.95, 1), ior: 1.49,
    transparent: true, opacity: 0.105, depthWrite: false, envMapIntensity: 1.1, side: THREE.FrontSide,
  });

  const groundTexture = createGroundTexture(settings.groundPreset, settings.sandColor, settings.sandVariation, settings.sandGrain, settings.sandSeed);
  const groundRoughness = settings.groundPreset === 'algae' ? 0.78 : settings.groundPreset === 'gravel' ? 0.9 : 0.94;
  const groundMaterial = new THREE.MeshStandardMaterial({
    name: `Ground_${settings.groundPreset}`, color: 0xffffff, map: groundTexture, metalness: 0, roughness: groundRoughness,
  });

  const waterTextures = createWaterTextures(
    settings.waterColor,
    settings.waveStrength,
    settings.waterSeed,
    settings.waterSurfaceStyle,
    settings.waterWaveScale,
    settings.waterSurfacePreset,
  );
  const attenuationDistance = THREE.MathUtils.lerp(12, 1, settings.waterTint);
  const volumeOpacity = THREE.MathUtils.lerp(0.035, 0.11, settings.waterTint);
  const waterVolumeMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Water_Volume', color: new THREE.Color(settings.waterColor), metalness: 0, roughness: 0.05,
    transmission: 0.985, thickness: waterDepth, attenuationDistance,
    attenuationColor: new THREE.Color(settings.waterColor), ior: 1.333,
    transparent: true, opacity: volumeOpacity, depthWrite: false, envMapIntensity: 0.7, side: THREE.FrontSide,
  });
  const surfaceStyle = settings.waterSurfaceStyle;
  const isPixelWater = settings.waterSurfacePreset === 'pixel';
  const isCalmWater = settings.waterSurfacePreset === 'calm';
  const presetNormalMultiplier = isCalmWater ? 0.48 : isPixelWater ? 0.9 : 1;
  const waterSurfaceMaterial = new THREE.MeshPhysicalMaterial({
    name: `Water_Surface_${settings.waterSurfacePreset}`, color: 0xffffff, map: waterTextures.color, normalMap: waterTextures.normal,
    normalScale: new THREE.Vector2(
      (0.32 + settings.waveStrength * (0.65 + surfaceStyle * 0.55)) * presetNormalMultiplier,
      (0.32 + settings.waveStrength * (0.65 + surfaceStyle * 0.55)) * presetNormalMultiplier,
    ),
    metalness: 0,
    roughness: isPixelWater ? 0.035 : isCalmWater ? 0.085 : THREE.MathUtils.lerp(0.075, 0.025, surfaceStyle),
    transmission: isPixelWater ? 0.69 : isCalmWater ? 0.96 : THREE.MathUtils.lerp(0.94, 0.76, surfaceStyle),
    thickness: 0.02,
    attenuationDistance: isPixelWater ? 4.6 : THREE.MathUtils.lerp(10, 5, surfaceStyle),
    attenuationColor: new THREE.Color(settings.waterColor),
    ior: 1.333,
    transparent: true,
    opacity: isPixelWater ? 0.52 : isCalmWater ? 0.2 : THREE.MathUtils.lerp(0.23, 0.43, surfaceStyle),
    depthWrite: false,
    envMapIntensity: isPixelWater ? 1.18 : isCalmWater ? 0.95 : THREE.MathUtils.lerp(1.0, 1.35, surfaceStyle),
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

  const asMulti = (loop: THREE.Vector2[]): MultiPolygon => [loopPolygon(loop)] as MultiPolygon;
  const ringRegion = (outer: THREE.Vector2[], inner: THREE.Vector2[]): MultiPolygon => difference(loopPolygon(outer), loopPolygon(inner));
  const baseRegion = asMulti(baseOuter);
  const frameRegion = ringRegion(frameOuter, frameInner);
  const glassRegion = ringRegion(glassOuter, glassInner);
  const groundRegion = asMulti(sandLoop);
  const waterRegion = asMulti(waterLoop);

  const addGround = (region: MultiPolygon, yBottom: number, yTop: number): void => {
    addMesh('INTERIOR_GroundBase', makePolygonPrism(region, yBottom, yTop, true, { includeTop: false }), groundMaterial, false, true);
    addMesh('INTERIOR_GroundSurface', makeTerrainSurface(region, yTop, settings), groundMaterial, false, true);
  };

  const addWater = (region: MultiPolygon, yBottom: number, yTop: number): void => {
    const volume = addMesh(
      'WATER_Volume',
      makePolygonPrism(region, yBottom, yTop - 0.002, false, { includeTop: false }),
      waterVolumeMaterial,
      false,
      false,
    );
    volume.renderOrder = 1;
    const surface = addMesh('WATER_Surface', makeSurfaceFromMultiPolygon(region, yTop), waterSurfaceMaterial, false, false);
    surface.renderOrder = 3;
  };

  if (settings.profile === 'touchPool') {
    const rimInner = createFootprintShapeLoop(settings, -settings.touchRimWidth);
    const basinLoop = createFootprintShapeLoop(settings, -(settings.touchRimWidth + settings.touchBasinInset));
    const pedestalInset = Math.min(settings.width, settings.depth) * 0.13;
    const pedestalLoop = createFootprintShapeLoop(settings, -pedestalInset);
    const pedestalTop = Math.min(settings.touchPedestalHeight, Math.max(0, profileTop - 0.2));
    const rimBottom = profileTop - settings.touchRimHeight;
    const touchWaterTop = rimBottom - 0.035;
    const touchGroundTop = Math.max(pedestalTop + 0.05, touchWaterTop - settings.touchWaterDepth);
    const touchGroundBottom = Math.max(pedestalTop + 0.02, touchGroundTop - settings.sandHeight);
    const basinRegion = ringRegion(glassOuter, basinLoop);
    const rimRegion = ringRegion(glassOuter, rimInner);

    if (pedestalTop > 0.005) addMesh('STRUCTURE_Pedestal', makePolygonPrism(asMulti(pedestalLoop), 0, pedestalTop), baseMaterial);
    addMesh('STRUCTURE_BasinWalls', makePolygonPrism(basinRegion, pedestalTop, rimBottom), basinMaterial);
    addMesh('STRUCTURE_BasinFloor', makePolygonPrism(asMulti(basinLoop), pedestalTop, touchGroundBottom), basinMaterial);
    addMesh('STRUCTURE_TouchRim', makePolygonPrism(rimRegion, rimBottom, profileTop), frameMaterial);
    addGround(asMulti(basinLoop), touchGroundBottom, touchGroundTop);
    addWater(asMulti(basinLoop), touchGroundTop - 0.012, touchWaterTop);
  } else if (!settings.tunnelEnabled) {
    addMesh('STRUCTURE_BasePlinth', makePolygonPrism(baseRegion, profileBottom, baseTop), baseMaterial);
    addMesh('STRUCTURE_BottomRim', makePolygonPrism(frameRegion, baseTop, bottomRimTop), frameMaterial);
    if (settings.profile === 'belowFloor') {
      addMesh('STRUCTURE_SubFloorBody', makePolygonPrism(glassRegion, bottomRimTop, 0), subFloorMaterial);
      addMesh('STRUCTURE_FloorRim', makePolygonPrism(frameRegion, 0, settings.floorRimHeight), frameMaterial);
    }
    const glass = addMesh('GLASS_AcrylicShell', makePolygonPrism(glassRegion, glassBottom, glassTop), glassMaterial, false, false);
    glass.renderOrder = 5;
    addGround(groundRegion, sandBottom, sandTop);
    addWater(waterRegion, waterBottom, waterTop);
    addMesh('STRUCTURE_TopRim', makePolygonPrism(frameRegion, topRimBottom, profileTop), frameMaterial);
  } else {
    const axis = settings.tunnelAxis;
    const offset = settings.tunnelOffset;
    const innerHalf = settings.tunnelWidth * 0.5;
    const squareRoof = settings.tunnelRoundness <= 0.015;
    const maximumCrown = Math.max(0.55, waterTop - settings.tunnelGlassThickness - 0.28);
    const wallHeight = Math.min(settings.tunnelWallHeight, squareRoof ? maximumCrown : maximumCrown - 0.18);
    const requestedRise = innerHalf * settings.tunnelRoundness;
    const innerRise = squareRoof ? 0 : Math.max(0.08, Math.min(requestedRise, maximumCrown - wallHeight));
    const innerArch = archProfile(innerHalf, 0, wallHeight, innerRise, settings.tunnelCurveSegments);
    const outerHalf = innerHalf + settings.tunnelGlassThickness;
    const outerArch = squareRoof
      ? archProfile(outerHalf, 0, wallHeight + settings.tunnelGlassThickness, 0, settings.tunnelCurveSegments)
      : archProfile(outerHalf, 0, wallHeight, innerRise + settings.tunnelGlassThickness, settings.tunnelCurveSegments);
    const frameOuterHalf = outerHalf + settings.portalFrameWidth;
    const localGlassOuter = toTunnelLocalLoop(glassOuter, axis, offset);
    const localGlassInner = toTunnelLocalLoop(glassInner, axis, offset);
    const outerSpan = selectTunnelSpan(localGlassOuter, frameOuterHalf);
    const innerSpan = selectTunnelSpan(localGlassInner, outerHalf);
    const cutSpan: TunnelSpan = {
      exit: outerSpan.exit - settings.tunnelEndExtension - settings.portalFrameDepth,
      entrance: outerSpan.entrance + settings.tunnelEndExtension + settings.portalFrameDepth,
    };
    const corridor = localCorridorPolygon(axis, offset, frameOuterHalf, cutSpan);
    const baseCut = difference(loopPolygon(baseOuter), corridor);
    const bottomRimCut = difference(loopPolygon(frameOuter), loopPolygon(frameInner), corridor);
    const groundCut = difference(loopPolygon(sandLoop), corridor);
    const subFloorCut = difference(loopPolygon(glassOuter), loopPolygon(glassInner), corridor);
    const glassCut = difference(loopPolygon(glassOuter), loopPolygon(glassInner), localCorridorPolygon(axis, offset, outerHalf, outerSpan));
    const bridgeOverAquarium = settings.profile === 'belowFloor' && settings.tunnelGlassFloor;

    // A below-floor tunnel is a bridge over the continuing aquarium, not a
    // corridor cut all the way through the tank. Its base, substrate, and
    // opaque sub-floor body therefore remain continuous beneath the bridge.
    addMesh('STRUCTURE_BasePlinth', makePolygonPrism(bridgeOverAquarium ? baseRegion : baseCut, profileBottom, baseTop), baseMaterial);
    addMesh('STRUCTURE_BottomRim', makePolygonPrism(bridgeOverAquarium ? frameRegion : bottomRimCut, baseTop, bottomRimTop), frameMaterial);
    if (settings.profile === 'belowFloor') {
      addMesh('STRUCTURE_SubFloorBody', makePolygonPrism(bridgeOverAquarium ? glassRegion : subFloorCut, bottomRimTop, 0), subFloorMaterial);
      // The floor rim still opens at the portal; the bridge side rails continue
      // that rim cleanly across the passage.
      addMesh('STRUCTURE_FloorRim', makePolygonPrism(bottomRimCut, 0, settings.floorRimHeight), frameMaterial);
    }
    addMesh('STRUCTURE_TopRim', makePolygonPrism(frameRegion, topRimBottom, profileTop), frameMaterial);

    const glassShell = addMesh(
      'GLASS_AcrylicShell',
      makePolygonPrism(glassCut, glassBottom, glassTop, false, {
        skipSide: (a, b) => isCorridorBoundaryEdge(a, b, axis, offset, outerHalf, outerSpan),
      }),
      glassMaterial,
      false,
      false,
    );
    glassShell.renderOrder = 6;

    const swappedOuter = localGlassOuter.map((point) => new THREE.Vector2(point.y, point.x));
    const outerEntranceCross = containingInterval(lineIntervalsAtLocalX(swappedOuter, outerSpan.entrance - 0.002), 0);
    const outerExitCross = containingInterval(lineIntervalsAtLocalX(swappedOuter, outerSpan.exit + 0.002), 0);
    const entranceWall = addMesh(
      'GLASS_EntranceWall',
      orientTunnelGeometry(
        makeEndWallWithPortal(
          outerEntranceCross.exit, outerEntranceCross.entrance,
          innerSpan.entrance, outerSpan.entrance,
          glassBottom, glassTop, outerHalf, outerArch.roof,
        ),
        axis,
        offset,
      ),
      glassMaterial,
      false,
      false,
    );
    entranceWall.renderOrder = 6;
    const exitWall = addMesh(
      'GLASS_ExitWall',
      orientTunnelGeometry(
        makeEndWallWithPortal(
          outerExitCross.exit, outerExitCross.entrance,
          outerSpan.exit, innerSpan.exit,
          glassBottom, glassTop, outerHalf, outerArch.roof,
        ),
        axis,
        offset,
      ),
      glassMaterial,
      false,
      false,
    );
    exitWall.renderOrder = 6;

    addGround(bridgeOverAquarium ? groundRegion : groundCut, sandBottom, sandTop);

    const tunnelEntrance = outerSpan.entrance + settings.tunnelEndExtension;
    const tunnelExit = outerSpan.exit - settings.tunnelEndExtension;
    const tunnel = addMesh(
      'TUNNEL_AcrylicShell',
      orientTunnelGeometry(
        makeProfileShell(innerArch.full, outerArch.full, tunnelEntrance, tunnelExit, false, false),
        axis,
        offset,
      ),
      tunnelGlassMaterial,
      false,
      false,
    );
    tunnel.renderOrder = 4;

    const bridgeFloorThickness = Math.max(0.018, settings.tunnelGlassThickness * 0.55);
    if (bridgeOverAquarium) {
      const tunnelLength = Math.abs(tunnelEntrance - tunnelExit);
      const centerS = (tunnelEntrance + tunnelExit) * 0.5;
      const glassFloor = addMesh(
        'TUNNEL_GlassFloor',
        orientTunnelGeometry(
          makeBoxGeometry(settings.tunnelWidth, bridgeFloorThickness, tunnelLength, 0, -bridgeFloorThickness * 0.5, centerS),
          axis,
          offset,
        ),
        tunnelGlassMaterial,
        false,
        false,
      );
      glassFloor.renderOrder = 4;
      const rimHeight = settings.tunnelBridgeRimHeight;
      const rimWidth = settings.tunnelSideRimWidth;
      addMesh(
        'TUNNEL_LeftSideRim',
        orientTunnelGeometry(makeBoxGeometry(rimWidth, rimHeight, tunnelLength, -innerHalf - rimWidth * 0.5, rimHeight * 0.5, centerS), axis, offset),
        frameMaterial,
      );
      addMesh(
        'TUNNEL_RightSideRim',
        orientTunnelGeometry(makeBoxGeometry(rimWidth, rimHeight, tunnelLength, innerHalf + rimWidth * 0.5, rimHeight * 0.5, centerS), axis, offset),
        frameMaterial,
      );

      // Narrow cross strips visually divide the acrylic floor into panels,
      // making the walkable bridge immediately legible without obscuring the
      // water below it.
      const spacing = settings.tunnelBridgeSeparatorSpacing;
      const separatorCount = Math.max(0, Math.floor((tunnelLength - spacing * 0.35) / spacing));
      const startS = Math.min(tunnelEntrance, tunnelExit);
      for (let index = 1; index <= separatorCount; index += 1) {
        const sPosition = startS + (tunnelLength * index) / (separatorCount + 1);
        addMesh(
          `TUNNEL_FloorSeparator_${String(index).padStart(2, '0')}`,
          orientTunnelGeometry(
            makeBoxGeometry(
              settings.tunnelWidth + rimWidth * 2,
              Math.max(0.008, rimHeight * 0.16),
              settings.tunnelBridgeSeparatorWidth,
              0,
              Math.max(0.004, rimHeight * 0.08),
              sPosition,
            ),
            axis,
            offset,
          ),
          frameMaterial,
        );
      }
    }

    const frameArch = squareRoof
      ? archProfile(frameOuterHalf, 0, wallHeight + settings.tunnelGlassThickness + settings.portalFrameWidth, 0, settings.tunnelCurveSegments)
      : archProfile(frameOuterHalf, 0, wallHeight, innerRise + settings.tunnelGlassThickness + settings.portalFrameWidth, settings.tunnelCurveSegments);
    addMesh(
      'TUNNEL_01_EntranceFrame',
      orientTunnelGeometry(
        makeProfileShell(outerArch.full, frameArch.full, outerSpan.entrance + settings.portalFrameDepth, outerSpan.entrance - 0.015, true, true),
        axis,
        offset,
      ),
      frameMaterial,
    );
    addMesh(
      'TUNNEL_02_ExitFrame',
      orientTunnelGeometry(
        makeProfileShell(outerArch.full, frameArch.full, outerSpan.exit + 0.015, outerSpan.exit - settings.portalFrameDepth, true, true),
        axis,
        offset,
      ),
      frameMaterial,
    );

    const voidHalf = outerHalf + settings.tunnelWaterClearance;
    // For bridge tunnels the dry void starts at the acrylic floor. Water and
    // substrate continue beneath it through the full footprint.
    const tunnelVoidBottom = bridgeOverAquarium
      ? -bridgeFloorThickness - settings.tunnelWaterClearance
      : waterBottom;
    const voidArch = squareRoof
      ? archProfile(
        voidHalf,
        tunnelVoidBottom,
        Math.max(0.01, wallHeight + settings.tunnelGlassThickness + settings.tunnelWaterClearance - tunnelVoidBottom),
        0,
        settings.tunnelCurveSegments,
      )
      : archProfile(
        voidHalf,
        tunnelVoidBottom,
        Math.max(0.01, wallHeight + settings.tunnelWaterClearance - tunnelVoidBottom),
        innerRise + settings.tunnelGlassThickness + settings.tunnelWaterClearance,
        settings.tunnelCurveSegments,
      );
    const localWaterLoop = toTunnelLocalLoop(waterLoop, axis, offset);
    const waterSpan = selectTunnelSpan(localWaterLoop, voidHalf);
    let tunnelWaterGeometry: THREE.BufferGeometry;
    if (bridgeOverAquarium && tunnelVoidBottom > waterBottom + 0.01) {
      const lowerWater = makePolygonPrism(waterRegion, waterBottom, tunnelVoidBottom, false, { includeTop: false });
      const upperWater = orientTunnelGeometry(
        makeGenericWaterVolumeWithTunnel(localWaterLoop, tunnelVoidBottom, waterTop - 0.004, voidArch.full, voidArch.roof, voidHalf, waterSpan),
        axis,
        offset,
      );
      const merged = mergeGeometries([lowerWater, upperWater], false);
      if (!merged) {
        lowerWater.dispose();
        upperWater.dispose();
        throw new Error('Could not build the continuing water beneath the tunnel bridge.');
      }
      lowerWater.dispose();
      upperWater.dispose();
      tunnelWaterGeometry = merged;
    } else {
      tunnelWaterGeometry = orientTunnelGeometry(
        makeGenericWaterVolumeWithTunnel(localWaterLoop, waterBottom, waterTop - 0.004, voidArch.full, voidArch.roof, voidHalf, waterSpan),
        axis,
        offset,
      );
    }
    const volume = addMesh(
      'WATER_Volume',
      tunnelWaterGeometry,
      waterVolumeMaterial,
      false,
      false,
    );
    volume.renderOrder = 1;
    const surface = addMesh('WATER_Surface', makeSurfaceFromMultiPolygon(waterRegion, waterTop), waterSurfaceMaterial, false, false);
    surface.renderOrder = 3;
  }

  const stats = meshStats(group);
  return {
    group,
    ...stats,
    dispose: () => {
      const disposedMaterials = new Set<THREE.Material>();
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!disposedMaterials.has(material)) {
            disposeMaterial(material);
            disposedMaterials.add(material);
          }
        }
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
  clone.userData = { ...source.userData, outputUnitsPerMeter: scale };
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
