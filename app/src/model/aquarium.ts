import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as polygonClippingModule from 'polygon-clipping';
import type { MultiPolygon, Polygon as ClipPolygon, Ring } from 'polygon-clipping';
import type { AquariumSettings, CornerMode, CornerModes, CornerRadii, PassageSettings, PassageSide, ShapeCornerKey, TunnelAxis } from './settings';
import { activePassages } from './settings';
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
  union: (
    subject: ClipPolygon | MultiPolygon,
    ...polygons: Array<ClipPolygon | MultiPolygon>
  ) => MultiPolygon;
};

// polygon-clipping is published as CommonJS. Vite exposes named exports while
// Node-based validation sees the API under `default`, so normalize both forms.
const polygonClipping = (
  (polygonClippingModule as unknown as { default?: PolygonClippingApi }).default
  ?? (polygonClippingModule as unknown as PolygonClippingApi)
);
const { difference, union } = polygonClipping;

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
    centerZ: number;
    radius: number;
    start: number;
    end: number;
  }> = [
    // +Z is front everywhere in the editor. Keep the key-to-corner mapping in
    // this world coordinate system so Front Left can never be mirrored to Back Left.
    { key: 'frontRight', centerX: halfWidth - radii.frontRight, centerZ: halfDepth - radii.frontRight, radius: radii.frontRight, start: 90, end: 0 },
    { key: 'backRight', centerX: halfWidth - radii.backRight, centerZ: -halfDepth + radii.backRight, radius: radii.backRight, start: 0, end: -90 },
    { key: 'backLeft', centerX: -halfWidth + radii.backLeft, centerZ: -halfDepth + radii.backLeft, radius: radii.backLeft, start: -90, end: -180 },
    { key: 'frontLeft', centerX: -halfWidth + radii.frontLeft, centerZ: halfDepth - radii.frontLeft, radius: radii.frontLeft, start: -180, end: -270 },
  ];

  const points: THREE.Vector2[] = [];
  for (const corner of corners) {
    const mode = modes[corner.key];
    const startAngle = THREE.MathUtils.degToRad(corner.start);
    const endAngle = THREE.MathUtils.degToRad(corner.end);
    const startPoint = new THREE.Vector2(
      corner.centerX + corner.radius * Math.cos(startAngle),
      corner.centerZ + corner.radius * Math.sin(startAngle),
    );
    const endPoint = new THREE.Vector2(
      corner.centerX + corner.radius * Math.cos(endAngle),
      corner.centerZ + corner.radius * Math.sin(endAngle),
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
      points.push(new THREE.Vector2(x, corner.centerZ + corner.radius * Math.sin(angle)));
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

function transformFootprintPoint(point: THREE.Vector2, settings: AquariumSettings): THREE.Vector2 {
  const transformed = point.clone();
  if (settings.footprintMirrored) transformed.x *= -1;
  const angle = THREE.MathUtils.degToRad(settings.footprintRotation);
  if (Math.abs(angle) > EPSILON) transformed.rotateAround(new THREE.Vector2(0, 0), -angle);
  return transformed;
}

function transformFootprintLoop(loop: THREE.Vector2[], settings: AquariumSettings): THREE.Vector2[] {
  return loop.map((point) => transformFootprintPoint(point, settings));
}

function makeLShapeLoop(settings: AquariumSettings, offset: number): THREE.Vector2[] {
  const width = Math.max(0.8, settings.lHorizontalArmLength + offset * 2);
  const depth = Math.max(0.8, settings.lVerticalArmLength + offset * 2);
  const left = -width * 0.5;
  const right = width * 0.5;
  const back = -depth * 0.5;
  const front = depth * 0.5;
  const verticalWidth = THREE.MathUtils.clamp(settings.lVerticalArmWidth + offset * 2, 0.18, width - 0.18);
  const horizontalWidth = THREE.MathUtils.clamp(settings.lHorizontalArmWidth + offset * 2, 0.18, depth - 0.18);
  const vertices = [
    new THREE.Vector2(left, back),
    new THREE.Vector2(right, back),
    new THREE.Vector2(right, back + horizontalWidth),
    new THREE.Vector2(left + verticalWidth, back + horizontalWidth),
    new THREE.Vector2(left + verticalWidth, front),
    new THREE.Vector2(left, front),
  ];
  const keys: ShapeCornerKey[] = [
    'lBackLeft', 'lBackRight', 'lOuterRight', 'lInnerElbow', 'lFrontRight', 'lFrontLeft',
  ];
  return transformFootprintLoop(roundedOrthogonalLoop(vertices, keys, settings, offset), settings);
}

function makeUShapeLoop(settings: AquariumSettings, offset: number): THREE.Vector2[] {
  const width = Math.max(1.2, settings.uBridgeLength + offset * 2);
  const leftLength = Math.max(0.5, settings.uLeftArmLength + offset * 2);
  const rightLength = Math.max(0.5, settings.uRightArmLength + offset * 2);
  const depth = Math.max(leftLength, rightLength);
  const left = -width * 0.5;
  const right = width * 0.5;
  const back = -depth * 0.5;
  let leftArm = settings.uLeftArmWidth + offset * 2;
  let rightArm = settings.uRightArmWidth + offset * 2;
  const maxArmTotal = width - 0.3;
  if (leftArm + rightArm > maxArmTotal) {
    const scale = maxArmTotal / Math.max(leftArm + rightArm, EPSILON);
    leftArm *= scale;
    rightArm *= scale;
  }
  leftArm = THREE.MathUtils.clamp(leftArm, 0.15, width * 0.48);
  rightArm = THREE.MathUtils.clamp(rightArm, 0.15, width * 0.48);
  const bridge = THREE.MathUtils.clamp(settings.uBridgeDepth + offset * 2, 0.15, Math.min(leftLength, rightLength) - 0.12);
  const leftFront = back + leftLength;
  const rightFront = back + rightLength;
  const vertices = [
    new THREE.Vector2(left, back),
    new THREE.Vector2(right, back),
    new THREE.Vector2(right, rightFront),
    new THREE.Vector2(right - rightArm, rightFront),
    new THREE.Vector2(right - rightArm, back + bridge),
    new THREE.Vector2(left + leftArm, back + bridge),
    new THREE.Vector2(left + leftArm, leftFront),
    new THREE.Vector2(left, leftFront),
  ];
  const keys: ShapeCornerKey[] = [
    'uBackLeft', 'uBackRight', 'uFrontRight', 'uMouthRight',
    'uInnerRight', 'uInnerLeft', 'uMouthLeft', 'uFrontLeft',
  ];
  return transformFootprintLoop(roundedOrthogonalLoop(vertices, keys, settings, offset), settings);
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

  const moundHeights: number[] = [];
  const noiseHeights: number[] = [];
  let maximumMound = 0;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    let mound = 0;
    for (const source of mounds) {
      const distanceSquared = (x - source.x) ** 2 + (z - source.z) ** 2;
      mound += Math.exp(-distanceSquared / Math.max(2 * source.sigma * source.sigma, EPSILON)) * source.weight;
    }
    const noise = (
      Math.sin(x * 1.37 + z * 0.41 + settings.sandSeed * 0.013)
      + Math.sin(x * 0.53 - z * 1.11 + settings.sandSeed * 0.021)
      + Math.sin(x * 2.17 + z * 1.73 + settings.sandSeed * 0.007)
    ) / 6 + 0.5;
    moundHeights.push(mound);
    noiseHeights.push(noise);
    maximumMound = Math.max(maximumMound, mound);
  }

  const edgeFadeDistance = Math.max(0.02, settings.groundWallFalloff);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const edgeDistance = distanceToMultiBoundary(x, z, multi);
    const fade = edgeFadeDistance <= EPSILON ? 1 : THREE.MathUtils.smoothstep(edgeDistance, 0, edgeFadeDistance);
    const normalizedMound = maximumMound > EPSILON ? moundHeights[index]! / maximumMound : 0;
    const elevation = settings.groundMoundHeight * normalizedMound + settings.groundIrregularity * noiseHeights[index]!;
    position.setY(index, y + elevation * fade);
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
  z0: number,
  z1: number,
  yBottom: number,
  yTop: number,
  roof: THREE.Vector2[],
): THREE.BufferGeometry {
  void yBottom;
  return makeArchOverheadPanel(roof, yTop, z0, z1);
}


interface PassageSegment {
  a: THREE.Vector2;
  b: THREE.Vector2;
  axis: TunnelAxis;
  offset: number;
  startS: number;
  endS: number;
  touchesBendAtStart: boolean;
  touchesBendAtEnd: boolean;
}

interface PassagePortal {
  side: PassageSide;
  point: THREE.Vector2;
  axis: TunnelAxis;
  offset: number;
  coordinate: number;
  outwardSign: number;
  label: 'entrance' | 'exit';
}

interface ResolvedPassage {
  settings: PassageSettings;
  segments: PassageSegment[];
  portals: PassagePortal[];
  bend?: THREE.Vector2;
  cutRects: Array<{ x0: number; z0: number; x1: number; z1: number }>;
  cutPolygon: MultiPolygon;
  voidPolygon: MultiPolygon;
  floorPolygon: MultiPolygon;
  crown: number;
  profileCeiling: number;
  voidBottom: number;
  bridgeFloorThickness: number;
}

function sideAxis(side: PassageSide): TunnelAxis {
  return side === 'front' || side === 'back' ? 'depth' : 'width';
}

function sideOutwardSign(side: PassageSide): number {
  // In tunnel-local longitudinal coordinates front and left are positive.
  return side === 'front' || side === 'left' ? 1 : -1;
}

function localToWorld(localX: number, localS: number, axis: TunnelAxis, offset: number): THREE.Vector2 {
  return axis === 'depth'
    ? new THREE.Vector2(localX + offset, localS)
    : new THREE.Vector2(-localS, localX + offset);
}

function boundaryForSide(
  loop: THREE.Vector2[],
  side: PassageSide,
  offset: number,
  halfWidth: number,
): PassagePortal {
  const axis = sideAxis(side);
  const local = toTunnelLocalLoop(loop, axis, offset);
  const span = selectTunnelSpan(local, halfWidth);
  const outwardSign = sideOutwardSign(side);
  const coordinate = outwardSign > 0 ? span.entrance : span.exit;
  return {
    side,
    point: localToWorld(0, coordinate, axis, offset),
    axis,
    offset,
    coordinate,
    outwardSign,
    label: 'entrance',
  };
}

function segmentFromPoints(a: THREE.Vector2, b: THREE.Vector2): PassageSegment {
  const delta = b.clone().sub(a);
  if (Math.abs(delta.x) < 1e-5) {
    return {
      a: a.clone(), b: b.clone(), axis: 'depth', offset: (a.x + b.x) * 0.5,
      startS: a.y, endS: b.y, touchesBendAtStart: false, touchesBendAtEnd: false,
    };
  }
  if (Math.abs(delta.y) < 1e-5) {
    return {
      a: a.clone(), b: b.clone(), axis: 'width', offset: (a.y + b.y) * 0.5,
      startS: -a.x, endS: -b.x, touchesBendAtStart: false, touchesBendAtEnd: false,
    };
  }
  throw new Error('Passage segments must be axis aligned.');
}

function inwardDirection(side: PassageSide): THREE.Vector2 {
  if (side === 'front') return new THREE.Vector2(0, -1);
  if (side === 'back') return new THREE.Vector2(0, 1);
  if (side === 'left') return new THREE.Vector2(1, 0);
  return new THREE.Vector2(-1, 0);
}

function segmentRect(
  segment: PassageSegment,
  halfWidth: number,
  extendStart = 0,
  extendEnd = 0,
): { polygon: ClipPolygon; bounds: { x0: number; z0: number; x1: number; z1: number } } {
  const a = segment.a.clone();
  const b = segment.b.clone();
  const direction = b.clone().sub(a).normalize();
  a.addScaledVector(direction, -extendStart);
  b.addScaledVector(direction, extendEnd);
  const x0 = Math.min(a.x, b.x) - (segment.axis === 'depth' ? halfWidth : 0);
  const x1 = Math.max(a.x, b.x) + (segment.axis === 'depth' ? halfWidth : 0);
  const z0 = Math.min(a.y, b.y) - (segment.axis === 'width' ? halfWidth : 0);
  const z1 = Math.max(a.y, b.y) + (segment.axis === 'width' ? halfWidth : 0);
  return { polygon: rectanglePolygon(x0, z0, x1, z1), bounds: { x0, z0, x1, z1 } };
}

function unionClipPolygons(polygons: Array<ClipPolygon | MultiPolygon>): MultiPolygon {
  if (polygons.length === 0) return [];
  if (polygons.length === 1) {
    const first = polygons[0]!;
    return (Array.isArray(first[0]?.[0]?.[0]) ? first : [first]) as MultiPolygon;
  }
  return union(polygons[0]!, ...polygons.slice(1));
}

function routePolygon(
  segments: PassageSegment[],
  bend: THREE.Vector2 | undefined,
  halfWidth: number,
  portalExtensions: Array<{ segmentIndex: number; start: number; end: number }> = [],
): { multi: MultiPolygon; rects: Array<{ x0: number; z0: number; x1: number; z1: number }> } {
  const polygons: ClipPolygon[] = [];
  const rects: Array<{ x0: number; z0: number; x1: number; z1: number }> = [];
  segments.forEach((segment, index) => {
    const extension = portalExtensions.find((item) => item.segmentIndex === index);
    const result = segmentRect(segment, halfWidth, extension?.start ?? 0, extension?.end ?? 0);
    polygons.push(result.polygon);
    rects.push(result.bounds);
  });
  if (bend) {
    const bounds = { x0: bend.x - halfWidth, z0: bend.y - halfWidth, x1: bend.x + halfWidth, z1: bend.y + halfWidth };
    polygons.push(rectanglePolygon(bounds.x0, bounds.z0, bounds.x1, bounds.z1));
    rects.push(bounds);
  }
  return { multi: unionClipPolygons(polygons), rects };
}

function pointInsideWithClearance(point: THREE.Vector2, loop: THREE.Vector2[], halfWidth: number): boolean {
  if (!pointInVectorLoop(point, loop)) return false;
  const checks = [
    new THREE.Vector2(halfWidth, 0), new THREE.Vector2(-halfWidth, 0),
    new THREE.Vector2(0, halfWidth), new THREE.Vector2(0, -halfWidth),
  ];
  return checks.every((offset) => pointInVectorLoop(point.clone().add(offset), loop));
}

function validateRouteInside(segments: PassageSegment[], loop: THREE.Vector2[], halfWidth: number): void {
  for (const segment of segments) {
    const lateral = segment.axis === 'depth' ? new THREE.Vector2(halfWidth, 0) : new THREE.Vector2(0, halfWidth);
    for (let step = 1; step < 10; step += 1) {
      const point = segment.a.clone().lerp(segment.b, step / 10);
      const valid = pointInVectorLoop(point, loop)
        && pointInVectorLoop(point.clone().add(lateral), loop)
        && pointInVectorLoop(point.clone().sub(lateral), loop);
      if (!valid) {
        throw new Error('Move or narrow this passage so its complete route stays inside a continuous part of the tank.');
      }
    }
  }
}

function resolvePassage(
  passage: PassageSettings,
  footprintLoop: THREE.Vector2[],
  waterBottom: number,
  belowFloor: boolean,
  profileCeiling: number,
): ResolvedPassage {
  const innerHalf = passage.width * 0.5;
  const outerHalf = innerHalf + passage.glassThickness;
  const cutHalf = outerHalf;
  const voidHalf = outerHalf + passage.waterClearance;
  const maximumCrown = Math.max(0.42, profileCeiling - passage.glassThickness);
  const squareRoof = passage.roundness <= 0.015;
  const wallHeight = Math.min(passage.wallHeight, squareRoof ? maximumCrown : Math.max(0.15, maximumCrown - 0.12));
  const rise = squareRoof ? 0 : Math.max(0.06, Math.min(innerHalf * passage.roundness, maximumCrown - wallHeight));
  const crown = wallHeight + rise + passage.glassThickness;
  const bridgeFloorThickness = Math.max(0.018, passage.glassThickness * 0.55);
  const voidBottom = belowFloor && passage.glassFloor ? -bridgeFloorThickness - passage.waterClearance : waterBottom;

  const entry = boundaryForSide(footprintLoop, passage.entrySide, passage.entryOffset, cutHalf);
  entry.label = 'entrance';
  const portals: PassagePortal[] = [entry];
  const segments: PassageSegment[] = [];
  let bend: THREE.Vector2 | undefined;

  if (passage.kind === 'alcove') {
    const interiorStart = entry.point.clone().addScaledVector(inwardDirection(passage.entrySide), 0.025);
    const end = interiorStart.clone().addScaledVector(inwardDirection(passage.entrySide), passage.alcoveDepth);
    const segment = segmentFromPoints(interiorStart, end);
    segments.push(segment);
    validateRouteInside(segments, footprintLoop, voidHalf);
  } else if (passage.route === 'straight') {
    const exit = boundaryForSide(footprintLoop, passage.exitSide, passage.entryOffset, cutHalf);
    exit.label = 'exit';
    portals.push(exit);
    const segment = segmentFromPoints(entry.point, exit.point);
    segments.push(segment);
    validateRouteInside(segments, footprintLoop, voidHalf);
  } else {
    const exit = boundaryForSide(footprintLoop, passage.exitSide, passage.exitOffset, cutHalf);
    exit.label = 'exit';
    portals.push(exit);
    if (sideAxis(passage.entrySide) === 'depth') bend = new THREE.Vector2(passage.entryOffset, passage.exitOffset);
    else bend = new THREE.Vector2(passage.exitOffset, passage.entryOffset);
    if (!pointInsideWithClearance(bend, footprintLoop, voidHalf)) {
      throw new Error('The L-tunnel bend is outside the tank. Move either entrance offset toward a solid arm.');
    }
    const first = segmentFromPoints(entry.point, bend);
    first.touchesBendAtEnd = true;
    const second = segmentFromPoints(bend, exit.point);
    second.touchesBendAtStart = true;
    segments.push(first, second);
    validateRouteInside(segments, footprintLoop, voidHalf);
  }

  const portalExtension = passage.endExtension + passage.portalFrameDepth + 0.03;
  const extensions: Array<{ segmentIndex: number; start: number; end: number }> = [];
  if (segments.length > 0) {
    const first = segments[0]!;
    const firstStartsAtEntry = first.a.distanceTo(entry.point) < first.b.distanceTo(entry.point);
    extensions.push({ segmentIndex: 0, start: firstStartsAtEntry ? portalExtension : 0, end: firstStartsAtEntry ? 0 : portalExtension });
    if (passage.kind === 'tunnel') {
      const lastIndex = segments.length - 1;
      const last = segments[lastIndex]!;
      const exit = portals[1]!;
      const exitAtEnd = last.b.distanceTo(exit.point) < last.a.distanceTo(exit.point);
      const existing = extensions.find((item) => item.segmentIndex === lastIndex);
      if (existing) {
        if (exitAtEnd) existing.end = portalExtension;
        else existing.start = portalExtension;
      } else extensions.push({ segmentIndex: lastIndex, start: exitAtEnd ? 0 : portalExtension, end: exitAtEnd ? portalExtension : 0 });
    }
  }
  const cut = routePolygon(segments, bend, cutHalf, extensions);
  const dry = routePolygon(segments, bend, voidHalf);
  const floor = routePolygon(segments, bend, innerHalf);
  return {
    settings: passage,
    segments,
    portals,
    bend,
    cutRects: cut.rects,
    cutPolygon: cut.multi,
    voidPolygon: dry.multi,
    floorPolygon: floor.multi,
    crown,
    profileCeiling,
    voidBottom,
    bridgeFloorThickness,
  };
}

function corridorBoundaryEdge(
  a: [number, number],
  b: [number, number],
  rects: Array<{ x0: number; z0: number; x1: number; z1: number }>,
): boolean {
  const tolerance = 2e-4;
  return rects.some((rect) => {
    const vertical = Math.abs(a[0] - b[0]) < tolerance
      && (Math.abs(a[0] - rect.x0) < tolerance || Math.abs(a[0] - rect.x1) < tolerance)
      && Math.min(a[1], b[1]) >= rect.z0 - tolerance
      && Math.max(a[1], b[1]) <= rect.z1 + tolerance;
    const horizontal = Math.abs(a[1] - b[1]) < tolerance
      && (Math.abs(a[1] - rect.z0) < tolerance || Math.abs(a[1] - rect.z1) < tolerance)
      && Math.min(a[0], b[0]) >= rect.x0 - tolerance
      && Math.max(a[0], b[0]) <= rect.x1 + tolerance;
    return vertical || horizontal;
  });
}

function passageProfile(passage: PassageSettings, profileCeiling: number): {
  inner: ArchProfile;
  outer: ArchProfile;
  frame: ArchProfile;
  crown: number;
  outerHalf: number;
  frameHalf: number;
} {
  const innerHalf = passage.width * 0.5;
  const maximumCrown = Math.max(0.42, profileCeiling - passage.glassThickness);
  const square = passage.roundness <= 0.015;
  const wallHeight = Math.min(passage.wallHeight, square ? maximumCrown : Math.max(0.15, maximumCrown - 0.12));
  const rise = square ? 0 : Math.max(0.06, Math.min(innerHalf * passage.roundness, maximumCrown - wallHeight));
  const inner = archProfile(innerHalf, 0, wallHeight, rise, passage.curveSegments);
  const outerHalf = innerHalf + passage.glassThickness;
  const outer = square
    ? archProfile(outerHalf, 0, wallHeight + passage.glassThickness, 0, passage.curveSegments)
    : archProfile(outerHalf, 0, wallHeight, rise + passage.glassThickness, passage.curveSegments);
  const frameHalf = outerHalf + passage.portalFrameWidth;
  const frame = square
    ? archProfile(frameHalf, 0, wallHeight + passage.glassThickness + passage.portalFrameWidth, 0, passage.curveSegments)
    : archProfile(frameHalf, 0, wallHeight, rise + passage.glassThickness + passage.portalFrameWidth, passage.curveSegments);
  return { inner, outer, frame, crown: wallHeight + rise + passage.glassThickness, outerHalf, frameHalf };
}

function makeProfileEndCap(profile: THREE.Vector2[], s0: number, s1: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(profile);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: Math.abs(s1 - s0), bevelEnabled: false, steps: 1 });
  geometry.deleteAttribute('uv');
  geometry.translate(0, 0, Math.min(s0, s1));
  geometry.computeVertexNormals();
  return geometry;
}

