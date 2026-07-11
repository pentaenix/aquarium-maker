import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as polygonClippingModule from 'polygon-clipping';
import type { MultiPolygon, Polygon as ClipPolygon, Ring } from 'polygon-clipping';
import type { AquariumSettings, CornerModes, CornerRadii, TunnelAxis } from './settings';
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

    for (let step = 0; step <= segments; step += 1) {
      const t = step / segments;
      if (mode === 'chamfer') {
        points.push(startPoint.clone().lerp(endPoint, t));
      } else {
        const angle = THREE.MathUtils.lerp(startAngle, endAngle, t);
        const x = corner.centerX + corner.radius * Math.cos(angle);
        const pythonY = corner.centerPythonY + corner.radius * Math.sin(angle);
        points.push(new THREE.Vector2(x, -pythonY));
      }
    }
  }
  return points;
}


function loopToClipPolygon(loop: THREE.Vector2[]): ClipPolygon {
  return [closeRing(loop)];
}

function makeLShapeLoop(settings: AquariumSettings, offset: number): THREE.Vector2[] {
  const width = Math.max(0.8, settings.width + offset * 2);
  const depth = Math.max(0.8, settings.depth + offset * 2);
  const left = -width * 0.5;
  const right = width * 0.5;
  const back = -depth * 0.5;
  const front = depth * 0.5;
  const arm = THREE.MathUtils.clamp(settings.lArmWidth + offset, 0.35, width - 0.35);
  const rear = THREE.MathUtils.clamp(settings.lRearDepth + offset, 0.35, depth - 0.35);
  return [
    new THREE.Vector2(left, back),
    new THREE.Vector2(right, back),
    new THREE.Vector2(right, back + rear),
    new THREE.Vector2(left + arm, back + rear),
    new THREE.Vector2(left + arm, front),
    new THREE.Vector2(left, front),
  ];
}

function makeUShapeLoop(settings: AquariumSettings, offset: number): THREE.Vector2[] {
  const width = Math.max(1.2, settings.width + offset * 2);
  const depth = Math.max(1.2, settings.depth + offset * 2);
  const left = -width * 0.5;
  const right = width * 0.5;
  const back = -depth * 0.5;
  const front = depth * 0.5;
  let leftArm = settings.uLeftArmWidth + offset;
  let rightArm = settings.uRightArmWidth + offset;
  const maxArmTotal = width - 0.45;
  if (leftArm + rightArm > maxArmTotal) {
    const scale = maxArmTotal / Math.max(leftArm + rightArm, EPSILON);
    leftArm *= scale;
    rightArm *= scale;
  }
  leftArm = THREE.MathUtils.clamp(leftArm, 0.25, width * 0.48);
  rightArm = THREE.MathUtils.clamp(rightArm, 0.25, width * 0.48);
  const bridge = THREE.MathUtils.clamp(settings.uBackDepth + offset, 0.3, depth - 0.3);
  return [
    new THREE.Vector2(left, back),
    new THREE.Vector2(right, back),
    new THREE.Vector2(right, front),
    new THREE.Vector2(right - rightArm, front),
    new THREE.Vector2(right - rightArm, back + bridge),
    new THREE.Vector2(left + leftArm, back + bridge),
    new THREE.Vector2(left + leftArm, front),
    new THREE.Vector2(left, front),
  ];
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

function makeSurfaceFromPolygon(loop: THREE.Vector2[], y: number, includeUVs = true): THREE.BufferGeometry {
  const polygon = [loopToClipPolygon(loop)] as MultiPolygon;
  const positions: number[] = [];
  const indices: number[] = [];
  appendMultiPolygonCap(polygon, y, true, positions, indices);
  const uvs = includeUVs ? [] as number[] : undefined;
  if (uvs) {
    const minX = Math.min(...loop.map((point) => point.x));
    const maxX = Math.max(...loop.map((point) => point.x));
    const minZ = Math.min(...loop.map((point) => point.y));
    const maxZ = Math.max(...loop.map((point) => point.y));
    for (let index = 0; index < positions.length; index += 3) {
      const x = positions[index]!;
      const z = positions[index + 2]!;
      uvs.push((x - minX) / Math.max(maxX - minX, EPSILON), (z - minZ) / Math.max(maxZ - minZ, EPSILON));
    }
  }
  const normals: number[] = [];
  for (let index = 0; index < positions.length / 3; index += 1) normals.push(0, 1, 0);
  return finishGeometry(positions, indices, uvs, normals);
}

function makeSolidFromLoop(loop: THREE.Vector2[], yBottom: number, yTop: number, planarUVs = false): THREE.BufferGeometry {
  return makePolygonPrism([loopToClipPolygon(loop)] as MultiPolygon, yBottom, yTop, planarUVs);
}

function makeWaterFromLoop(loop: THREE.Vector2[], yBottom: number, yTop: number): THREE.BufferGeometry {
  // General-profile water keeps a hidden cap and uses a separate visible surface.
  return makePolygonPrism([loopToClipPolygon(loop)] as MultiPolygon, yBottom, yTop, false);
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
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(
      sideBottom + index, sideBottom + next, sideTop + next,
      sideBottom + index, sideTop + next, sideTop + index,
    );
  }

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
    indices.push(
      outerBottom + index, outerBottom + next, outerTop + next,
      outerBottom + index, outerTop + next, outerTop + index,
      innerBottom + index, innerTop + next, innerBottom + next,
      innerBottom + index, innerTop + index, innerTop + next,
    );
  }

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

