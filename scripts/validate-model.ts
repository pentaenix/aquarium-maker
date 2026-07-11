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
const { cloneSettings, DEFAULT_SETTINGS, normalizeSettings } = await import('../app/src/model/settings');

function validate(label: string, settings: ReturnType<typeof cloneSettings>) {
  const build = buildAquarium(normalizeSettings(settings));
  const box = new THREE.Box3().setFromObject(build.group);
  let meshes = 0;
  let invalid = 0;
  let degenerate = 0;
  const names: string[] = [];
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
    const geometry = object.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    for (let index = 0; index < position.count; index += 1) {
      if (![position.getX(index), position.getY(index), position.getZ(index)].every(Number.isFinite)) invalid += 1;
      if (normal && ![normal.getX(index), normal.getY(index), normal.getZ(index)].every(Number.isFinite)) invalid += 1;
    }

    const indices = geometry.index;
    const triangleCount = indices ? Math.floor(indices.count / 3) : Math.floor(position.count / 3);
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
    }
  });
  console.log(JSON.stringify({ label, meshes, triangles: build.triangles, vertices: build.vertices, invalid, degenerate, size: box.getSize(new THREE.Vector3()).toArray(), names }, null, 2));
  if (invalid || degenerate) process.exitCode = 1;
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