/** The centre line is authoritative for shell, dry-space and exported route data. */
function routeSamples(resolved: ResolvedPassage): THREE.Vector2[] {
  const first = resolved.segments[0]!;
  if (!resolved.bend || resolved.segments.length !== 2) return [first.a.clone(), first.b.clone()];
  const second = resolved.segments[1]!;
  // An L tunnel is two straight corridors meeting in one square corner. Its
  // only curves are in the vertical portal/roof profile, never in plan view.
  return [first.a.clone(), resolved.bend.clone(), second.b.clone()];
}

/**
 * Offset a point on an orthogonal route. At a corner, intersect the two
 * offset legs instead of offsetting along their averaged direction: the
 * latter pulls a 90-degree miter inward by roughly 29%.
 */
function offsetRoutePoint(route: THREE.Vector2[], index: number, offset: number): THREE.Vector2 {
  const point = route[index]!;
  if (index === 0 || index === route.length - 1) {
    const neighbor = route[index === 0 ? 1 : route.length - 2]!;
    const direction = (index === 0 ? neighbor.clone().sub(point) : point.clone().sub(neighbor)).normalize();
    return point.clone().add(new THREE.Vector2(-direction.y, direction.x).multiplyScalar(offset));
  }

  const incoming = point.clone().sub(route[index - 1]!).normalize();
  const outgoing = route[index + 1]!.clone().sub(point).normalize();
  const incomingNormal = new THREE.Vector2(-incoming.y, incoming.x);
  const outgoingNormal = new THREE.Vector2(-outgoing.y, outgoing.x);
  const miter = incomingNormal.clone().add(outgoingNormal);
  if (miter.lengthSq() < EPSILON * EPSILON) return point.clone().add(outgoingNormal.multiplyScalar(offset));
  miter.normalize();
  const denominator = miter.dot(outgoingNormal);
  if (Math.abs(denominator) < EPSILON) return point.clone().add(outgoingNormal.multiplyScalar(offset));
  return point.clone().add(miter.multiplyScalar(offset / denominator));
}

