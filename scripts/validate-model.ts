class FakeCanvas {
  width = 1;
  height = 1;
  getContext() {
    return {
      createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: () => undefined,
    };
  }
}
(globalThis as unknown as { document: unknown }).document = {
  createElement: (name: string) => name === 'canvas' ? new FakeCanvas() : {},
};

const THREE = await import('three');
const { buildAquarium } = await import('../app/src/model/aquarium');
const { buildDecorItem } = await import('../app/src/model/decor');
const { cloneSettings, createDecorItem, createPassage, DEFAULT_SETTINGS, normalizeSettings } = await import('../app/src/model/settings');

function validate(label: string, settings: ReturnType<typeof cloneSettings>) {
  const build = buildAquarium(normalizeSettings(settings));
  const box = new THREE.Box3().setFromObject(build.group);
  let meshes = 0;
  let invalid = 0;
  let degenerate = 0;
  let openDecorEdges = 0;
  const names: string[] = [];
  const acrylicMaterials = new Set<string>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const cross = new THREE.Vector3();

  build.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    names.push(object.name);
    if (/GLASS_AcrylicShell|AcrylicShell|GlassFloor/.test(object.name)) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) acrylicMaterials.add(material.uuid);
    }
    const geometry = object.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    for (let index = 0; index < position.count; index += 1) {
      if (![position.getX(index), position.getY(index), position.getZ(index)].every(Number.isFinite)) invalid += 1;
      if (normal && ![normal.getX(index), normal.getY(index), normal.getZ(index)].every(Number.isFinite)) invalid += 1;
    }

    const indices = geometry.index;
    const triangleCount = indices ? Math.floor(indices.count / 3) : Math.floor(position.count / 3);
    const edgeUse = new Map<string, number>();
    const vertexKey = (vertex: number): string => `${Math.round(position.getX(vertex) * 1e6)},${Math.round(position.getY(vertex) * 1e6)},${Math.round(position.getZ(vertex) * 1e6)}`;
    const addEdge = (from: number, to: number): void => {
      const endpoints = [vertexKey(from), vertexKey(to)].sort(); const key = `${endpoints[0]}|${endpoints[1]}`;
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    };
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const ia = indices ? indices.getX(triangle * 3) : triangle * 3;
      const ib = indices ? indices.getX(triangle * 3 + 1) : triangle * 3 + 1;
      const ic = indices ? indices.getX(triangle * 3 + 2) : triangle * 3 + 2;
      if (ia >= position.count || ib >= position.count || ic >= position.count) {
        invalid += 1;
        continue;
      }
      a.fromBufferAttribute(position, ia);
      b.fromBufferAttribute(position, ib);
      c.fromBufferAttribute(position, ic);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      cross.crossVectors(ab, ac);
      if (!Number.isFinite(cross.lengthSq()) || cross.lengthSq() < 1e-16) degenerate += 1;
      if (object.name.startsWith('DECOR_')) { addEdge(ia, ib); addEdge(ib, ic); addEdge(ic, ia); }
    }
    if (object.name.startsWith('DECOR_')) openDecorEdges += [...edgeUse.values()].filter((count) => count === 1).length;
  });
  const navigation = build.group.userData.navigation as { schema?: string; schemaVersion?: number; regions?: unknown[]; portals?: unknown[]; swimVolumeLayers?: Array<{ yBottom?: number; yTop?: number; polygons?: unknown[] }>; dryPassages?: Array<{ crossSection?: unknown[]; centerline?: unknown[]; bendRadius?: number }>; decorObstacles?: Array<{ id?: string; kind?: string; shape?: string; halfExtents?: number[]; rotation?: number; yBottom?: number; yTop?: number }> } | undefined;
  const navigationValid = navigation?.schema === 'aquarium-maker-navigation'
    && navigation.schemaVersion === 4
    && Array.isArray(navigation.regions)
    && Array.isArray(navigation.portals)
    && Array.isArray(navigation.swimVolumeLayers)
    && navigation.swimVolumeLayers.length >= 1
    && navigation.swimVolumeLayers.every((layer) => Number.isFinite(layer.yBottom) && Number.isFinite(layer.yTop) && Array.isArray(layer.polygons))
    && Array.isArray(navigation.dryPassages)
    && navigation.dryPassages.every((passage) => Array.isArray(passage.crossSection) && Array.isArray(passage.centerline))
    && Array.isArray(navigation.decorObstacles)
    && navigation.decorObstacles.every((obstacle) => typeof obstacle.id === 'string' && obstacle.shape === 'orientedBox' && obstacle.halfExtents?.length === 2 && obstacle.halfExtents.every(Number.isFinite) && Number.isFinite(obstacle.rotation) && Number.isFinite(obstacle.yBottom) && Number.isFinite(obstacle.yTop));
  const acrylicMaterialConsistent = acrylicMaterials.size <= 1;
  const hardElbowValid = !label.includes('elbow') || navigation?.dryPassages?.every((passage) => passage.bendRadius === 0 && passage.centerline?.length === 3);
  const obstacleCount = navigation?.decorObstacles?.length ?? 0;
  const decorValid = label === 'decor-rocks-plants-navigation' || label === 'decor-below-passage-vertical-separation' ? obstacleCount === 1
    : label === 'decor-dense-procedural-plants' ? obstacleCount === 0
      : label.includes('all-decor-families') ? obstacleCount === 4 : true;
  const rockKinds = new Set(['boulder', 'rockCluster', 'rockArch', 'rockShelf']);
  const allDecorKindsValid = !label.includes('all-decor-families') || (navigation?.decorObstacles?.every((obstacle) => rockKinds.has(obstacle.kind ?? '')) && new Set(navigation?.decorObstacles?.map((obstacle) => obstacle.kind)).size === 4);
  const decorClosed = !label.includes('decor') || openDecorEdges === 0;
  console.log(JSON.stringify({ label, meshes, triangles: build.triangles, vertices: build.vertices, invalid, degenerate, openDecorEdges, navigationValid, decorValid, decorClosed, acrylicMaterialConsistent, regions: navigation?.regions?.length ?? 0, portals: navigation?.portals?.length ?? 0, decorObstacles: navigation?.decorObstacles?.length ?? 0, size: box.getSize(new THREE.Vector3()).toArray(), names }, null, 2));
  if (invalid || degenerate || !navigationValid || !decorValid || !decorClosed || !allDecorKindsValid || !acrylicMaterialConsistent || !hardElbowValid) process.exitCode = 1;
  build.dispose();
}

