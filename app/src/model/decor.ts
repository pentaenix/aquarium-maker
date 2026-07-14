import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DecorItemSettings } from './settings';

export interface DecorCollision {
  id: string;
  kind: DecorItemSettings['kind'];
  center: [number, number, number];
  halfExtents: [number, number];
  rotation: number;
  yBottom: number;
  yTop: number;
}

export interface DecorBuild {
  group: THREE.Group;
  collision: DecorCollision;
  placementFootprint: Array<[number, number]>;
  animated: boolean;
}

function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function coherentNoise(point: THREE.Vector3, seed: number): number {
  const a = Math.sin(point.x * 7.31 + point.y * 5.17 + point.z * 9.73 + seed * 0.013);
  const b = Math.sin(point.x * 15.11 - point.y * 11.29 + point.z * 6.47 + seed * 0.031);
  const c = Math.sin((point.x + point.z) * 25.7 + point.y * 18.3 + seed * 0.071);
  return a * 0.56 + b * 0.3 + c * 0.14;
}

function erodeAlongNormals(geometry: THREE.BufferGeometry, seed: number, amount: number): THREE.BufferGeometry {
  geometry.computeVertexNormals();
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const point = new THREE.Vector3(); const direction = new THREE.Vector3();
  // Several Three.js primitives duplicate coincident vertices at face and UV
  // seams. Cache by source position so erosion cannot pull those copies apart
  // and expose cracks in an otherwise closed formation.
  const displaced = new Map<string, THREE.Vector3>();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    const key = `${Math.round(point.x * 1e6)},${Math.round(point.y * 1e6)},${Math.round(point.z * 1e6)}`;
    const cached = displaced.get(key);
    if (cached) { position.setXYZ(index, cached.x, cached.y, cached.z); continue; }
    direction.fromBufferAttribute(normal, index);
    const noise = coherentNoise(point, seed);
    const pit = Math.max(0, coherentNoise(point.clone().multiplyScalar(2.7), seed + 97) - 0.56);
    point.addScaledVector(direction, amount * (noise - pit * 1.9));
    displaced.set(key, point.clone());
    position.setXYZ(index, point.x, point.y, point.z);
  }
  position.needsUpdate = true; geometry.computeVertexNormals(); return geometry;
}

function colorizeRock(geometry: THREE.BufferGeometry, seed: number, rust = 0.22): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!; const spanY = Math.max(0.001, box.max.y - box.min.y);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute; const colors: number[] = []; const point = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index); const t = (point.y - box.min.y) / spanY;
    const noise = coherentNoise(point, seed + 211); const band = Math.sin(point.y * 22 + seed * 0.01) * 0.5 + 0.5;
    const porous = Math.max(0, coherentNoise(point.clone().multiplyScalar(3.2), seed + 503) - 0.48);
    const base = new THREE.Color('#303638').lerp(new THREE.Color('#474b48'), THREE.MathUtils.clamp(0.34 + noise * 0.2 + t * 0.12, 0, 1));
    base.lerp(new THREE.Color('#76503b'), THREE.MathUtils.clamp(rust * band * (0.35 + porous), 0, 0.38));
    base.multiplyScalar(1 - porous * 0.25); colors.push(base.r, base.g, base.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); return geometry;
}

function clipAndCapRock(geometry: THREE.BufferGeometry, cutY: number): THREE.BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const position = source.getAttribute('position') as THREE.BufferAttribute;
  const color = source.getAttribute('color') as THREE.BufferAttribute;
  const positions: number[] = []; const colors: number[] = [];
  const boundarySegments: Array<[THREE.Vector3, THREE.Vector3]> = [];
  type Vertex = { point: THREE.Vector3; color: THREE.Color };
  const read = (index: number): Vertex => ({ point: new THREE.Vector3().fromBufferAttribute(position, index), color: color ? new THREE.Color(color.getX(index), color.getY(index), color.getZ(index)) : new THREE.Color('#383e3d') });
  const lerp = (a: Vertex, b: Vertex): Vertex => {
    const denominator = b.point.y - a.point.y; const t = Math.abs(denominator) < 1e-9 ? 0 : (cutY - a.point.y) / denominator;
    return { point: a.point.clone().lerp(b.point, t).setY(cutY), color: a.color.clone().lerp(b.color, t) };
  };
  const pushTriangle = (a: Vertex, b: Vertex, c: Vertex): void => {
    if (b.point.clone().sub(a.point).cross(c.point.clone().sub(a.point)).lengthSq() < 1e-14) return;
    for (const vertex of [a, b, c]) { positions.push(vertex.point.x, vertex.point.y, vertex.point.z); colors.push(vertex.color.r, vertex.color.g, vertex.color.b); }
  };
  for (let triangle = 0; triangle < position.count; triangle += 3) {
    const input = [read(triangle), read(triangle + 1), read(triangle + 2)]; const intersections: Vertex[] = [];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = input[edge]!; const b = input[(edge + 1) % 3]!;
      if ((a.point.y >= cutY) !== (b.point.y >= cutY)) intersections.push(lerp(a, b));
    }
    const uniqueIntersections = intersections.filter((candidate, index) => intersections.findIndex((other) => other.point.distanceToSquared(candidate.point) < 1e-12) === index);
    if (uniqueIntersections.length === 2) boundarySegments.push([uniqueIntersections[0]!.point.clone(), uniqueIntersections[1]!.point.clone()]);
    let polygon = input;
    const clipped: Vertex[] = [];
    for (let edge = 0; edge < polygon.length; edge += 1) {
      const current = polygon[edge]!; const previous = polygon[(edge + polygon.length - 1) % polygon.length]!;
      const currentInside = current.point.y >= cutY - 1e-8; const previousInside = previous.point.y >= cutY - 1e-8;
      if (currentInside) { if (!previousInside) clipped.push(lerp(previous, current)); clipped.push(current); }
      else if (previousInside) clipped.push(lerp(previous, current));
    }
    polygon = clipped;
    for (let index = 1; index < polygon.length - 1; index += 1) pushTriangle(polygon[0]!, polygon[index]!, polygon[index + 1]!);
  }

  const keyOf = (point: THREE.Vector3): string => `${Math.round(point.x * 1e6)},${Math.round(point.z * 1e6)}`;
  const pointsByKey = new Map<string, THREE.Vector3>(); const neighbors = new Map<string, Set<string>>();
  for (const [a, b] of boundarySegments) {
    const aKey = keyOf(a); const bKey = keyOf(b); if (aKey === bKey) continue;
    pointsByKey.set(aKey, a); pointsByKey.set(bKey, b);
    if (!neighbors.has(aKey)) neighbors.set(aKey, new Set()); if (!neighbors.has(bKey)) neighbors.set(bKey, new Set());
    neighbors.get(aKey)!.add(bKey); neighbors.get(bKey)!.add(aKey);
  }
  const visited = new Set<string>(); const capColor = new THREE.Color('#343a39');
  for (const start of pointsByKey.keys()) {
    if (visited.has(start)) continue;
    const component: string[] = []; const pending = [start]; visited.add(start);
    while (pending.length) { const key = pending.pop()!; component.push(key); for (const neighbor of neighbors.get(key) ?? []) if (!visited.has(neighbor)) { visited.add(neighbor); pending.push(neighbor); } }
    if (component.length < 3) continue;
    const center = component.reduce((sum, key) => sum.add(pointsByKey.get(key)!), new THREE.Vector3()).multiplyScalar(1 / component.length).setY(cutY);
    // Avoid a cap fan center landing exactly on a triangulated boundary edge,
    // which would create a zero-area fan triangle despite a valid closed loop.
    center.x += 1e-5; center.z += 1.7e-5;
    component.sort((a, b) => Math.atan2(pointsByKey.get(a)!.z - center.z, pointsByKey.get(a)!.x - center.x) - Math.atan2(pointsByKey.get(b)!.z - center.z, pointsByKey.get(b)!.x - center.x));
    const centerVertex = { point: center, color: capColor };
    for (let index = 0; index < component.length; index += 1) {
      const a = { point: pointsByKey.get(component[index]!)!, color: capColor }; const b = { point: pointsByKey.get(component[(index + 1) % component.length]!)!, color: capColor };
      const upward = b.point.clone().sub(a.point).cross(center.clone().sub(a.point)).y >= 0;
      if (upward) pushTriangle(a, b, centerVertex); else pushTriangle(b, a, centerVertex);
    }
  }
  source.dispose();
  const clipped = new THREE.BufferGeometry(); clipped.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); clipped.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); clipped.computeVertexNormals();
  return clipped;
}

function rockMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.96, metalness: 0.012, flatShading: true });
}

function plantMaterial(color: string, phase: number, amplitude: number, vertexColors = false): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.08,
    vertexColors,
  });
  const swayTime = { value: 0 };
  material.userData.decorSway = { uniform: swayTime, phase, amplitude };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.decorSwayTime = swayTime;
    shader.uniforms.decorSwayPhase = { value: phase };
    shader.uniforms.decorSwayAmplitude = { value: amplitude };
    shader.vertexShader = `uniform float decorSwayTime;\nuniform float decorSwayPhase;\nuniform float decorSwayAmplitude;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\nfloat decorSwayWeight = pow(clamp(position.y / 4.0, 0.0, 1.0), 1.35);\nfloat decorSway = sin(decorSwayTime * 0.85 + decorSwayPhase + position.y * 1.3) * decorSwayAmplitude * decorSwayWeight;\ntransformed.x += decorSway;\ntransformed.z += decorSway * 0.36;`,
    );
  };
  material.customProgramCacheKey = () => 'aquarium-decor-sway-v1';
  return material;
}

function makeErodedBoulder(radius: number, height: number, seed: number, random: () => number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  geometry.deleteAttribute('uv');
  geometry.scale(radius * (0.82 + random() * 0.28), height, radius * (0.78 + random() * 0.34));
  geometry.rotateY(random() * Math.PI * 2); erodeAlongNormals(geometry, seed, radius * 0.13);
  geometry.computeBoundingBox(); geometry.translate(0, -geometry.boundingBox!.min.y, 0); return colorizeRock(geometry, seed, 0.28);
}

function makeStrataSlab(radius: number, height: number, seed: number, random: () => number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radius * (0.92 + random() * 0.13), radius, height, 18, 3, false);
  geometry.deleteAttribute('uv');
  geometry.scale(1, 1, 0.62 + random() * 0.16); geometry.rotateY(random() * Math.PI * 2);
  erodeAlongNormals(geometry, seed, radius * 0.065); geometry.computeBoundingBox(); geometry.translate(0, -geometry.boundingBox!.min.y, 0); return colorizeRock(geometry, seed, 0.36);
}

function createRockMesh(primaryParts: THREE.BufferGeometry[], item: DecorItemSettings, anatomy: Record<string, unknown>, detailParts: THREE.BufferGeometry[] = []): THREE.Group {
  const group = new THREE.Group(); const primary = new THREE.Mesh(mergeGeometryParts(primaryParts), rockMaterial()); primary.castShadow = true; primary.receiveShadow = true; primary.userData.rockPrimary = true; group.add(primary);
  if (detailParts.length) { const detail = new THREE.Mesh(mergeGeometryParts(detailParts), rockMaterial()); detail.castShadow = true; detail.receiveShadow = true; detail.userData.rockSurfaceDetail = true; group.add(detail); }
  group.userData.rockAnatomy = { decorKind: item.kind, formationStyle: item.rockStyle, seed: item.seed, ...anatomy, coherentErosion: true, porousColorVariation: true, stratifiedWeathering: true }; return group;
}