function makeProfileSweep(inner: THREE.Vector2[], outer: THREE.Vector2[], route: THREE.Vector2[]): THREE.BufferGeometry {
  if (inner.length !== outer.length || route.length < 2) throw new Error('Invalid passage sweep.');
  const positions: number[] = [];
  const indices: number[] = [];
  const station = (index: number, local: THREE.Vector2): THREE.Vector3 => {
    const point = offsetRoutePoint(route, index, local.x);
    return new THREE.Vector3(point.x, local.y, point.y);
  };
  for (let r = 0; r < route.length - 1; r += 1) {
    for (let p = 0; p < inner.length - 1; p += 1) {
      const a = outer[p]!; const b = outer[p + 1]!;
      appendOrientedQuad(positions, indices, [station(r, a), station(r, b), station(r + 1, b), station(r + 1, a)], station(r, a).clone().sub(station(r, inner[p]!)).normalize());
      const ia = inner[p]!; const ib = inner[p + 1]!;
      appendOrientedQuad(positions, indices, [station(r, ia), station(r + 1, ia), station(r + 1, ib), station(r, ib)], station(r, ia).clone().sub(station(r, outer[p]!)).normalize());
    }
    for (const p of [0, inner.length - 1]) {
      appendOrientedQuad(positions, indices, [station(r, outer[p]!), station(r + 1, outer[p]!), station(r + 1, inner[p]!), station(r, inner[p]!)], station(r, outer[p]!).clone().sub(station(r, inner[p]!)).normalize());
    }
  }
  return finishGeometry(positions, indices);
}