validate('standard', cloneSettings(DEFAULT_SETTINGS));
const tunnel = cloneSettings(DEFAULT_SETTINGS);
tunnel.tunnelEnabled = true;
tunnel.width = 12;
tunnel.depth = 8;
tunnel.height = 5.4;
tunnel.radii = { frontLeft: 0.75, frontRight: 0.75, backRight: 0.22, backLeft: 0.22 };
tunnel.tunnelWidth = 2.65;
tunnel.tunnelWallHeight = 1.18;
tunnel.tunnelRoundness = 0.88;
validate('tunnel', tunnel);

const lowWaterTallTunnel = cloneSettings(DEFAULT_SETTINGS);
lowWaterTallTunnel.width = 12;
lowWaterTallTunnel.depth = 8;
lowWaterTallTunnel.height = 5.4;
lowWaterTallTunnel.waterLevel = 0.24;
lowWaterTallTunnel.tunnelEnabled = true;
lowWaterTallTunnel.tunnelWidth = 2.2;
lowWaterTallTunnel.tunnelWallHeight = 3.25;
lowWaterTallTunnel.tunnelRoundness = 0.8;
validate('low-water-tall-tunnel', lowWaterTallTunnel);
const mixed = cloneSettings(DEFAULT_SETTINGS);
mixed.cornerModes = { frontLeft: 'chamfer', frontRight: 'rounded', backRight: 'square', backLeft: 'chamfer' };
mixed.tunnelEnabled = true;
validate('mixed-corners-tunnel', mixed);
const widthTunnel = cloneSettings(DEFAULT_SETTINGS);
widthTunnel.tunnelEnabled = true;
widthTunnel.tunnelAxis = 'width';
widthTunnel.tunnelOffset = 0.55;
widthTunnel.tunnelWidth = 1.8;
widthTunnel.width = 12;
widthTunnel.depth = 7;
validate('width-axis-offset-tunnel', widthTunnel);

const squareTunnel = cloneSettings(DEFAULT_SETTINGS);
squareTunnel.tunnelEnabled = true;
squareTunnel.tunnelRoundness = 0;
squareTunnel.tunnelOffset = -0.6;
squareTunnel.groundPreset = 'gravel';
validate('square-offset-gravel-tunnel', squareTunnel);

const below = cloneSettings(DEFAULT_SETTINGS);
below.profile = 'belowFloor';
below.heightAboveFloor = 1.12;
below.depthBelowFloor = 3.35;
validate('below-floor', below);