function buildRock(item: DecorItemSettings, random: () => number): { group: THREE.Group; radius: number; height: number } {
  if (item.kind === 'rockArch') {
    const halfSpan = 1.08; const crown = 1.55;
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-halfSpan, 0.12, 0), new THREE.Vector3(-halfSpan * 0.72, crown * 0.68, 0.04), new THREE.Vector3(0, crown, -0.03), new THREE.Vector3(halfSpan * 0.72, crown * 0.68, 0.03), new THREE.Vector3(halfSpan, 0.12, 0)]);
    if (item.rockStyle === 'strata') {
      const shelfStones = curve.getPoints(16).map((point, index) => {
        const height = 0.16 + random() * 0.09; const radius = 0.28 + random() * 0.1;
        const stone = makeStrataSlab(radius, height, item.seed + 31 + index * 43, random);
        stone.scale(1.12 + random() * 0.16, 1, 0.82 + random() * 0.18);
        stone.translate(point.x + (random() - 0.5) * 0.07, Math.max(0, point.y - height * 0.5), point.z + (random() - 0.5) * 0.08);
        return stone;
      });
      const rubble: THREE.BufferGeometry[] = [];
      for (let index = 0; index < 6; index += 1) { const pebble = makeErodedBoulder(0.1 + random() * 0.1, 0.08 + random() * 0.1, item.seed + 907 + index * 37, random); const side = index % 2 ? -1 : 1; pebble.translate(side * (0.78 + random() * 0.56), 0, (random() - 0.5) * 0.5); rubble.push(pebble); }
      return { group: createRockMesh(shelfStones, item, { formation: 'layered shelf-stone arch', shelfStoneCount: shelfStones.length, openingWidth: halfSpan * 1.4, rubbleCount: rubble.length }, rubble), radius: 1.72, height: crown + 0.34 };
    }
    const path = curve.getPoints(34); const radii = path.map((_, index) => 0.29 + Math.sin(index / (path.length - 1) * Math.PI) * 0.055 + (random() - 0.5) * 0.018);
    const arch = makeTube(path, radii, 10); erodeAlongNormals(arch, item.seed + 17, 0.055); arch.computeBoundingBox(); arch.translate(0, -arch.boundingBox!.min.y, 0); colorizeRock(arch, item.seed + 17, 0.3);
    const left = makeErodedBoulder(0.5, 0.5, item.seed + 101, random); left.translate(-halfSpan, 0, 0);
    const right = makeErodedBoulder(0.5, 0.5, item.seed + 203, random); right.translate(halfSpan, 0, 0);
    const rubble: THREE.BufferGeometry[] = [];
    for (let index = 0; index < 5; index += 1) { const pebble = makeErodedBoulder(0.11 + random() * 0.1, 0.09 + random() * 0.13, item.seed + 307 + index * 29, random); const side = index % 2 ? -1 : 1; pebble.translate(side * (0.72 + random() * 0.65), 0, (random() - 0.5) * 0.55); rubble.push(pebble); }
    return { group: createRockMesh([arch, left, right], item, { formation: 'load-bearing arch', openingWidth: halfSpan * 1.45, buttresses: 2, rubbleCount: rubble.length }, rubble), radius: 1.72, height: crown + 0.34 };
  }
  if (item.kind === 'rockShelf') {
    const pedestal = makeErodedBoulder(0.68, 0.72, item.seed + 11, random); pedestal.scale(0.86, 1, 0.82);
    const lower = makeStrataSlab(1.03, 0.22, item.seed + 53, random); lower.translate(-0.12, 0.52, 0.02);
    const middle = makeStrataSlab(1.27, 0.2, item.seed + 97, random); middle.translate(0.16, 0.7, -0.04);
    const cap = makeStrataSlab(1.45, 0.18, item.seed + 149, random); cap.translate(0.28, 0.87, 0.03);
    return { group: createRockMesh([pedestal, lower, middle, cap], item, { formation: 'eroded shelf', layers: 3, undercut: true }), radius: 1.65, height: 1.08 };
  }
  const count = item.kind === 'rockCluster' ? Math.max(4, Math.min(12, item.density)) : 1;
  const parts: THREE.BufferGeometry[] = []; let maxRadius = 0; let maxHeight = 0;
  for (let index = 0; index < count; index += 1) {
    const radius = item.kind === 'rockCluster' ? 0.3 + random() * 0.5 : 0.88;
    const angle = random() * Math.PI * 2; const distance = index === 0 ? 0 : Math.sqrt(random()) * 0.9; const height = radius * (0.72 + random() * 0.75);
    const centerX = Math.cos(angle) * distance; const centerZ = Math.sin(angle) * distance;
    if (item.rockStyle === 'strata') {
      const layers = item.kind === 'boulder' ? Math.max(3, Math.min(7, item.density + 1)) : 2 + Math.floor(random() * 2); let stackTop = 0;
      for (let layer = 0; layer < layers; layer += 1) {
        const slabHeight = height * 1.7 / layers * (0.76 + random() * 0.2); const slabRadius = radius * (0.96 - layer * 0.055) * (0.88 + random() * 0.18);
        const slab = makeStrataSlab(slabRadius, slabHeight, item.seed + index * 131 + layer * 29, random);
        slab.translate(centerX + (random() - 0.5) * radius * 0.16, stackTop, centerZ + (random() - 0.5) * radius * 0.16); parts.push(slab); stackTop += slabHeight * 0.78;
      }
      maxHeight = Math.max(maxHeight, stackTop + height * 0.24);
    } else {
      const geometry = makeErodedBoulder(radius, height, item.seed + index * 131, random); geometry.translate(centerX, 0, centerZ); parts.push(geometry); maxHeight = Math.max(maxHeight, height * 2);
    }
    maxRadius = Math.max(maxRadius, distance + radius * 1.15);
  }
  const detailParts: THREE.BufferGeometry[] = [];
  if (item.kind === 'boulder') for (let index = 0; index < Math.max(2, item.density); index += 1) { const chipRadius = 0.08 + random() * 0.12; const chip = makeErodedBoulder(chipRadius, chipRadius * (0.5 + random() * 0.6), item.seed + 701 + index * 41, random); const angle = random() * Math.PI * 2; const distance = 0.68 + random() * 0.48; chip.translate(Math.cos(angle) * distance, 0, Math.sin(angle) * distance); detailParts.push(chip); maxRadius = Math.max(maxRadius, distance + chipRadius); }
  return { group: createRockMesh(parts, item, { formation: item.kind === 'rockCluster' ? 'interlocking basalt cluster' : 'faceted volcanic monolith', primaryCount: count, talusCount: detailParts.length }, detailParts), radius: maxRadius, height: maxHeight };
}