function portalWallGeometry(
  portal: PassagePortal,
  resolved: ResolvedPassage,
  glassOuter: THREE.Vector2[],
  glassInner: THREE.Vector2[],
  glassBottom: number,
  glassTop: number,
): THREE.BufferGeometry {
  const profile = passageProfile(resolved.settings, resolved.profileCeiling);
  const outerLocal = toTunnelLocalLoop(glassOuter, portal.axis, portal.offset);
  const innerLocal = toTunnelLocalLoop(glassInner, portal.axis, portal.offset);
  const outerSpan = selectTunnelSpan(outerLocal, profile.frameHalf);
  const innerSpan = selectTunnelSpan(innerLocal, profile.outerHalf);
  const outerCoordinate = portal.outwardSign > 0 ? outerSpan.entrance : outerSpan.exit;
  const innerCoordinate = portal.outwardSign > 0 ? innerSpan.entrance : innerSpan.exit;
  return orientTunnelGeometry(
    makeEndWallWithPortal(
      innerCoordinate,
      outerCoordinate,
      glassBottom,
      glassTop,
      profile.outer.roof,
    ),
    portal.axis,
    portal.offset,
  );
}

function portalFrameGeometry(
  portal: PassagePortal,
  resolved: ResolvedPassage,
): THREE.BufferGeometry {
  const passage = resolved.settings;
  const profile = passageProfile(passage, resolved.profileCeiling);
  const outer = portal.coordinate + portal.outwardSign * passage.endExtension;
  const inner = outer - portal.outwardSign * passage.portalFrameDepth;
  return orientTunnelGeometry(
    makeProfileShell(profile.outer.full, profile.frame.full, outer, inner, true, true),
    portal.axis,
    portal.offset,
  );
}

function makePassageShellGeometries(resolved: ResolvedPassage): THREE.BufferGeometry[] {
  const passage = resolved.settings;
  const profile = passageProfile(passage, resolved.profileCeiling);
  const pieces: THREE.BufferGeometry[] = [makeProfileSweep(profile.inner.full, profile.outer.full, routeSamples(resolved))];
  if (passage.kind === 'alcove') {
    const final = resolved.segments[resolved.segments.length - 1]!;
    const endpoint = final.b;
    const coordinate = final.axis === 'depth' ? endpoint.y : -endpoint.x;
    const cap = makeProfileEndCap(profile.outer.full, coordinate - passage.glassThickness * 0.5, coordinate + passage.glassThickness * 0.5);
    pieces.push(orientTunnelGeometry(cap, final.axis, final.offset));
  }
  return pieces;
}

function makeMiteredBridgeRims(resolved: ResolvedPassage): THREE.BufferGeometry[] {
  if (!resolved.bend || resolved.segments.length !== 2) return [];
  // The below-floor water/floor footprint is intentionally rectangular at an
  // L bend. Use that same hard 90-degree centerline for its side rims instead
  // of the rounded acrylic-shell route.
  const route = [resolved.segments[0]!.a.clone(), resolved.bend.clone(), resolved.segments[1]!.b.clone()];
  const half = resolved.settings.width * 0.5;
  const rimWidth = resolved.settings.sideRimWidth;
  const rimHeight = resolved.settings.bridgeRimHeight;
  const makeRim = (side: -1 | 1): THREE.BufferGeometry => {
    const positions: number[] = [];
    const indices: number[] = [];
    const point = (index: number, edge: -1 | 1, y: number): THREE.Vector3 => {
      const lateral = side * (half + rimWidth * 0.5) + edge * rimWidth * 0.5;
      const center = offsetRoutePoint(route, index, lateral);
      return new THREE.Vector3(center.x, y, center.y);
    };
    for (let index = 0; index < route.length - 1; index += 1) {
      const inner = point(index, -1, 0); const outer = point(index, 1, 0);
      const nextInner = point(index + 1, -1, 0); const nextOuter = point(index + 1, 1, 0);
      const innerTop = point(index, -1, rimHeight); const outerTop = point(index, 1, rimHeight);
      const nextInnerTop = point(index + 1, -1, rimHeight); const nextOuterTop = point(index + 1, 1, rimHeight);
      appendOrientedQuad(positions, indices, [innerTop, nextInnerTop, nextOuterTop, outerTop], new THREE.Vector3(0, 1, 0));
      appendOrientedQuad(positions, indices, [inner, outer, nextOuter, nextInner], new THREE.Vector3(0, -1, 0));
      appendOrientedQuad(positions, indices, [inner, nextInner, nextInnerTop, innerTop], inner.clone().sub(outer).normalize());
      appendOrientedQuad(positions, indices, [outer, outerTop, nextOuterTop, nextOuter], outer.clone().sub(inner).normalize());
    }
    const firstInner = point(0, -1, 0); const firstOuter = point(0, 1, 0);
    const last = route.length - 1;
    const lastInner = point(last, -1, 0); const lastOuter = point(last, 1, 0);
    const firstDirection = route[0]!.clone().sub(route[1]!).normalize();
    const lastDirection = route[last]!.clone().sub(route[last - 1]!).normalize();
    appendOrientedQuad(positions, indices, [firstInner, firstOuter, point(0, 1, rimHeight), point(0, -1, rimHeight)], new THREE.Vector3(firstDirection.x, 0, firstDirection.y));
    appendOrientedQuad(positions, indices, [lastInner, point(last, -1, rimHeight), point(last, 1, rimHeight), lastOuter], new THREE.Vector3(lastDirection.x, 0, lastDirection.y));
    return finishGeometry(positions, indices);
  };
  return [makeRim(-1), makeRim(1)];
}

function makeElbowFloorBrace(resolved: ResolvedPassage): THREE.BufferGeometry | null {
  if (!resolved.bend || resolved.segments.length !== 2) return null;
  const towardEntry = resolved.segments[0]!.a.clone().sub(resolved.bend).normalize();
  const towardExit = resolved.segments[1]!.b.clone().sub(resolved.bend).normalize();
  const diagonal = towardEntry.add(towardExit).normalize();
  // Span the complete elbow platform corner-to-corner. The route overlap is
  // square, so a 45-degree brace needs half its diagonal (including the
  // platform's side rims) to meet both corners.
  const halfLength = (resolved.settings.width + resolved.settings.sideRimWidth * 2) / Math.SQRT2;
  const center = resolved.bend;
  const height = Math.max(0.008, resolved.settings.bridgeRimHeight * 0.16);
  const geometry = new THREE.BoxGeometry(
    resolved.settings.separatorWidth,
    height,
    halfLength * 2,
  );
  geometry.rotateY(Math.atan2(diagonal.x, diagonal.y));
  geometry.translate(center.x, height * 0.5, center.y);
  geometry.computeVertexNormals();
  return geometry;
}