function makeWaterVolume(loop: THREE.Vector2[], yBottom: number, yTop: number): THREE.BufferGeometry {
  const count = loop.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const bottom = positions.length / 3;
  for (const point of loop) pushVertex(positions, point, yBottom);
  const top = positions.length / 3;
  for (const point of loop) pushVertex(positions, point, yTop);
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(bottom + index, bottom + next, top + next, bottom + index, top + next, top + index);
  }
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
  for (let index = 0; index < count; index += 1) indices.push(center, index, (index + 1) % count);
  return finishGeometry(positions, indices, uvs, normals);
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

function makePolygonPrism(
  multi: MultiPolygon,
  yBottom: number,
  yTop: number,
  planarUVs = false,
): THREE.BufferGeometry {
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
        indices.push(topBase + ia!, topBase + ib!, topBase + ic!);
        indices.push(bottomBase + ia!, bottomBase + ic!, bottomBase + ib!);
      } else {
        indices.push(topBase + ia!, topBase + ic!, topBase + ib!);
        indices.push(bottomBase + ia!, bottomBase + ib!, bottomBase + ic!);
      }
    }

    rings.forEach((ring, ringIndex) => {
      const area = ringArea(ring);
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
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

function isTunnelEndStraightSegment(loop: THREE.Vector2[], index: number, axis: TunnelAxis): boolean {
  const a = loop[index]!;
  const b = loop[(index + 1) % loop.length]!;
  if (axis === 'depth') {
    if (Math.abs(a.y - b.y) > 1e-7) return false;
    const maxAbsZ = Math.max(...loop.map((point) => Math.abs(point.y)));
    return Math.abs(Math.abs((a.y + b.y) * 0.5) - maxAbsZ) < 1e-5;
  }
  if (Math.abs(a.x - b.x) > 1e-7) return false;
  const maxAbsX = Math.max(...loop.map((point) => Math.abs(point.x)));
  return Math.abs(Math.abs((a.x + b.x) * 0.5) - maxAbsX) < 1e-5;
}

function makeSideCornerGlassShell(
  outer: THREE.Vector2[],
  inner: THREE.Vector2[],
  yBottom: number,
  yTop: number,
  axis: TunnelAxis,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const omitted: number[] = [];
  const addQuad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, normal: THREE.Vector3) =>
    appendOrientedQuad(positions, indices, [a, b, c, d], normal);

  for (let i = 0; i < outer.length; i += 1) {
    const next = (i + 1) % outer.length;
    if (isTunnelEndStraightSegment(outer, i, axis)) {
      omitted.push(i);
      continue;
    }
    const oa = outer[i]!;
    const ob = outer[next]!;
    const ia = inner[i]!;
    const ib = inner[next]!;
    const edge = ob.clone().sub(oa);
    const outerNormal = new THREE.Vector3(edge.y, 0, -edge.x).normalize();
    const innerNormal = outerNormal.clone().negate();
    addQuad(
      new THREE.Vector3(oa.x, yBottom, oa.y), new THREE.Vector3(ob.x, yBottom, ob.y),
      new THREE.Vector3(ob.x, yTop, ob.y), new THREE.Vector3(oa.x, yTop, oa.y), outerNormal,
    );
    addQuad(
      new THREE.Vector3(ia.x, yBottom, ia.y), new THREE.Vector3(ia.x, yTop, ia.y),
      new THREE.Vector3(ib.x, yTop, ib.y), new THREE.Vector3(ib.x, yBottom, ib.y), innerNormal,
    );
    addQuad(
      new THREE.Vector3(oa.x, yTop, oa.y), new THREE.Vector3(ob.x, yTop, ob.y),
      new THREE.Vector3(ib.x, yTop, ib.y), new THREE.Vector3(ia.x, yTop, ia.y), new THREE.Vector3(0, 1, 0),
    );
    addQuad(
      new THREE.Vector3(oa.x, yBottom, oa.y), new THREE.Vector3(ia.x, yBottom, ia.y),
      new THREE.Vector3(ib.x, yBottom, ib.y), new THREE.Vector3(ob.x, yBottom, ob.y), new THREE.Vector3(0, -1, 0),
    );
  }

  for (const i of omitted) {
    for (const pointIndex of [i, (i + 1) % outer.length]) {
      const o = outer[pointIndex]!;
      const inside = inner[pointIndex]!;
      const normal = new THREE.Vector3(o.x - inside.x, 0, o.y - inside.y).normalize();
      addQuad(
        new THREE.Vector3(o.x, yBottom, o.y), new THREE.Vector3(o.x, yTop, o.y),
        new THREE.Vector3(inside.x, yTop, inside.y), new THREE.Vector3(inside.x, yBottom, inside.y), normal,
      );
    }
  }
  return finishGeometry(positions, indices);
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

function tunnelCorridorPolygon(axis: TunnelAxis, offset: number, halfWidth: number, deep: number): ClipPolygon {
  return axis === 'depth'
    ? rectanglePolygon(offset - halfWidth, -deep, offset + halfWidth, deep)
    : rectanglePolygon(-deep, offset - halfWidth, deep, offset + halfWidth);
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

function makeWaterVolumeWithTunnel(
  waterLoop: THREE.Vector2[],
  yBottom: number,
  yTop: number,
  voidProfile: THREE.Vector2[],
  voidRoof: THREE.Vector2[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const minZ = Math.min(...waterLoop.map((point) => point.y));
  const maxZ = Math.max(...waterLoop.map((point) => point.y));

  for (let i = 0; i < waterLoop.length; i += 1) {
    const next = (i + 1) % waterLoop.length;
    if (isTunnelEndStraightSegment(waterLoop, i, 'depth')) continue;
    const a = waterLoop[i]!;
    const b = waterLoop[next]!;
    const edge = b.clone().sub(a);
    const outward = new THREE.Vector3(edge.y, 0, -edge.x).normalize();
    appendOrientedQuad(positions, indices, [
      new THREE.Vector3(a.x, yBottom, a.y), new THREE.Vector3(b.x, yBottom, b.y),
      new THREE.Vector3(b.x, yTop, b.y), new THREE.Vector3(a.x, yTop, a.y),
    ], outward);
  }

  const voidHalf = Math.max(Math.abs(voidProfile[0]!.x), Math.abs(voidProfile[voidProfile.length - 1]!.x));
  const corridor = rectanglePolygon(-voidHalf, minZ - 1, voidHalf, maxZ + 1);
  const bottomRegion = difference(loopPolygon(waterLoop), corridor);
  appendMultiPolygonCap(bottomRegion, yBottom, false, positions, indices);

  for (let i = 0; i < voidProfile.length - 1; i += 1) {
    const a = voidProfile[i]!;
    const b = voidProfile[i + 1]!;
    const tangent = b.clone().sub(a);
    const inward = new THREE.Vector3(tangent.y, -tangent.x, 0).normalize();
    appendOrientedQuad(positions, indices, [
      new THREE.Vector3(a.x, a.y, minZ), new THREE.Vector3(a.x, a.y, maxZ),
      new THREE.Vector3(b.x, b.y, maxZ), new THREE.Vector3(b.x, b.y, minZ),
    ], inward);
  }

  const frontPoints = waterLoop.filter((point) => Math.abs(point.y - maxZ) < 1e-5);
  const backPoints = waterLoop.filter((point) => Math.abs(point.y - minZ) < 1e-5);
  const frontMinX = Math.min(...frontPoints.map((point) => point.x));
  const frontMaxX = Math.max(...frontPoints.map((point) => point.x));
  const backMinX = Math.min(...backPoints.map((point) => point.x));
  const backMaxX = Math.max(...backPoints.map((point) => point.x));

  const appendCap = (z: number, xMin: number, xMax: number, outwardZ: number) => {
    const normal = new THREE.Vector3(0, 0, outwardZ);
    if (-voidHalf > xMin + EPSILON) {
      appendOrientedQuad(positions, indices, [
        new THREE.Vector3(xMin, yBottom, z), new THREE.Vector3(-voidHalf, yBottom, z),
        new THREE.Vector3(-voidHalf, yTop, z), new THREE.Vector3(xMin, yTop, z),
      ], normal);
    }
    if (xMax > voidHalf + EPSILON) {
      appendOrientedQuad(positions, indices, [
        new THREE.Vector3(voidHalf, yBottom, z), new THREE.Vector3(xMax, yBottom, z),
        new THREE.Vector3(xMax, yTop, z), new THREE.Vector3(voidHalf, yTop, z),
      ], normal);
    }
    for (let i = 0; i < voidRoof.length - 1; i += 1) {
      const a = voidRoof[i]!;
      const b = voidRoof[i + 1]!;
      appendOrientedQuad(positions, indices, [
        new THREE.Vector3(a.x, a.y, z), new THREE.Vector3(b.x, b.y, z),
        new THREE.Vector3(b.x, yTop, z), new THREE.Vector3(a.x, yTop, z),
      ], normal);
    }
  };
  appendCap(maxZ, frontMinX, frontMaxX, 1);
  appendCap(minZ, backMinX, backMaxX, -1);
  return finishGeometry(positions, indices);
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
    generator: 'Aquarium Maker',
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
  const profileTop = settings.profile === 'belowFloor' ? settings.heightAboveFloor : settings.height;
  const baseTop = profileBottom + settings.baseHeight;
  const bottomRimTop = baseTop + settings.bottomRimHeight;
  const topRimBottom = profileTop - settings.topRimHeight;
  const glassBottom = settings.profile === 'belowFloor' ? 0 : baseTop + settings.bottomRimHeight * 0.34;
  const glassTop = profileTop - settings.topRimHeight * 0.34;
  const sandBottom = baseTop + settings.bottomRimHeight * 0.58;
  const sandTop = sandBottom + settings.sandHeight;
  const interiorWaterCeiling = topRimBottom - 0.055;
  const waterTop = sandTop + (interiorWaterCeiling - sandTop) * settings.waterLevel;
  const waterBottom = sandTop - Math.min(0.032, settings.sandHeight * 0.45);
  const waterDepth = Math.max(0.001, waterTop - waterBottom);
  const polygonalFootprint = settings.footprint !== 'rectangle';

  const baseMaterial = new THREE.MeshStandardMaterial({
    name: 'Plinth_Painted', color: new THREE.Color(0.19, 0.215, 0.235), metalness: 0, roughness: 0.82,
  });
  const frameMaterial = new THREE.MeshStandardMaterial({
    name: 'Frame_Steel', color: new THREE.Color(0.29, 0.315, 0.34), metalness: 0.54, roughness: 0.34,
  });
  const subFloorMaterial = new THREE.MeshStandardMaterial({
    name: 'SubFloor_Body', color: new THREE.Color(settings.subFloorBodyColor), metalness: 0.08, roughness: 0.72,
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

  const sandTexture = createGroundTexture(settings.groundPreset, settings.sandColor, settings.sandVariation, settings.sandGrain, settings.sandSeed);
  const groundRoughness = settings.groundPreset === 'algae' ? 0.78 : settings.groundPreset === 'gravel' ? 0.9 : 0.94;
  const sandMaterial = new THREE.MeshStandardMaterial({
    name: `Ground_${settings.groundPreset}`, color: 0xffffff, map: sandTexture, metalness: 0, roughness: groundRoughness,
  });

  const waterTextures = createWaterTextures(
    settings.waterColor,
    settings.waveStrength,
    settings.waterSeed,
    settings.waterSurfaceStyle,
    settings.waterWaveScale,
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
  const waterSurfaceMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Water_Surface', color: 0xffffff, map: waterTextures.color, normalMap: waterTextures.normal,
    normalScale: new THREE.Vector2(
      0.32 + settings.waveStrength * (0.65 + surfaceStyle * 0.55),
      0.32 + settings.waveStrength * (0.65 + surfaceStyle * 0.55),
    ),
    metalness: 0,
    roughness: THREE.MathUtils.lerp(0.075, 0.025, surfaceStyle),
    transmission: THREE.MathUtils.lerp(0.94, 0.76, surfaceStyle),
    thickness: 0.02,
    attenuationDistance: THREE.MathUtils.lerp(10, 5, surfaceStyle),
    attenuationColor: new THREE.Color(settings.waterColor),
    ior: 1.333,
    transparent: true,
    opacity: THREE.MathUtils.lerp(0.23, 0.43, surfaceStyle),
    depthWrite: false,
    envMapIntensity: THREE.MathUtils.lerp(1.0, 1.35, surfaceStyle),
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

  const solidPrism = (loop: THREE.Vector2[], y0: number, y1: number, textured = false) =>
    polygonalFootprint ? makeSolidFromLoop(loop, y0, y1, textured) : makeSolidPrism(loop, y0, y1, textured);
  const waterGeometry = (loop: THREE.Vector2[], y0: number, y1: number) =>
    polygonalFootprint ? makeWaterFromLoop(loop, y0, y1) : makeWaterVolume(loop, y0, y1);
  const surfaceGeometry = (loop: THREE.Vector2[], y: number) =>
    polygonalFootprint ? makeSurfaceFromPolygon(loop, y) : makeFlatWaterSurface(loop, y);

  if (settings.profile === 'touchPool') {
    const rimInner = createFootprintShapeLoop(settings, -settings.touchRimWidth);
    const pedestal = createFootprintShapeLoop(settings, -Math.min(settings.width, settings.depth) * 0.13);
    const basinFloor = createFootprintShapeLoop(settings, -(settings.touchRimWidth + settings.touchBasinInset));
    const pedestalTop = Math.min(settings.touchPedestalHeight, settings.height * 0.62);
    const basinBottom = Math.max(0.04, pedestalTop - 0.1);
    const rimBottom = settings.height - settings.topRimHeight;
    const groundBottom = basinBottom + 0.14;
    const groundTop = groundBottom + settings.sandHeight;
    const touchWaterTop = Math.min(rimBottom - 0.055, groundTop + (rimBottom - groundTop) * Math.min(0.62, settings.waterLevel));
    addMesh('STRUCTURE_Pedestal', solidPrism(pedestal, 0, pedestalTop), baseMaterial);
    addMesh('STRUCTURE_BasinBody', makeRingPrism(glassOuter, rimInner, basinBottom, rimBottom), subFloorMaterial);
    addMesh('STRUCTURE_TouchRim', makeRingPrism(glassOuter, rimInner, rimBottom, settings.height), frameMaterial);
    addMesh('INTERIOR_GroundFloor', solidPrism(basinFloor, groundBottom, groundTop, true), sandMaterial, false, true);
    const volume = addMesh('WATER_Volume', waterGeometry(basinFloor, groundTop - 0.015, touchWaterTop - 0.003), waterVolumeMaterial, false, false);
    volume.renderOrder = 1;
    const surface = addMesh('WATER_Surface', surfaceGeometry(basinFloor, touchWaterTop), waterSurfaceMaterial, false, false);
    surface.renderOrder = 3;
  } else if (!settings.tunnelEnabled) {
    addMesh('STRUCTURE_BasePlinth', solidPrism(baseOuter, profileBottom, baseTop), baseMaterial);
    addMesh('STRUCTURE_BottomRim', makeRingPrism(frameOuter, frameInner, baseTop, bottomRimTop), frameMaterial);
    if (settings.profile === 'belowFloor') {
      addMesh('STRUCTURE_SubFloorBody', makeRingPrism(glassOuter, glassInner, bottomRimTop, 0), subFloorMaterial);
      addMesh('STRUCTURE_FloorRim', makeRingPrism(frameOuter, frameInner, 0, settings.floorRimHeight), frameMaterial);
    }
    const glass = addMesh('GLASS_AcrylicShell', makeRingPrism(glassOuter, glassInner, glassBottom, glassTop), glassMaterial, false, false);
    glass.renderOrder = 5;
    addMesh('INTERIOR_GroundFloor', solidPrism(sandLoop, sandBottom, sandTop, true), sandMaterial, false, true);
    const volume = addMesh('WATER_Volume', waterGeometry(waterLoop, waterBottom, waterTop - 0.002), waterVolumeMaterial, false, false);
    volume.renderOrder = 1;
    const surface = addMesh('WATER_Surface', surfaceGeometry(waterLoop, waterTop), waterSurfaceMaterial, false, false);
    surface.renderOrder = 3;
    addMesh('STRUCTURE_TopRim', makeRingPrism(frameOuter, frameInner, topRimBottom, profileTop), frameMaterial);
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
      : archProfile(
        outerHalf,
        0,
        wallHeight,
        innerRise + settings.tunnelGlassThickness,
        settings.tunnelCurveSegments,
      );

    const longitudinalSize = axis === 'depth' ? settings.depth : settings.width;
    const deep = longitudinalSize + settings.baseOverhang * 4 + 2;
    const structuralCorridor = tunnelCorridorPolygon(axis, offset, innerHalf, deep);
    const baseRegion = difference(loopPolygon(baseOuter), structuralCorridor);
    const bottomRingRegion = difference(loopPolygon(frameOuter), loopPolygon(frameInner), structuralCorridor);
    const sandRegion = difference(loopPolygon(sandLoop), structuralCorridor);
    const subFloorRegion = difference(loopPolygon(glassOuter), loopPolygon(glassInner), structuralCorridor);
    const floorRimRegion = difference(loopPolygon(frameOuter), loopPolygon(frameInner), structuralCorridor);

    addMesh('STRUCTURE_BasePlinth', makePolygonPrism(baseRegion, profileBottom, baseTop), baseMaterial);
    addMesh('STRUCTURE_BottomRim', makePolygonPrism(bottomRingRegion, baseTop, bottomRimTop), frameMaterial);
    if (settings.profile === 'belowFloor') {
      addMesh('STRUCTURE_SubFloorBody', makePolygonPrism(subFloorRegion, bottomRimTop, 0), subFloorMaterial);
      addMesh('STRUCTURE_FloorRim', makePolygonPrism(floorRimRegion, 0, settings.floorRimHeight), frameMaterial);
    }
    addMesh('STRUCTURE_TopRim', makeRingPrism(frameOuter, frameInner, topRimBottom, profileTop), frameMaterial);

    const sideGlass = addMesh(
      'GLASS_SideAndCornerShell',
      makeSideCornerGlassShell(glassOuter, glassInner, glassBottom, glassTop, axis),
      glassMaterial,
      false,
      false,
    );
    sideGlass.renderOrder = 6;

    const localGlassOuter = toTunnelLocalLoop(glassOuter, axis, offset);
    const entranceS = Math.max(...localGlassOuter.map((point) => point.y));
    const exitS = Math.min(...localGlassOuter.map((point) => point.y));
    const entrancePoints = localGlassOuter.filter((point) => Math.abs(point.y - entranceS) < 1e-5);
    const exitPoints = localGlassOuter.filter((point) => Math.abs(point.y - exitS) < 1e-5);
    const entranceMin = Math.min(...entrancePoints.map((point) => point.x));
    const entranceMax = Math.max(...entrancePoints.map((point) => point.x));
    const exitMin = Math.min(...exitPoints.map((point) => point.x));
    const exitMax = Math.max(...exitPoints.map((point) => point.x));

    const entranceWall = addMesh(
      'GLASS_EntranceWall',
      orientTunnelGeometry(
        makeEndWallWithPortal(
          entranceMin, entranceMax,
          entranceS - settings.glassThickness, entranceS,
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
          exitMin, exitMax,
          exitS, exitS + settings.glassThickness,
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

    addMesh('INTERIOR_GroundFloor', makePolygonPrism(sandRegion, sandBottom, sandTop, true), sandMaterial, false, true);

    const tunnelEntrance = entranceS + settings.tunnelEndExtension;
    const tunnelExit = exitS - settings.tunnelEndExtension;
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

    if (settings.profile === 'belowFloor' && settings.tunnelGlassFloor) {
      const tunnelLength = Math.abs(tunnelEntrance - tunnelExit);
      const centerS = (tunnelEntrance + tunnelExit) * 0.5;
      const floorThickness = Math.max(0.025, settings.tunnelGlassThickness * 0.55);
      const glassFloor = addMesh(
        'TUNNEL_GlassFloor',
        orientTunnelGeometry(
          makeBoxGeometry(settings.tunnelWidth, floorThickness, tunnelLength, 0, -floorThickness * 0.5, centerS),
          axis,
          offset,
        ),
        tunnelGlassMaterial,
        false,
        false,
      );
      glassFloor.renderOrder = 4;
      const rimHeight = Math.max(0.06, settings.floorRimHeight * 0.85);
      const rimWidth = settings.tunnelSideRimWidth;
      addMesh(
        'TUNNEL_LeftSideRim',
        orientTunnelGeometry(
          makeBoxGeometry(rimWidth, rimHeight, tunnelLength, -innerHalf - rimWidth * 0.5, rimHeight * 0.5, centerS),
          axis,
          offset,
        ),
        frameMaterial,
      );
      addMesh(
        'TUNNEL_RightSideRim',
        orientTunnelGeometry(
          makeBoxGeometry(rimWidth, rimHeight, tunnelLength, innerHalf + rimWidth * 0.5, rimHeight * 0.5, centerS),
          axis,
          offset,
        ),
        frameMaterial,
      );
    }

    const frameOuterHalf = outerHalf + settings.portalFrameWidth;
    const frameArch = squareRoof
      ? archProfile(
        frameOuterHalf,
        0,
        wallHeight + settings.tunnelGlassThickness + settings.portalFrameWidth,
        0,
        settings.tunnelCurveSegments,
      )
      : archProfile(
        frameOuterHalf,
        0,
        wallHeight,
        innerRise + settings.tunnelGlassThickness + settings.portalFrameWidth,
        settings.tunnelCurveSegments,
      );
    addMesh(
      'TUNNEL_01_EntranceFrame',
      orientTunnelGeometry(
        makeProfileShell(
          outerArch.full,
          frameArch.full,
          entranceS + settings.portalFrameDepth,
          entranceS - 0.015,
          true,
          true,
        ),
        axis,
        offset,
      ),
      frameMaterial,
    );
    addMesh(
      'TUNNEL_02_ExitFrame',
      orientTunnelGeometry(
        makeProfileShell(
          outerArch.full,
          frameArch.full,
          exitS + 0.015,
          exitS - settings.portalFrameDepth,
          true,
          true,
        ),
        axis,
        offset,
      ),
      frameMaterial,
    );

    const voidHalf = outerHalf + settings.tunnelWaterClearance;
    const voidArch = squareRoof
      ? archProfile(
        voidHalf,
        waterBottom,
        Math.max(0.01, wallHeight + settings.tunnelGlassThickness + settings.tunnelWaterClearance - waterBottom),
        0,
        settings.tunnelCurveSegments,
      )
      : archProfile(
        voidHalf,
        waterBottom,
        Math.max(0.01, wallHeight + settings.tunnelWaterClearance - waterBottom),
        innerRise + settings.tunnelGlassThickness + settings.tunnelWaterClearance,
        settings.tunnelCurveSegments,
      );
    const localWaterLoop = toTunnelLocalLoop(waterLoop, axis, offset);
    const volume = addMesh(
      'WATER_Volume',
      orientTunnelGeometry(
        makeWaterVolumeWithTunnel(localWaterLoop, waterBottom, waterTop - 0.004, voidArch.full, voidArch.roof),
        axis,
        offset,
      ),
      waterVolumeMaterial,
      false,
      false,
    );
    volume.renderOrder = 1;
    const surface = addMesh('WATER_Surface', makeFlatWaterSurface(waterLoop, waterTop), waterSurfaceMaterial, false, false);
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