const belowTunnel = cloneSettings(DEFAULT_SETTINGS);
belowTunnel.profile = 'belowFloor';
belowTunnel.tunnelEnabled = true;
belowTunnel.heightAboveFloor = 1.12;
belowTunnel.depthBelowFloor = 3.35;
belowTunnel.tunnelGlassFloor = true;
validate('below-floor-tunnel', belowTunnel);

const lShape = cloneSettings(DEFAULT_SETTINGS);
lShape.footprint = 'lShape';
lShape.width = 10.4;
lShape.depth = 7.4;
validate('l-shape-standard', lShape);

const uShape = cloneSettings(DEFAULT_SETTINGS);
uShape.footprint = 'uShape';
uShape.width = 11.2;
uShape.depth = 7.2;
validate('u-shape-standard', uShape);

const touchL = cloneSettings(DEFAULT_SETTINGS);
touchL.profile = 'touchPool';
touchL.footprint = 'lShape';
touchL.height = 1.55;
touchL.width = 7.4;
touchL.depth = 5.1;
validate('l-shape-touch-pool', touchL);

const lTunnel = cloneSettings(DEFAULT_SETTINGS);
lTunnel.footprint = 'lShape';
lTunnel.width = 10.4;
lTunnel.depth = 7.4;
lTunnel.tunnelEnabled = true;
lTunnel.tunnelAxis = 'depth';
lTunnel.tunnelOffset = -3.0;
lTunnel.tunnelWidth = 1.6;
validate('l-shape-tunnel', lTunnel);

const uTunnel = cloneSettings(DEFAULT_SETTINGS);
uTunnel.footprint = 'uShape';
uTunnel.width = 11.2;
uTunnel.depth = 7.2;
uTunnel.tunnelEnabled = true;
uTunnel.tunnelAxis = 'depth';
uTunnel.tunnelOffset = -4.0;
uTunnel.tunnelWidth = 1.45;
validate('u-shape-tunnel', uTunnel);

const uBelowTunnel = cloneSettings(DEFAULT_SETTINGS);
uBelowTunnel.profile = 'belowFloor';
uBelowTunnel.footprint = 'uShape';
uBelowTunnel.width = 11.2;
uBelowTunnel.depth = 7.2;
uBelowTunnel.tunnelEnabled = true;
uBelowTunnel.tunnelAxis = 'depth';
uBelowTunnel.tunnelOffset = 4.0;
uBelowTunnel.tunnelWidth = 1.45;
validate('u-shape-below-floor-tunnel', uBelowTunnel);

const largeTerrain = cloneSettings(DEFAULT_SETTINGS);
largeTerrain.width = 28;
largeTerrain.depth = 16;
largeTerrain.groundIrregularity = 0.24;
largeTerrain.groundMoundSize = 3.4;
largeTerrain.groundMoundCount = 7;
largeTerrain.groundTerrainDetail = 3;
validate('large-tank-deformed-ground', largeTerrain);

const lMixedCorners = cloneSettings(DEFAULT_SETTINGS);
lMixedCorners.footprint = 'lShape';
lMixedCorners.shapeCornerModes = {
  ...lMixedCorners.shapeCornerModes,
  lBackLeft: 'square',
  lBackRight: 'chamfer',
  lOuterRight: 'rounded',
  lInnerElbow: 'rounded',
  lFrontRight: 'chamfer',
  lFrontLeft: 'rounded',
};
lMixedCorners.shapeCornerRadii = {
  ...lMixedCorners.shapeCornerRadii,
  lBackRight: 0.42,
  lOuterRight: 0.78,
  lInnerElbow: 0.62,
  lFrontRight: 0.3,
  lFrontLeft: 0.65,
};
validate('l-shape-independent-corners', lMixedCorners);

const uMixedCorners = cloneSettings(DEFAULT_SETTINGS);
uMixedCorners.footprint = 'uShape';
uMixedCorners.shapeCornerModes = {
  ...uMixedCorners.shapeCornerModes,
  uBackLeft: 'rounded',
  uBackRight: 'square',
  uFrontRight: 'chamfer',
  uMouthRight: 'rounded',
  uInnerRight: 'rounded',
  uInnerLeft: 'chamfer',
  uMouthLeft: 'square',
  uFrontLeft: 'rounded',
};
uMixedCorners.shapeCornerRadii = {
  ...uMixedCorners.shapeCornerRadii,
  uBackLeft: 0.58,
  uFrontRight: 0.34,
  uMouthRight: 0.26,
  uInnerRight: 0.54,
  uInnerLeft: 0.4,
  uFrontLeft: 0.7,
};
validate('u-shape-independent-corners', uMixedCorners);