function makeBridgeGeometries(resolved: ResolvedPassage): {
  rims: THREE.BufferGeometry[];
  separators: THREE.BufferGeometry[];
} {
  const passage = resolved.settings;
  const rims: THREE.BufferGeometry[] = resolved.bend ? makeMiteredBridgeRims(resolved) : [];
  const separators: THREE.BufferGeometry[] = [];
  const half = passage.width * 0.5;
  for (const segment of resolved.segments) {
    const length = segment.a.distanceTo(segment.b);
    const centerS = (segment.startS + segment.endS) * 0.5;
    const rimWidth = passage.sideRimWidth;
    const rimHeight = passage.bridgeRimHeight;
    if (!resolved.bend) {
      rims.push(orientTunnelGeometry(makeBoxGeometry(rimWidth, rimHeight, length, -half - rimWidth * 0.5, rimHeight * 0.5, centerS), segment.axis, segment.offset));
      rims.push(orientTunnelGeometry(makeBoxGeometry(rimWidth, rimHeight, length, half + rimWidth * 0.5, rimHeight * 0.5, centerS), segment.axis, segment.offset));
    }
    const count = Math.max(0, Math.floor((length - passage.separatorSpacing * 0.35) / passage.separatorSpacing));
    const low = Math.min(segment.startS, segment.endS);
    for (let index = 1; index <= count; index += 1) {
      const s = low + (length * index) / (count + 1);
      separators.push(orientTunnelGeometry(
        makeBoxGeometry(passage.width + rimWidth * 2, Math.max(0.008, rimHeight * 0.16), passage.separatorWidth, 0, Math.max(0.004, rimHeight * 0.08), s),
        segment.axis,
        segment.offset,
      ));
    }
  }
  const elbowBrace = makeElbowFloorBrace(resolved);
  if (elbowBrace) separators.push(elbowBrace);
  return { rims, separators };
}

function makeLayeredWaterVolume(
  waterRegion: MultiPolygon,
  waterBottom: number,
  waterTop: number,
  passages: ResolvedPassage[],
): THREE.BufferGeometry {
  const levels = [waterBottom, waterTop];
  for (const passage of passages) {
    levels.push(Math.max(waterBottom, passage.voidBottom));
    levels.push(Math.min(waterTop, passage.crown + passage.settings.waterClearance));
    for (const point of passageProfile(passage.settings, passage.profileCeiling).outer.full) {
      levels.push(THREE.MathUtils.clamp(point.y, waterBottom, waterTop));
    }
  }
  const sorted = [...new Set(levels.map((value) => Number(value.toFixed(6))))].sort((a, b) => a - b);
  const slabs: THREE.BufferGeometry[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const bottom = sorted[index]!;
    const top = sorted[index + 1]!;
    if (top - bottom < 1e-5) continue;
    const middle = (bottom + top) * 0.5;
    const dry = passages.map((passage) => dryPolygonAtHeight(passage, middle)).filter((polygon) => polygon.length > 0);
    const region = dry.length > 0
      ? difference(waterRegion, ...dry)
      : waterRegion;
    if (region.length === 0) continue;
    slabs.push(makePolygonPrism(region, bottom, top, false, { includeBottom: false, includeTop: false }));
  }
  if (slabs.length === 0) return makePolygonPrism(waterRegion, waterBottom, waterTop, false, { includeTop: false });
  const merged = mergeGeometries(slabs, false);
  for (const slab of slabs) if (slab !== merged) slab.dispose();
  if (!merged) throw new Error('Could not build the layered water volume.');
  return merged;
}

function profileHalfAtHeight(passage: ResolvedPassage, y: number): number {
  if (y < passage.voidBottom - EPSILON || y > passage.crown + passage.settings.waterClearance + EPSILON) return 0;
  const profile = passageProfile(passage.settings, passage.profileCeiling).outer.full;
  if (y <= 0) return profile[0]!.x * -1 + passage.settings.waterClearance;
  const crossings: number[] = [];
  for (let index = 0; index < profile.length - 1; index += 1) {
    const a = profile[index]!; const b = profile[index + 1]!;
    if ((a.y <= y && b.y >= y) || (b.y <= y && a.y >= y)) {
      const span = b.y - a.y;
      crossings.push(Math.abs(span < EPSILON ? a.x : THREE.MathUtils.lerp(a.x, b.x, (y - a.y) / span)));
    }
  }
  return crossings.length ? Math.max(...crossings) + passage.settings.waterClearance : 0;
}

/** Exact dry cross-section projected at a height. Used by water, nav and fish. */
function dryPolygonAtHeight(passage: ResolvedPassage, y: number): MultiPolygon {
  const halfWidth = profileHalfAtHeight(passage, y);
  // The orthogonal route union is deliberately conservative at an elbow. It
  // avoids numerical failures from unions of nearly tangent arc capsules and
  // never marks a dry corner as swimmable; the visible acrylic still follows
  // the radius-controlled sampled centreline above.
  return halfWidth > EPSILON ? routePolygon(passage.segments, passage.bend, halfWidth).multi : [];
}

/**
 * Navigation deliberately uses the widest tunnel cross-section only between
 * its void floor and crown. This avoids arch-shaped layer fragmentation while
 * retaining free navigation above a tunnel and beneath a glass-floor bridge.
 */
function navigationDryPolygon(passage: ResolvedPassage): MultiPolygon {
  const widestHalfWidth = passage.settings.width * 0.5
    + passage.settings.glassThickness
    + passage.settings.waterClearance;
  return routePolygon(passage.segments, passage.bend, widestHalfWidth).multi;
}