function makeClosedRibbonGrid(points: THREE.Vector3[], colors: number[], rows: number, columns: number, thicknessAxis: THREE.Vector3, thickness: number): THREE.BufferGeometry {
  const axis = thicknessAxis.clone().normalize().multiplyScalar(thickness * 0.5);
  const positions = [
    ...points.flatMap((point) => { const top = point.clone().add(axis); return [top.x, top.y, top.z]; }),
    ...points.flatMap((point) => { const bottom = point.clone().sub(axis); return [bottom.x, bottom.y, bottom.z]; }),
  ];
  const layerSize = points.length; const indices: number[] = [];
  for (let row = 0; row < rows - 1; row += 1) for (let column = 0; column < columns - 1; column += 1) {
    const a = row * columns + column; const b = a + 1; const c = (row + 1) * columns + column + 1; const d = (row + 1) * columns + column;
    indices.push(a, d, b, b, d, c);
    indices.push(a + layerSize, b + layerSize, d + layerSize, b + layerSize, c + layerSize, d + layerSize);
  }
  const sealEdge = (a: number, b: number, reverse = false): void => {
    const a2 = a + layerSize; const b2 = b + layerSize;
    if (reverse) indices.push(a, b2, b, a, a2, b2);
    else indices.push(a, b, b2, a, b2, a2);
  };
  for (let column = 0; column < columns - 1; column += 1) {
    sealEdge(column, column + 1, true);
    const last = (rows - 1) * columns + column; sealEdge(last, last + 1);
  }
  for (let row = 0; row < rows - 1; row += 1) {
    sealEdge(row * columns, (row + 1) * columns);
    sealEdge(row * columns + columns - 1, (row + 1) * columns + columns - 1, true);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute([...colors, ...colors.map((value) => value * 0.82)], 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function makeSeagrassBlade(base: THREE.Vector3, height: number, width: number, current: THREE.Vector3, phase: number, random: () => number): THREE.BufferGeometry {
  const segments = 12; const columns = 3; const points: THREE.Vector3[] = []; const colors: number[] = [];
  const lateral = new THREE.Vector3(-current.z, 0, current.x).normalize(); const sideCurl = (random() - 0.5) * height * 0.12;
  for (let row = 0; row <= segments; row += 1) {
    const t = row / segments; const envelope = Math.max(0.055, Math.pow(Math.sin(Math.PI * Math.min(0.999, t)), 0.42) * (1 - t * 0.2)); const half = width * envelope * 0.5;
    const center = base.clone().add(new THREE.Vector3(0, height * t, 0)).addScaledVector(current, height * (0.1 + random() * 0.06) * t * t).addScaledVector(lateral, sideCurl * Math.sin(Math.PI * t)).add(new THREE.Vector3(0, Math.sin(t * Math.PI * 3 + phase) * height * 0.008, 0));
    for (let column = 0; column < columns; column += 1) {
      const v = column - 1; const point = center.clone().addScaledVector(lateral, v * half).addScaledVector(current, column === 1 ? width * 0.07 * envelope : 0);
      points.push(point); const color = new THREE.Color('#397c46').lerp(new THREE.Color('#78a84f'), t * 0.58 + Math.abs(v) * 0.07); colors.push(color.r, color.g, color.b);
    }
  }
  return makeClosedRibbonGrid(points, colors, segments + 1, columns, current, Math.max(0.004, width * 0.075));
}

function makeAlgaeFrond(base: THREE.Vector3, directionInput: THREE.Vector3, length: number, width: number, phase: number, random: () => number): THREE.BufferGeometry {
  const uSegments = 11; const vSegments = 4; const direction = directionInput.clone().normalize();
  let widthAxis = new THREE.Vector3(0, 1, 0).cross(direction).normalize(); if (widthAxis.lengthSq() < 1e-8) widthAxis = new THREE.Vector3(1, 0, 0);
  const normal = widthAxis.clone().cross(direction).normalize(); const points: THREE.Vector3[] = []; const colors: number[] = []; const edgePhase = random() * Math.PI * 2;
  for (let uIndex = 0; uIndex <= uSegments; uIndex += 1) {
    const u = uIndex / uSegments; const envelope = Math.max(0.045, Math.pow(Math.sin(Math.PI * u), 0.5) * (0.9 + 0.18 * u)); const center = base.clone().addScaledVector(direction, length * u).addScaledVector(normal, Math.sin(u * Math.PI * 2.5 + phase) * length * 0.035 * u);
    for (let vIndex = 0; vIndex <= vSegments; vIndex += 1) {
      const v = -1 + 2 * vIndex / vSegments; const ruffle = 1 + 0.18 * Math.sin(u * Math.PI * 7 + v * 2.4 + edgePhase); const point = center.clone().addScaledVector(widthAxis, v * width * envelope * 0.5 * ruffle).addScaledVector(normal, Math.sin(v * Math.PI * 1.5 + u * 8 + phase) * length * 0.022);
      points.push(point); const color = new THREE.Color('#557d35').lerp(new THREE.Color('#91a94d'), u * 0.5 + Math.abs(v) * 0.12); colors.push(color.r, color.g, color.b);
    }
  }
  return makeClosedRibbonGrid(points, colors, uSegments + 1, vSegments + 1, normal, Math.max(0.005, width * 0.055));
}

function makeTube(points: THREE.Vector3[], radii: number[], sides: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const tangents = points.map((_, index) => {
    const previous = points[Math.max(0, index - 1)]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;
    return next.clone().sub(previous).normalize();
  });
  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];
  const reference = Math.abs(tangents[0]!.dot(new THREE.Vector3(0, 0, 1))) > 0.88 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  normals[0] = tangents[0]!.clone().cross(reference).normalize();
  binormals[0] = tangents[0]!.clone().cross(normals[0]!).normalize();
  for (let index = 1; index < points.length; index += 1) {
    const tangent = tangents[index]!;
    const candidate = normals[index - 1]!.clone().addScaledVector(tangent, -normals[index - 1]!.dot(tangent));
    normals[index] = candidate.lengthSq() < 1e-8 ? tangent.clone().cross(binormals[index - 1]!).normalize() : candidate.normalize();
    binormals[index] = tangent.clone().cross(normals[index]!).normalize();
  }
  for (let index = 0; index < points.length; index += 1) {
    for (let side = 0; side < sides; side += 1) {
      const angle = side / sides * Math.PI * 2;
      const radial = normals[index]!.clone().multiplyScalar(Math.cos(angle)).addScaledVector(binormals[index]!, Math.sin(angle));
      const point = points[index]!.clone().addScaledVector(radial, radii[index]!);
      positions.push(point.x, point.y, point.z);
    }
  }
  for (let index = 0; index < points.length - 1; index += 1) {
    for (let side = 0; side < sides; side += 1) {
      const a = index * sides + side;
      const b = index * sides + (side + 1) % sides;
      const c = (index + 1) * sides + (side + 1) % sides;
      const d = (index + 1) * sides + side;
      indices.push(a, b, c, a, c, d);
    }
  }
  const startCenter = positions.length / 3; positions.push(points[0]!.x, points[0]!.y, points[0]!.z);
  const endCenter = positions.length / 3; const lastPoint = points[points.length - 1]!; positions.push(lastPoint.x, lastPoint.y, lastPoint.z);
  for (let side = 0; side < sides; side += 1) {
    const next = (side + 1) % sides;
    indices.push(startCenter, next, side);
    const a = (points.length - 1) * sides + side; const b = (points.length - 1) * sides + next;
    indices.push(endCenter, a, b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makePearBladder(start: THREE.Vector3, axisInput: THREE.Vector3, length: number, maxRadius: number): THREE.BufferGeometry {
  const rings = 8; const sides = 9;
  const axis = axisInput.clone().normalize();
  const reference = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const normal = axis.clone().cross(reference).normalize();
  const binormal = axis.clone().cross(normal).normalize();
  const positions: number[] = [start.x, start.y, start.z]; const indices: number[] = [];
  for (let ring = 1; ring < rings; ring += 1) {
    const t = ring / rings;
    const radius = maxRadius * Math.pow(Math.sin(Math.PI * t), 0.76) * (1.14 - 0.43 * t);
    const center = start.clone().addScaledVector(axis, length * t);
    for (let side = 0; side < sides; side += 1) {
      const angle = side / sides * Math.PI * 2;
      const point = center.clone().addScaledVector(normal, Math.cos(angle) * radius).addScaledVector(binormal, Math.sin(angle) * radius);
      positions.push(point.x, point.y, point.z);
    }
  }
  for (let ring = 0; ring < rings - 2; ring += 1) for (let side = 0; side < sides; side += 1) {
    const a = 1 + ring * sides + side; const b = 1 + ring * sides + (side + 1) % sides; const c = 1 + (ring + 1) * sides + (side + 1) % sides; const d = 1 + (ring + 1) * sides + side;
    indices.push(a, b, c, a, c, d);
  }
  const end = start.clone().addScaledVector(axis, length); const endIndex = positions.length / 3; positions.push(end.x, end.y, end.z);
  const lastRing = 1 + (rings - 2) * sides;
  for (let side = 0; side < sides; side += 1) {
    const next = (side + 1) % sides;
    indices.push(0, 1 + next, 1 + side);
    indices.push(endIndex, lastRing + side, lastRing + next);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function makeBuoyantBlade(base: THREE.Vector3, radial: THREE.Vector3, directionInput: THREE.Vector3, length: number, maxWidth: number, thickness: number, phase: number, random: () => number): THREE.BufferGeometry {
  const uSegments = 14; const vSegments = 4;
  const direction = directionInput.clone().normalize();
  let widthAxis = new THREE.Vector3(0, 1, 0).cross(radial).normalize();
  if (widthAxis.lengthSq() < 1e-8) widthAxis = direction.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
  const normalAxis = widthAxis.clone().cross(direction).normalize();
  const sidewaysCurve = (random() - 0.5) * 0.1 * length;
  const outwardCurve = (0.025 + random() * 0.05) * length;
  const waveAmplitude = (0.014 + random() * 0.013) * length;
  const edgePhase = random() * Math.PI * 2;
  const top: THREE.Vector3[] = []; const bottom: THREE.Vector3[] = []; const colors: number[] = [];
  for (let uIndex = 0; uIndex <= uSegments; uIndex += 1) {
    const u = uIndex / uSegments;
    const envelope = Math.max(0.035, Math.pow(Math.sin(Math.PI * u), 0.68) * (0.84 + 0.25 * u));
    const halfWidth = maxWidth * envelope * 0.5;
    const center = base.clone().addScaledVector(direction, length * u)
      .addScaledVector(widthAxis, sidewaysCurve * Math.sin(Math.PI * u))
      .addScaledVector(radial, outwardCurve * Math.sin(Math.PI * u))
      .addScaledVector(normalAxis, waveAmplitude * Math.sin(Math.PI * 2 * 1.25 * u + phase) * (0.2 + 0.8 * u));
    for (let vIndex = 0; vIndex <= vSegments; vIndex += 1) {
      const v = -1 + 2 * vIndex / vSegments;
      const edgeRipple = 1 + 0.09 * Math.sin(6 * Math.PI * u + edgePhase + 1.35 * v);
      const point = center.clone().addScaledVector(widthAxis, v * halfWidth * edgeRipple)
        .addScaledVector(normalAxis, 0.0135 * length * Math.sin(7 * Math.PI * u + 2.2 * v + phase) * (0.28 + 0.72 * Math.abs(v)));
      top.push(point.clone().addScaledVector(normalAxis, thickness * 0.5));
      bottom.push(point.clone().addScaledVector(normalAxis, -thickness * 0.5));
      const edgeLight = 0.1 * Math.abs(v) + 0.07 * u;
      colors.push((67 + 47 * (0.25 + 0.5 * u) + edgeLight * 82) / 255, (89 + 29 * (0.25 + 0.5 * u) + edgeLight * 82) / 255, (27 + 4 * (0.25 + 0.5 * u) + edgeLight * 82) / 255);
    }
  }
  const positions = [...top, ...bottom].flatMap((point) => [point.x, point.y, point.z]);
  const vertexColors = [...colors, ...colors.map((value) => value * 0.8)];
  const row = vSegments + 1; const layerSize = (uSegments + 1) * row; const indices: number[] = [];
  for (let u = 0; u < uSegments; u += 1) for (let v = 0; v < vSegments; v += 1) {
    const a = u * row + v; const b = a + 1; const c = (u + 1) * row + v + 1; const d = (u + 1) * row + v;
    indices.push(a, b, c, a, c, d, a + layerSize, c + layerSize, b + layerSize, a + layerSize, d + layerSize, c + layerSize);
  }
  for (let u = 0; u < uSegments; u += 1) for (const v of [0, vSegments]) {
    const a = u * row + v; const b = (u + 1) * row + v; const a2 = a + layerSize; const b2 = b + layerSize;
    if (v === 0) indices.push(a, b, b2, a, b2, a2); else indices.push(a, b2, b, a, a2, b2);
  }
  for (const u of [0, uSegments]) for (let v = 0; v < vSegments; v += 1) {
    const a = u * row + v; const b = a + 1; const a2 = a + layerSize; const b2 = b + layerSize;
    if (u === 0) indices.push(a, a2, b2, a, b2, b); else indices.push(a, b2, a2, a, b, b2);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function mergeGeometryParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const mixedIndexing = parts.some((part) => part.index) && parts.some((part) => !part.index);
  const compatible = mixedIndexing ? parts.map((part) => {
    if (!part.index) return part;
    const converted = part.toNonIndexed();
    part.dispose();
    return converted;
  }) : parts;
  const merged = mergeGeometries(compatible, false);
  if (!merged) throw new Error('Could not merge procedural decor geometry.');
  compatible.forEach((part) => { if (part !== merged) part.dispose(); });
  return merged;
}

function pathPointAndTangent(points: THREE.Vector3[], t: number): { point: THREE.Vector3; tangent: THREE.Vector3 } {
  const scaled = THREE.MathUtils.clamp(t, 0, 1) * (points.length - 1);
  const index = Math.min(Math.floor(scaled), points.length - 2); const local = scaled - index;
  return { point: points[index]!.clone().lerp(points[index + 1]!, local), tangent: points[Math.min(index + 1, points.length - 1)]!.clone().sub(points[Math.max(0, index - 1)]!).normalize() };
}

function buildKelp(item: DecorItemSettings, random: () => number): { group: THREE.Group; radius: number; height: number } {
  const group = new THREE.Group(); const height = 3.5 + random() * 0.65; const lean = 0.32 + random() * 0.28;
  const currentAngle = random() * Math.PI * 2; const current = new THREE.Vector3(Math.cos(currentAngle), 0, Math.sin(currentAngle)); const cross = new THREE.Vector3(-current.z, 0, current.x);
  const controls = [new THREE.Vector3(), current.clone().multiplyScalar(lean * 0.1).setY(height * 0.23), current.clone().multiplyScalar(lean * 0.4).addScaledVector(cross, lean * 0.08).setY(height * 0.5), current.clone().multiplyScalar(lean * 0.78).addScaledVector(cross, -lean * 0.06).setY(height * 0.76), current.clone().multiplyScalar(lean).setY(height)];
  const stipePath = new THREE.CatmullRomCurve3(controls).getPoints(40);
  const stipeRadii = stipePath.map((_, index) => THREE.MathUtils.lerp(0.04, 0.013, index / (stipePath.length - 1)));
  const stalkParts: THREE.BufferGeometry[] = [makeTube(stipePath, stipeRadii, 9)]; const floatParts: THREE.BufferGeometry[] = []; const bladeParts: THREE.BufferGeometry[] = [];
  const bladeCount = Math.max(5, Math.min(18, item.density)); let collisionRadius = lean + 0.4;
  for (let index = 0; index < bladeCount; index += 1) {
    const t = THREE.MathUtils.clamp(THREE.MathUtils.lerp(0.18, 0.92, bladeCount === 1 ? 0.5 : index / (bladeCount - 1)) + (random() - 0.5) * 0.016, 0.15, 0.95);
    const sample = pathPointAndTangent(stipePath, t); const angle = currentAngle + 0.75 + index * 2.399963 + (random() - 0.5) * 0.32; const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize();
    const petioleDirection = radial.clone().multiplyScalar(0.82).add(new THREE.Vector3(0, 0.48, 0)).addScaledVector(sample.tangent, 0.14).normalize();
    const petioleLength = 0.105 + random() * 0.06; const petioleEnd = sample.point.clone().addScaledVector(petioleDirection, petioleLength); const petioleMiddle = sample.point.clone().lerp(petioleEnd, 0.55).add(new THREE.Vector3(0, 0.012 + random() * 0.022, 0));
    const petiolePath = new THREE.CatmullRomCurve3([sample.point, petioleMiddle, petioleEnd]).getPoints(8); stalkParts.push(makeTube(petiolePath, petiolePath.map((_, i) => THREE.MathUtils.lerp(0.014, 0.0075, i / (petiolePath.length - 1))), 7));
    const bladderAxis = radial.clone().multiplyScalar(0.46).add(new THREE.Vector3(0, 0.82, 0)).addScaledVector(sample.tangent, 0.12).normalize(); const bladderLength = 0.105 + random() * 0.04; const bladderRadius = 0.038 + random() * 0.016;
    floatParts.push(makePearBladder(petioleEnd, bladderAxis, bladderLength, bladderRadius)); const bladeBase = petioleEnd.clone().addScaledVector(bladderAxis, bladderLength * 0.91);
    const maturity = 1 - Math.max(0, (t - 0.7) / 0.28) * 0.44; const bladeDirection = radial.clone().multiplyScalar(0.34 - 0.1 * t).add(new THREE.Vector3(0, 0.9 + 0.18 * t, 0)).addScaledVector(current, 0.14).addScaledVector(sample.tangent, 0.16).normalize();
    const bladeLength = (0.58 + random() * 0.28) * maturity; const bladeWidth = (0.22 + random() * 0.11) * maturity;
    bladeParts.push(makeBuoyantBlade(bladeBase, radial, bladeDirection, bladeLength, bladeWidth, 0.006 + random() * 0.003, random() * Math.PI * 2, random)); collisionRadius = Math.max(collisionRadius, Math.hypot(sample.point.x, sample.point.z) + bladeLength);
  }
  const tip = stipePath[stipePath.length - 1]!; const tipTangent = tip.clone().sub(stipePath[stipePath.length - 2]!).normalize(); const tipRadial = current.clone().addScaledVector(cross, 0.25).normalize(); bladeParts.push(makeBuoyantBlade(tip, tipRadial, new THREE.Vector3(0, 0.96, 0).addScaledVector(tipTangent, 0.26).addScaledVector(current, 0.1).normalize(), 0.32, 0.13, 0.0055, random() * Math.PI * 2, random));
  const phase = random() * Math.PI * 2; const stalk = new THREE.Mesh(mergeGeometryParts(stalkParts), plantMaterial('#4a4911', phase, 0.12)); const floats = new THREE.Mesh(mergeGeometryParts(floatParts), plantMaterial('#6d6417', phase + 0.08, 0.13)); const blades = new THREE.Mesh(mergeGeometryParts(bladeParts), plantMaterial('#ffffff', phase + 0.16, 0.18, true));
  for (const mesh of [stalk, floats, blades]) { mesh.castShadow = true; group.add(mesh); }
  group.userData.kelpAnatomy = { rootless: true, stipeCount: 1, bladeCount, includesPneumatocysts: true, buoyancyAligned: true };
  return { group, radius: collisionRadius, height: height + 0.45 };
}

function buildPlant(item: DecorItemSettings, random: () => number): { group: THREE.Group; radius: number; height: number } {
  if (item.kind === 'kelp') return buildKelp(item, random);
  const group = new THREE.Group();
  const phase = random() * Math.PI * 2;
  if (item.kind === 'seagrass') {
    const count = Math.max(6, Math.min(24, item.density)); const spread = 0.68; const bladeParts: THREE.BufferGeometry[] = []; const rhizomeParts: THREE.BufferGeometry[] = [];
    const currentAngle = random() * Math.PI * 2; const current = new THREE.Vector3(Math.cos(currentAngle), 0, Math.sin(currentAngle)).normalize(); const tuftCenters = [new THREE.Vector3(-0.24, 0.018, -0.08), new THREE.Vector3(0.18, 0.018, 0.16), new THREE.Vector3(0.12, 0.018, -0.22)]; let maxHeight = 0;
    for (let index = 0; index < count; index += 1) {
      const tuft = tuftCenters[index % tuftCenters.length]!; const angle = random() * Math.PI * 2; const distance = Math.sqrt(random()) * 0.28; const base = tuft.clone().add(new THREE.Vector3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance)); const height = 0.72 + random() * 0.68; const width = 0.055 + random() * 0.055;
      bladeParts.push(makeSeagrassBlade(base, height, width, current.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (random() - 0.5) * 0.5), phase + index * 0.37, random)); maxHeight = Math.max(maxHeight, height);
    }
    for (let index = 0; index < tuftCenters.length; index += 1) { const next = tuftCenters[(index + 1) % tuftCenters.length]!; const path = new THREE.CatmullRomCurve3([tuftCenters[index]!, tuftCenters[index]!.clone().lerp(next, 0.5).add(new THREE.Vector3(0, -0.008, 0)), next]).getPoints(7); rhizomeParts.push(makeTube(path, path.map(() => 0.018), 6)); }
    const rhizome = new THREE.Mesh(mergeGeometryParts(rhizomeParts), plantMaterial('#56733c', phase, 0.025)); const blades = new THREE.Mesh(mergeGeometryParts(bladeParts), plantMaterial('#ffffff', phase + 0.13, 0.15, true)); rhizome.receiveShadow = true; blades.castShadow = true; group.add(rhizome, blades);
    group.userData.plantAnatomy = { form: 'rhizomatous seagrass meadow', tuftCount: tuftCenters.length, bladeCount: count, foldedMidribs: true, sharedCurrent: true };
    return { group, radius: spread, height: maxHeight };
  }
  const stemCount = Math.max(3, Math.min(8, Math.ceil(item.density / 3))); const stemParts: THREE.BufferGeometry[] = []; const frondParts: THREE.BufferGeometry[] = []; let maxHeight = 0; let maxRadius = 0.48;
  for (let stemIndex = 0; stemIndex < stemCount; stemIndex += 1) {
    const baseAngle = random() * Math.PI * 2; const baseDistance = Math.sqrt(random()) * 0.3; const base = new THREE.Vector3(Math.cos(baseAngle) * baseDistance, 0.01, Math.sin(baseAngle) * baseDistance); const height = 0.48 + random() * 0.52; const lean = new THREE.Vector3(Math.cos(baseAngle), 0, Math.sin(baseAngle)).multiplyScalar(0.12 + random() * 0.16);
    const controls = [base, base.clone().add(new THREE.Vector3(0, height * 0.35, 0)).addScaledVector(lean, 0.2), base.clone().add(new THREE.Vector3(0, height * 0.7, 0)).addScaledVector(lean, 0.62), base.clone().add(new THREE.Vector3(0, height, 0)).add(lean)]; const path = new THREE.CatmullRomCurve3(controls).getPoints(16); stemParts.push(makeTube(path, path.map((_, index) => THREE.MathUtils.lerp(0.026, 0.009, index / (path.length - 1))), 7));
    for (const t of [0.38, 0.62, 0.82]) { const sample = pathPointAndTangent(path, t); const radialAngle = baseAngle + stemIndex * 1.7 + t * 4.3; const radial = new THREE.Vector3(Math.cos(radialAngle), 0, Math.sin(radialAngle)); const direction = radial.clone().multiplyScalar(0.45).add(new THREE.Vector3(0, 0.82, 0)).addScaledVector(sample.tangent, 0.2).normalize(); const length = (0.3 + random() * 0.3) * (1 - t * 0.16); frondParts.push(makeAlgaeFrond(sample.point, direction, length, 0.18 + random() * 0.18, phase + stemIndex + t * 2, random)); maxRadius = Math.max(maxRadius, baseDistance + length); }
    maxHeight = Math.max(maxHeight, height + 0.35);
  }
  const stems = new THREE.Mesh(mergeGeometryParts(stemParts), plantMaterial('#48632d', phase, 0.08)); const fronds = new THREE.Mesh(mergeGeometryParts(frondParts), plantMaterial('#ffffff', phase + 0.17, 0.13, true)); stems.castShadow = true; fronds.castShadow = true; group.add(stems, fronds);
  group.userData.plantAnatomy = { form: 'branching ruffled macroalgae', stemCount, frondCount: stemCount * 3, lobedEdges: true, sharedCurrent: true };
  return { group, radius: maxRadius, height: maxHeight };
}

function projectedConvexHull(group: THREE.Group): Array<[number, number]> {
  const unique = new Map<string, THREE.Vector2>(); const point = new THREE.Vector3();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      const key = `${Math.round(point.x * 1e5)},${Math.round(point.z * 1e5)}`;
      if (!unique.has(key)) unique.set(key, new THREE.Vector2(point.x, point.z));
    }
  });
  const points = [...unique.values()].sort((a, b) => a.x - b.x || a.y - b.y);
  if (points.length <= 2) return points.map((entry) => [entry.x, entry.y]);
  const cross = (origin: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const lower: THREE.Vector2[] = []; const upper: THREE.Vector2[] = [];
  for (const entry of points) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, entry) <= 0) lower.pop(); lower.push(entry); }
  for (let index = points.length - 1; index >= 0; index -= 1) { const entry = points[index]!; while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, entry) <= 0) upper.pop(); upper.push(entry); }
  lower.pop(); upper.pop();
  return [...lower, ...upper].map((entry) => [entry.x, entry.y]);
}