const lElbow = cloneSettings(DEFAULT_SETTINGS);
lElbow.footprint = 'lShape';
lElbow.lVerticalArmWidth = 3.4;
lElbow.lVerticalArmLength = 8.2;
lElbow.lHorizontalArmWidth = 3.0;
lElbow.lHorizontalArmLength = 11.4;
const lElbowPassage = createPassage(lElbow, 'tunnel', 'elbow');
lElbowPassage.entrySide = 'front';
lElbowPassage.exitSide = 'right';
lElbowPassage.entryOffset = -4.0;
lElbowPassage.exitOffset = -2.6;
lElbowPassage.width = 1.35;
lElbow.passages = [lElbowPassage];
validate('l-shape-elbow-tunnel', lElbow);

const belowLElbow = cloneSettings(lElbow);
belowLElbow.profile = 'belowFloor';
belowLElbow.depthBelowFloor = 4.2;
belowLElbow.heightAboveFloor = 1.3;
belowLElbow.passages = belowLElbow.passages.map((passage) => ({ ...passage, glassFloor: true }));
validate('l-shape-below-floor-elbow-bridge', belowLElbow);

const uMulti = cloneSettings(DEFAULT_SETTINGS);
uMulti.footprint = 'uShape';
uMulti.uBridgeLength = 12.6;
uMulti.uBridgeDepth = 2.6;
uMulti.uLeftArmWidth = 2.6;
uMulti.uRightArmWidth = 3.2;
uMulti.uLeftArmLength = 8.8;
uMulti.uRightArmLength = 6.9;
const uLeftPassage = createPassage(uMulti, 'tunnel', 'straight', 1);
uLeftPassage.name = 'Left arm tunnel';
uLeftPassage.entrySide = 'front';
uLeftPassage.exitSide = 'back';
uLeftPassage.entryOffset = -5.0;
uLeftPassage.width = 1.05;
const uRightPassage = createPassage(uMulti, 'tunnel', 'straight', 2);
uRightPassage.name = 'Right arm tunnel';
uRightPassage.entrySide = 'front';
uRightPassage.exitSide = 'back';
uRightPassage.entryOffset = 4.7;
uRightPassage.width = 1.25;
const uBridgePassage = createPassage(uMulti, 'tunnel', 'straight', 3);
uBridgePassage.name = 'Rear cross tunnel';
uBridgePassage.entrySide = 'left';
uBridgePassage.exitSide = 'right';
uBridgePassage.entryOffset = -3.1;
uBridgePassage.width = 1.0;
uMulti.passages = [uLeftPassage, uRightPassage, uBridgePassage];
validate('u-shape-three-passages', uMulti);

const belowMulti = cloneSettings(uMulti);
belowMulti.profile = 'belowFloor';
belowMulti.depthBelowFloor = 4.5;
belowMulti.heightAboveFloor = 1.35;
belowMulti.passages = belowMulti.passages.map((passage) => ({ ...passage, glassFloor: true, separatorSpacing: 0.55 }));
validate('u-shape-below-floor-three-bridges', belowMulti);

const alcove = cloneSettings(DEFAULT_SETTINGS);
alcove.width = 13;
alcove.depth = 8;
const viewingAlcove = createPassage(alcove, 'alcove', 'straight');
viewingAlcove.entrySide = 'front';
viewingAlcove.entryOffset = 2.0;
viewingAlcove.alcoveDepth = 2.8;
viewingAlcove.width = 2.4;
alcove.passages = [viewingAlcove];
validate('viewing-alcove-overhang', alcove);

const crossed = cloneSettings(DEFAULT_SETTINGS);
crossed.width = 14;
crossed.depth = 9;
const northSouth = createPassage(crossed, 'tunnel', 'straight', 1);
northSouth.entrySide = 'front'; northSouth.exitSide = 'back'; northSouth.entryOffset = -2.7; northSouth.width = 1.5;
const eastWest = createPassage(crossed, 'tunnel', 'straight', 2);
eastWest.entrySide = 'left'; eastWest.exitSide = 'right'; eastWest.entryOffset = 2.2; eastWest.width = 1.4;
crossed.passages = [northSouth, eastWest];
validate('two-directions-at-once', crossed);