function polygonArea(loop: THREE.Vector2[]): number {
  let area = 0;
  for (let index = 0; index < loop.length; index += 1) {
    const a = loop[index]!;
    const b = loop[(index + 1) % loop.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) * 0.5;
}

function navigationRegions(settings: AquariumSettings, yBottom: number, yTop: number): Array<Record<string, unknown>> {
  const transform = (points: THREE.Vector2[]) => points.map((point) => transformFootprintPoint(point, settings));
  if (settings.footprint === 'rectangle') {
    const loop = createFootprintShapeLoop(settings, -(settings.glassThickness + settings.waterWallGap));
    return [{ id: 'main', label: 'Main water region', polygon: loop.map((point) => [point.x, point.y]), yBottom, yTop }];
  }
  if (settings.footprint === 'lShape') {
    const w = settings.lHorizontalArmLength;
    const d = settings.lVerticalArmLength;
    const left = -w * 0.5;
    const back = -d * 0.5;
    const v = settings.lVerticalArmWidth;
    const h = settings.lHorizontalArmWidth;
    return [
      { id: 'vertical-arm', label: 'Vertical arm', polygon: transform([new THREE.Vector2(left, back), new THREE.Vector2(left + v, back), new THREE.Vector2(left + v, back + d), new THREE.Vector2(left, back + d)]).map((p) => [p.x, p.y]), yBottom, yTop },
      { id: 'horizontal-arm', label: 'Horizontal arm', polygon: transform([new THREE.Vector2(left, back), new THREE.Vector2(left + w, back), new THREE.Vector2(left + w, back + h), new THREE.Vector2(left, back + h)]).map((p) => [p.x, p.y]), yBottom, yTop },
      { id: 'elbow', label: 'Arm overlap', polygon: transform([new THREE.Vector2(left, back), new THREE.Vector2(left + v, back), new THREE.Vector2(left + v, back + h), new THREE.Vector2(left, back + h)]).map((p) => [p.x, p.y]), yBottom, yTop },
    ];
  }
  const w = settings.uBridgeLength;
  const d = Math.max(settings.uLeftArmLength, settings.uRightArmLength);
  const left = -w * 0.5;
  const right = w * 0.5;
  const back = -d * 0.5;
  const bridge = settings.uBridgeDepth;
  return [
    { id: 'left-arm', label: 'Left arm', polygon: transform([new THREE.Vector2(left, back), new THREE.Vector2(left + settings.uLeftArmWidth, back), new THREE.Vector2(left + settings.uLeftArmWidth, back + settings.uLeftArmLength), new THREE.Vector2(left, back + settings.uLeftArmLength)]).map((p) => [p.x, p.y]), yBottom, yTop },
    { id: 'right-arm', label: 'Right arm', polygon: transform([new THREE.Vector2(right - settings.uRightArmWidth, back), new THREE.Vector2(right, back), new THREE.Vector2(right, back + settings.uRightArmLength), new THREE.Vector2(right - settings.uRightArmWidth, back + settings.uRightArmLength)]).map((p) => [p.x, p.y]), yBottom, yTop },
    { id: 'rear-bridge', label: 'Rear connector', polygon: transform([new THREE.Vector2(left, back), new THREE.Vector2(right, back), new THREE.Vector2(right, back + bridge), new THREE.Vector2(left, back + bridge)]).map((p) => [p.x, p.y]), yBottom, yTop },
  ];
}

function buildNavigationMetadata(
  group: THREE.Group,
  settings: AquariumSettings,
  waterLoop: THREE.Vector2[],
  waterBottom: number,
  waterTop: number,
  passages: ResolvedPassage[],
): Record<string, unknown> {
  const box = new THREE.Box2().setFromPoints(waterLoop);
  const area = polygonArea(waterLoop);
  const depth = Math.max(0, waterTop - waterBottom);
  const navigationLevels = [
    waterBottom,
    waterTop,
    ...passages.map((passage) => THREE.MathUtils.clamp(passage.voidBottom, waterBottom, waterTop)),
    ...passages.map((passage) => THREE.MathUtils.clamp(passage.crown, waterBottom, waterTop)),
  ];
  const sortedNavigationLevels = [...new Set(navigationLevels.map((value) => Number(value.toFixed(6))))].sort((a, b) => a - b);
  const swimVolumeLayers = sortedNavigationLevels.slice(0, -1).flatMap((bottom, index) => {
    const top = sortedNavigationLevels[index + 1]!;
    if (top - bottom < EPSILON) return [];
    const dry = passages
      .filter((passage) => top > passage.voidBottom + EPSILON && bottom < passage.crown - EPSILON)
      .map(navigationDryPolygon)
      .filter((polygon) => polygon.length > 0);
    const polygons = dry.length
      ? difference([loopPolygon(waterLoop)] as MultiPolygon, ...dry)
      : [loopPolygon(waterLoop)] as MultiPolygon;
    return polygons.length > 0 ? [{ yBottom: bottom, yTop: top, polygons }] : [];
  });
  const passageVoidVolume = swimVolumeLayers.reduce((sum, layer) => {
    const layerArea = layer.polygons.reduce((areaSum, polygon) => areaSum + Math.abs(ringArea(cleanRing(polygon[0]!))), 0);
    return sum + Math.max(0, area - layerArea) * (layer.yTop - layer.yBottom);
  }, 0);
  const regions = navigationRegions(settings, waterBottom, waterTop);
  const portals: Array<Record<string, unknown>> = [];
  const middleY = (waterBottom + waterTop) * 0.5;
  if (settings.footprint === 'lShape') {
    const left = -settings.lHorizontalArmLength * 0.5;
    const back = -settings.lVerticalArmLength * 0.5;
    const overlapCenter = transformFootprintPoint(new THREE.Vector2(
      left + settings.lVerticalArmWidth * 0.5,
      back + settings.lHorizontalArmWidth * 0.5,
    ), settings);
    portals.push({
      id: 'vertical-to-horizontal', from: 'vertical-arm', to: 'horizontal-arm',
      center: [overlapCenter.x, middleY, overlapCenter.y],
      width: Math.min(settings.lVerticalArmWidth, settings.lHorizontalArmWidth), height: depth,
      clearanceRadius: Math.max(0.05, Math.min(settings.lVerticalArmWidth, settings.lHorizontalArmWidth) * 0.42),
    });
  } else if (settings.footprint === 'uShape') {
    const width = settings.uBridgeLength;
    const maxDepth = Math.max(settings.uLeftArmLength, settings.uRightArmLength);
    const left = -width * 0.5;
    const right = width * 0.5;
    const back = -maxDepth * 0.5;
    const portalZ = back + Math.min(settings.uBridgeDepth, Math.min(settings.uLeftArmLength, settings.uRightArmLength)) * 0.5;
    const leftCenter = transformFootprintPoint(new THREE.Vector2(left + settings.uLeftArmWidth * 0.5, portalZ), settings);
    const rightCenter = transformFootprintPoint(new THREE.Vector2(right - settings.uRightArmWidth * 0.5, portalZ), settings);
    portals.push(
      { id: 'left-to-bridge', from: 'left-arm', to: 'rear-bridge', center: [leftCenter.x, middleY, leftCenter.y], width: settings.uLeftArmWidth, height: depth, clearanceRadius: Math.max(0.05, settings.uLeftArmWidth * 0.42) },
      { id: 'right-to-bridge', from: 'right-arm', to: 'rear-bridge', center: [rightCenter.x, middleY, rightCenter.y], width: settings.uRightArmWidth, height: depth, clearanceRadius: Math.max(0.05, settings.uRightArmWidth * 0.42) },
    );
  }
  const data: Record<string, unknown> = {
    schema: 'aquarium-maker-navigation',
    schemaVersion: 3,
    coordinateSystem: { units: 'meters', up: '+Y', front: '+Z', floorLevelY: 0 },
    profile: settings.profile,
    footprint: settings.footprint,
    footprintRotation: settings.footprintRotation,
    footprintMirrored: settings.footprintMirrored,
    boundsMeters: { min: [box.min.x, waterBottom, box.min.y], max: [box.max.x, waterTop, box.max.y] },
    waterBoundary: waterLoop.map((point) => [point.x, point.y]),
    waterHeightRangeMeters: [waterBottom, waterTop],
    waterSurfaceAreaM2: area,
    approximateWaterVolumeM3: Math.max(0, area * depth - passageVoidVolume),
    recommendedMaxFishRadiusM: Math.max(0.05, Math.min(settings.glassThickness + settings.waterWallGap, Math.min(settings.width, settings.depth) * 0.08)),
    collisionGuidance: 'Use swimVolumeLayers as the authoritative navigation volume. Between each tunnel void floor and crown, arches are simplified to their widest footprint; water above a crown and below a glass-floor bridge remains navigable.',
    suggestedSpawnPoints: regions.map((region, index) => {
      const polygon = region.polygon as number[][];
      const sx = polygon.reduce((sum, point) => sum + point[0]!, 0) / Math.max(1, polygon.length);
      const sz = polygon.reduce((sum, point) => sum + point[1]!, 0) / Math.max(1, polygon.length);
      return { id: `spawn-${index + 1}`, position: [sx, waterBottom + depth * 0.55, sz], region: region.id };
    }),
    regions,
    portals,
    swimVolumeLayers: swimVolumeLayers.map((layer, index) => ({ id: `swim-layer-${index + 1}`, ...layer })),
    dryPassages: passages.map((passage) => {
      const navigationFloor = THREE.MathUtils.clamp(passage.voidBottom, waterBottom, waterTop);
      const navigationCrown = THREE.MathUtils.clamp(passage.crown, waterBottom, waterTop);
      const widestHalfWidth = passage.settings.width * 0.5 + passage.settings.glassThickness + passage.settings.waterClearance;
      return {
        id: passage.settings.id,
        name: passage.settings.name,
        kind: passage.settings.kind,
        route: passage.settings.route,
        width: passage.settings.width,
        floorY: navigationFloor,
        crownY: navigationCrown,
        waterClearance: 0,
        bendRadius: 0,
        crossSection: [
          [-widestHalfWidth, navigationFloor], [-widestHalfWidth, navigationCrown],
          [widestHalfWidth, navigationCrown], [widestHalfWidth, navigationFloor],
        ],
        centerline: routeSamples(passage).map((point) => [point.x, 0, point.y]),
        dryVolume: 'widest tunnel footprint between its void floor and crown; water above and below it remains navigable',
      };
    }),
  };
  const navRoot = new THREE.Group();
  navRoot.name = 'NAV_Aquarium';
  navRoot.userData = data;
  for (const region of regions) {
    const node = new THREE.Group();
    node.name = `NAV_Region_${String(region.id).replace(/[^a-z0-9]+/gi, '_')}`;
    node.userData = region;
    navRoot.add(node);
  }
  for (const portal of portals) {
    const node = new THREE.Group();
    node.name = `NAV_Portal_${String(portal.id).replace(/[^a-z0-9]+/gi, '_')}`;
    node.userData = portal;
    navRoot.add(node);
  }
  group.add(navRoot);
  return data;
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
  const configuredPassages = activePassages(settings);
  group.name = configuredPassages.length > 0 ? 'PUBLIC_AQUARIUM_WITH_PASSAGES' : 'PROFESSIONAL_PUBLIC_AQUARIUM';
  group.userData = {
    generator: 'Aquarium Maker 1.9',
    geometryProfile: 'editable arm layout + multi-passage system',
    profile: settings.profile,
    footprint: settings.footprint,
    footprintRotation: settings.footprintRotation,
    footprintMirrored: settings.footprintMirrored,
    authoredUnits: 'meters',
    exportUnitsPerMeter: settings.exportScale,
    frontAxis: '+Z',
    upAxis: '+Y',
    openTop: true,
    opaqueBackPanel: false,
    groundPreset: settings.groundPreset,
    groundIrregularity: settings.groundIrregularity,
    groundMoundHeight: settings.groundMoundHeight,
    wallModes: settings.wallModes,
    passageCount: configuredPassages.length,
    passages: configuredPassages.map((passage) => ({
      id: passage.id,
      name: passage.name,
      kind: passage.kind,
      route: passage.route,
      entrySide: passage.entrySide,
      exitSide: passage.kind === 'tunnel' ? passage.exitSide : undefined,
    })),
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
  // Tunnel roofs are limited by the tank structure, never by the water line.
  const passageCeiling = Math.max(0.42, glassTop - 0.04);
  const sandBottom = baseTop + settings.bottomRimHeight * 0.58;
  const sandTop = sandBottom + settings.sandHeight;
  const interiorWaterCeiling = topRimBottom - 0.055;
  const waterTop = sandTop + (interiorWaterCeiling - sandTop) * settings.waterLevel;
  const waterBottom = sandTop - Math.min(0.032, settings.sandHeight * 0.45);
  const waterDepth = Math.max(0.001, waterTop - waterBottom);
  const navClearance = Math.min(settings.navOverlayClearance, Math.min(settings.width, settings.depth) * 0.18);
  const terrainMaximum = sandTop + settings.groundMoundHeight + settings.groundIrregularity;

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
  const solidWallMaterial = new THREE.MeshStandardMaterial({
    name: 'Solid_Aquarium_Wall', color: new THREE.Color(settings.solidWallColor), metalness: 0.06, roughness: 0.68,
  });

  // One physical material is shared by the tank wall, entrance glass, tunnel
  // roofs, elbow chambers, alcove caps, and bridge floors. This removes the
  // visible color/transmission change that used to appear above portals.
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Acrylic_Glass', color: new THREE.Color(0.84, 0.96, 1), metalness: 0, roughness: 0.022,
    transmission: 0.97, thickness: settings.glassThickness, attenuationDistance: 18,
    attenuationColor: new THREE.Color(0.86, 0.96, 1), ior: 1.49,
    transparent: true, opacity: 0.115, depthWrite: false, envMapIntensity: 1.08, side: THREE.FrontSide,
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

  function addSolidWallPanels(loop: THREE.Vector2[], yBottom: number, yTop: number, portals: ResolvedPassage[] = []): void {
    const box = new THREE.Box2().setFromPoints(loop);
    const tolerance = Math.max(settings.glassThickness * 4, Math.min(box.max.x - box.min.x, box.max.y - box.min.y) * 0.04);
    const pieces: THREE.BufferGeometry[] = [];
    for (let index = 0; index < loop.length; index += 1) {
      const a = loop[index]!;
      const b = loop[(index + 1) % loop.length]!;
      const midpoint = a.clone().add(b).multiplyScalar(0.5);
      let side: PassageSide | null = null;
      if (Math.abs(midpoint.y - box.max.y) <= tolerance) side = 'front';
      else if (Math.abs(midpoint.y - box.min.y) <= tolerance) side = 'back';
      else if (Math.abs(midpoint.x - box.min.x) <= tolerance) side = 'left';
      else if (Math.abs(midpoint.x - box.max.x) <= tolerance) side = 'right';
      if (!side || settings.wallModes[side] !== 'solid') continue;
      const blockedByPortal = portals.some((resolved) => resolved.portals.some((portal) => {
        if (portal.side !== side) return false;
        const along = side === 'front' || side === 'back' ? midpoint.x : midpoint.y;
        return Math.abs(along - portal.offset) < resolved.settings.width * 0.62 + resolved.settings.portalFrameWidth;
      }));
      if (blockedByPortal) continue;
      const length = a.distanceTo(b);
      if (length < 1e-4) continue;
      const center = a.clone().add(b).multiplyScalar(0.5);
      const geometry = new THREE.BoxGeometry(length + settings.glassThickness * 0.8, yTop - yBottom, settings.glassThickness * 1.45);
      geometry.rotateY(-Math.atan2(b.y - a.y, b.x - a.x));
      geometry.translate(center.x, (yBottom + yTop) * 0.5, center.y);
      pieces.push(geometry);
    }
    if (pieces.length > 0) addMesh('STRUCTURE_SolidWallPanels', mergeParts(pieces, 'solid wall panels'), solidWallMaterial, true, true);
  }

  function mergeParts(parts: THREE.BufferGeometry[], label: string): THREE.BufferGeometry {
    if (parts.length === 0) throw new Error(`No geometry was generated for ${label}.`);
    if (parts.length === 1) return parts[0]!;
    // Three.js primitive/extrude geometries do not always agree on whether an
    // index exists. A sequential index preserves the exact geometry while
    // making passage shells, alcove caps, and elbow pieces merge reliably.
    for (const part of parts) {
      if (!part.index) {
        const position = part.getAttribute('position');
        part.setIndex(Array.from({ length: position.count }, (_, index) => index));
      }
    }
    const merged = mergeGeometries(parts, false);
    if (!merged) throw new Error(`Could not merge ${label}.`);
    for (const part of parts) if (part !== merged) part.dispose();
    return merged;
  }

  const asMulti = (loop: THREE.Vector2[]): MultiPolygon => [loopPolygon(loop)] as MultiPolygon;
  const ringRegion = (outer: THREE.Vector2[], inner: THREE.Vector2[]): MultiPolygon => difference(loopPolygon(outer), loopPolygon(inner));
  const baseRegion = asMulti(baseOuter);
  const frameRegion = ringRegion(frameOuter, frameInner);
  const glassRegion = ringRegion(glassOuter, glassInner);
  const groundRegion = asMulti(sandLoop);
  const waterRegion = asMulti(waterLoop);

  const addGround = (region: MultiPolygon, yBottom: number, yTop: number): void => {
    if (region.length === 0) return;
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
    surface.userData.waterAnimation = { enabled: settings.waterAnimationEnabled, speed: settings.waterAnimationSpeed, amount: settings.waterAnimationAmount, preset: settings.waterSurfacePreset };
  };

  let navigationWaterLoop = createFootprintShapeLoop(settings, -(waterInset + navClearance));
  let navigationWaterTop = waterTop - navClearance;
  let navigationWaterBottom = Math.min(
    navigationWaterTop - 0.02,
    Math.max(waterBottom + navClearance, terrainMaximum + navClearance),
  );
  let resolvedPassages: ResolvedPassage[] = [];

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
    navigationWaterLoop = createFootprintShapeLoop(settings, -(settings.touchRimWidth + settings.touchBasinInset + navClearance));
    navigationWaterTop = touchWaterTop - navClearance;
    navigationWaterBottom = Math.min(
      navigationWaterTop - 0.02,
      touchGroundTop + settings.groundMoundHeight + settings.groundIrregularity + navClearance,
    );
  } else if (configuredPassages.length === 0) {
    addMesh('STRUCTURE_BasePlinth', makePolygonPrism(baseRegion, profileBottom, baseTop), baseMaterial);
    addMesh('STRUCTURE_BottomRim', makePolygonPrism(frameRegion, baseTop, bottomRimTop), frameMaterial);
    if (settings.profile === 'belowFloor') {
      addMesh('STRUCTURE_SubFloorBody', makePolygonPrism(glassRegion, bottomRimTop, 0), subFloorMaterial);
      addMesh('STRUCTURE_FloorRim', makePolygonPrism(frameRegion, 0, settings.floorRimHeight), frameMaterial);
    }
    const glass = addMesh('GLASS_AcrylicShell', makePolygonPrism(glassRegion, glassBottom, glassTop), glassMaterial, false, false);
    glass.renderOrder = 6;
    addSolidWallPanels(glassOuter, glassBottom, glassTop);
    addGround(groundRegion, sandBottom, sandTop);
    addWater(waterRegion, waterBottom, waterTop);
    addMesh('STRUCTURE_TopRim', makePolygonPrism(frameRegion, topRimBottom, profileTop), frameMaterial);
  } else {
    resolvedPassages = configuredPassages.map((passage) => resolvePassage(
      passage,
      glassOuter,
      waterBottom,
      settings.profile === 'belowFloor',
      passageCeiling,
    ));
    const allCuts = resolvedPassages.map((passage) => passage.cutPolygon);
    const openFloorCuts = resolvedPassages
      .filter((passage) => !(settings.profile === 'belowFloor' && passage.settings.glassFloor))
      .map((passage) => passage.cutPolygon);
    const allRects = resolvedPassages.flatMap((passage) => passage.cutRects);

    const baseCut = openFloorCuts.length > 0 ? difference(baseRegion, ...openFloorCuts) : baseRegion;
    const bottomRimCut = openFloorCuts.length > 0 ? difference(frameRegion, ...openFloorCuts) : frameRegion;
    const subFloorCut = openFloorCuts.length > 0 ? difference(glassRegion, ...openFloorCuts) : glassRegion;
    const floorRimCut = difference(frameRegion, ...allCuts);
    const glassCut = difference(glassRegion, ...allCuts);
    const groundCut = openFloorCuts.length > 0 ? difference(groundRegion, ...openFloorCuts) : groundRegion;

    addMesh('STRUCTURE_BasePlinth', makePolygonPrism(baseCut, profileBottom, baseTop), baseMaterial);
    addMesh('STRUCTURE_BottomRim', makePolygonPrism(bottomRimCut, baseTop, bottomRimTop), frameMaterial);
    if (settings.profile === 'belowFloor') {
      addMesh('STRUCTURE_SubFloorBody', makePolygonPrism(subFloorCut, bottomRimTop, 0), subFloorMaterial);
      addMesh('STRUCTURE_FloorRim', makePolygonPrism(floorRimCut, 0, settings.floorRimHeight), frameMaterial);
    }
    addMesh('STRUCTURE_TopRim', makePolygonPrism(frameRegion, topRimBottom, profileTop), frameMaterial);

    const glassParts: THREE.BufferGeometry[] = [
      makePolygonPrism(glassCut, glassBottom, glassTop, false, {
        skipSide: (a, b) => corridorBoundaryEdge(a, b, allRects),
      }),
    ];
    for (const passage of resolvedPassages) {
      for (const portal of passage.portals) {
        glassParts.push(portalWallGeometry(portal, passage, glassOuter, glassInner, glassBottom, glassTop));
      }
    }
    const glass = addMesh('GLASS_AcrylicShell', mergeParts(glassParts, 'continuous aquarium glass'), glassMaterial, false, false);
    glass.renderOrder = 6;
    addSolidWallPanels(glassOuter, glassBottom, glassTop, resolvedPassages);

    addGround(groundCut, sandBottom, sandTop);

    const bridgePassages = settings.profile === 'belowFloor'
      ? resolvedPassages.filter((passage) => passage.settings.glassFloor)
      : [];
    // Straight and L bridge floors share the same construction: union their
    // authoritative planar route footprints, then extrude the union once.
    // This preserves the proven straight-bridge behavior, creates a clean
    // mitered L corner, and prevents overlapping floor slabs at crossings.
    if (bridgePassages.length > 0) {
      const floorRegion = unionClipPolygons(bridgePassages.map((passage) => passage.floorPolygon));
      const floorThickness = Math.max(...bridgePassages.map((passage) => passage.bridgeFloorThickness));
      const floor = addMesh('PASSAGE_BRIDGE_CombinedGlassFloor', makePolygonPrism(floorRegion, -floorThickness, 0), glassMaterial, false, false);
      floor.renderOrder = 6;
      floor.userData = { passageIds: bridgePassages.map((passage) => passage.settings.id), merged: true };
    }

    resolvedPassages.forEach((passage, passageIndex) => {
      const safeId = passage.settings.id.replace(/[^a-z0-9]+/gi, '_');
      const shell = addMesh(
        `PASSAGE_${safeId}_AcrylicShell`,
        mergeParts(makePassageShellGeometries(passage), `${passage.settings.name} acrylic shell`),
        glassMaterial,
        false,
        false,
      );
      shell.renderOrder = 6;
      shell.userData = {
        passageId: passage.settings.id,
        kind: passage.settings.kind,
        route: passage.settings.route,
      };

      passage.portals.forEach((portal, portalIndex) => {
        const frame = addMesh(
          `PASSAGE_${safeId}_${String(portalIndex + 1).padStart(2, '0')}_${portal.label === 'entrance' ? 'Entrance' : 'Exit'}Frame`,
          portalFrameGeometry(portal, passage),
          frameMaterial,
        );
        frame.userData = { passageId: passage.settings.id, portalSide: portal.side, portalLabel: portal.label };
      });

      if (settings.profile === 'belowFloor' && passage.settings.glassFloor) {
        const bridge = makeBridgeGeometries(passage);
        bridge.rims.forEach((geometry, index) => addMesh(`PASSAGE_${safeId}_SideRim_${String(index + 1).padStart(2, '0')}`, geometry, frameMaterial));
        bridge.separators.forEach((geometry, index) => addMesh(`PASSAGE_${safeId}_FloorSeparator_${String(index + 1).padStart(2, '0')}`, geometry, frameMaterial));
      }

      // Keep deterministic order in export metadata even when IDs were random.
      shell.userData.passageOrder = passageIndex + 1;
    });

    const volume = addMesh(
      'WATER_Volume',
      makeLayeredWaterVolume(waterRegion, waterBottom, waterTop - 0.004, resolvedPassages),
      waterVolumeMaterial,
      false,
      false,
    );
    volume.renderOrder = 1;
    // The water surface must use the same dry passage subtraction as the
    // layered water volume. Otherwise a flat surface polygon visibly spans a
    // tunnel even though the volume below it has already been cut away.
    const surfaceDry = resolvedPassages
      .map((passage) => dryPolygonAtHeight(passage, waterTop))
      .filter((polygon) => polygon.length > 0);
    const waterSurfaceRegion = surfaceDry.length > 0 ? difference(waterRegion, ...surfaceDry) : waterRegion;
    const surface = addMesh('WATER_Surface', makeSurfaceFromMultiPolygon(waterSurfaceRegion, waterTop), waterSurfaceMaterial, false, false);
    surface.renderOrder = 3;
    surface.userData.waterAnimation = { enabled: settings.waterAnimationEnabled, speed: settings.waterAnimationSpeed, amount: settings.waterAnimationAmount, preset: settings.waterSurfacePreset };
  }

  const navigation = buildNavigationMetadata(
    group,
    settings,
    navigationWaterLoop,
    navigationWaterBottom,
    navigationWaterTop,
    resolvedPassages,
  );
  group.userData.navigation = navigation;

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