export function buildDecorItem(item: DecorItemSettings, floorY: number): DecorBuild {
  const random = randomGenerator(item.seed);
  const plant = item.kind === 'kelp' || item.kind === 'seagrass' || item.kind === 'algae';
  const built = plant ? buildPlant(item, random) : buildRock(item, random);
  const group = built.group;
  group.name = `DECOR_${item.id.replace(/[^a-z0-9]+/gi, '_')}`;
  group.rotation.y = THREE.MathUtils.degToRad(item.rotation);
  group.updateMatrixWorld(true);
  const originalBounds = new THREE.Box3().setFromObject(group); const originalBottom = originalBounds.min.y;
  if (!plant && item.y < 0) {
    const localCutY = originalBottom - item.y / item.scaleY;
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.userData.rockPrimary) { const original = object.geometry; object.geometry = clipAndCapRock(original, localCutY); original.dispose(); }
      // Talus and arch rubble remain sitting on the substrate while the large
      // formation sinks beneath it.
      if (object.userData.rockSurfaceDetail) object.position.y = -item.y / item.scaleY;
    });
  }
  group.scale.set(item.scaleX, item.scaleY, item.scaleZ);
  group.position.set(item.x, floorY + item.y - originalBottom * item.scaleY, item.z);
  group.updateMatrixWorld(true);
  const visibleBounds = new THREE.Box3().setFromObject(group);
  const placementFootprint = projectedConvexHull(group);
  const rotation = THREE.MathUtils.degToRad(item.rotation); const cos = Math.cos(rotation); const sin = Math.sin(rotation);
  let minX = Number.POSITIVE_INFINITY; let maxX = Number.NEGATIVE_INFINITY; let minZ = Number.POSITIVE_INFINITY; let maxZ = Number.NEGATIVE_INFINITY;
  for (const [worldX, worldZ] of placementFootprint) { const dx = worldX - item.x; const dz = worldZ - item.z; const localX = cos * dx - sin * dz; const localZ = sin * dx + cos * dz; minX = Math.min(minX, localX); maxX = Math.max(maxX, localX); minZ = Math.min(minZ, localZ); maxZ = Math.max(maxZ, localZ); }
  if (!Number.isFinite(minX)) { minX = minZ = -0.01; maxX = maxZ = 0.01; }
  const localCenterX = (minX + maxX) * 0.5; const localCenterZ = (minZ + maxZ) * 0.5;
  const collisionCenterX = item.x + cos * localCenterX + sin * localCenterZ; const collisionCenterZ = item.z - sin * localCenterX + cos * localCenterZ;
  const visibleBottom = visibleBounds.isEmpty() ? floorY : visibleBounds.min.y;
  const visibleTop = visibleBounds.isEmpty() ? floorY : visibleBounds.max.y;
  group.userData = { ...group.userData, decorId: item.id, decorKind: item.kind, seed: item.seed, animated: plant };
  let partIndex = 0;
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    partIndex += 1;
    object.name = `DECOR_${item.id.replace(/[^a-z0-9]+/gi, '_')}_Part_${String(partIndex).padStart(2, '0')}`;
    object.userData = { ...object.userData, decorId: item.id, decorKind: item.kind, animated: plant };
  });
  return {
    group,
    animated: plant,
    placementFootprint,
    collision: {
      id: item.id,
      kind: item.kind,
      center: [collisionCenterX, visibleBottom, collisionCenterZ],
      halfExtents: [(maxX - minX) * 0.5 + 0.015, (maxZ - minZ) * 0.5 + 0.015],
      rotation,
      yBottom: visibleBottom,
      yTop: visibleTop,
    },
  };
}