const decorated = cloneSettings(DEFAULT_SETTINGS);
const arch = createDecorItem('rockArch', 1, -2.2, 0);
arch.seed = 1101;
arch.scaleX = arch.scaleY = arch.scaleZ = 0.72;
const kelp = createDecorItem('kelp', 2, 2.25, 0);
kelp.seed = 2201;
kelp.scaleX = kelp.scaleY = kelp.scaleZ = 0.82;
kelp.density = 9;
const grass = createDecorItem('seagrass', 3, 0.2, 1.35);
grass.seed = 3301;
grass.scaleX = grass.scaleY = grass.scaleZ = 0.8;
grass.density = 12;
decorated.decor = [arch, kelp, grass];
validate('decor-rocks-plants-navigation', decorated);

const densePlants = cloneSettings(DEFAULT_SETTINGS);
const denseKelp = createDecorItem('kelp', 1, -2.5, 0.4); denseKelp.density = 24; denseKelp.scaleX = denseKelp.scaleY = denseKelp.scaleZ = 0.75;
const denseGrass = createDecorItem('seagrass', 2, 0, -1.25); denseGrass.density = 24; denseGrass.scaleX = denseGrass.scaleY = denseGrass.scaleZ = 0.72;
const algaePatch = createDecorItem('algae', 3, 2.4, 0.7); algaePatch.density = 20; algaePatch.scaleX = algaePatch.scaleY = algaePatch.scaleZ = 0.85;
denseKelp.seed = 4401; denseGrass.seed = 5501; algaePatch.seed = 6601;
densePlants.decor = [denseKelp, denseGrass, algaePatch];
validate('decor-dense-procedural-plants', densePlants);

const allDecorFamilies = cloneSettings(DEFAULT_SETTINGS);
allDecorFamilies.width = 22;
allDecorFamilies.depth = 12;
allDecorFamilies.height = 6;
allDecorFamilies.decor = [
  createDecorItem('boulder', 11, -7.5, -2.6),
  createDecorItem('rockCluster', 12, -3.8, 2.5),
  createDecorItem('rockArch', 13, 0, -2.3),
  createDecorItem('rockShelf', 14, 4.1, 2.35),
  createDecorItem('kelp', 15, 7.7, -2.4),
  createDecorItem('seagrass', 16, -6.9, 2.5),
  createDecorItem('algae', 17, 7.4, 2.6),
];
allDecorFamilies.decor.slice(0, 4).forEach((item, index) => { item.y = -0.22 - index * 0.09; });
allDecorFamilies.decor.slice(0, 3).forEach((item) => { item.rockStyle = 'strata'; });
allDecorFamilies.decor.forEach((item, index) => { item.seed = 9001 + index * 997; });
Object.assign(allDecorFamilies.decor[0]!, { scaleX: 1.35, scaleY: 0.72, scaleZ: 0.58 });
Object.assign(allDecorFamilies.decor[2]!, { scaleX: 1.18, scaleY: 0.84, scaleZ: 0.62 });
validate('all-decor-families-detail', allDecorFamilies);

const decorBelowPassage = cloneSettings(DEFAULT_SETTINGS);
decorBelowPassage.profile = 'belowFloor'; decorBelowPassage.tunnelEnabled = true; decorBelowPassage.heightAboveFloor = 1.1; decorBelowPassage.depthBelowFloor = 3.4; decorBelowPassage.tunnelGlassFloor = true;
const separatedArch = createDecorItem('rockArch', 1, 0, 0); separatedArch.autoPlace = false;
decorBelowPassage.decor = [separatedArch];
validate('decor-below-passage-vertical-separation', decorBelowPassage);

for (const [index, kind] of (['boulder', 'rockCluster', 'rockArch', 'rockShelf', 'kelp', 'seagrass', 'algae'] as const).entries()) {
  const item = createDecorItem(kind, index + 1); item.seed = 7001 + index * 997; item.y = 1.25;
  const built = buildDecorItem(item, 2.3); const bounds = new THREE.Box3().setFromObject(built.group);
  const grounded = Math.abs(bounds.min.y - 3.55) < 1e-5 && Math.abs(built.collision.yBottom - 3.55) < 1e-5;
  console.log(JSON.stringify({ label: `decor-grounding-${kind}`, grounded, boundsBottom: bounds.min.y, collisionBottom: built.collision.yBottom }));
  if (!grounded) process.exitCode = 1;
  built.group.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((material) => material.dispose()); } });
}
