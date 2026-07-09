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
  const names: string[] = [];
  build.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    names.push(object.name);
    const position = object.geometry.getAttribute('position');
    for (let index = 0; index < position.count; index += 1) {
      if (![position.getX(index), position.getY(index), position.getZ(index)].every(Number.isFinite)) invalid += 1;
    }
    const indices = object.geometry.index;
    if (indices) {
      for (let index = 0; index < indices.count; index += 1) if (indices.getX(index) >= position.count) invalid += 1;
    }
  });
  console.log(JSON.stringify({ label, meshes, triangles: build.triangles, vertices: build.vertices, invalid, size: box.getSize(new THREE.Vector3()).toArray(), names }, null, 2));
  if (invalid) process.exitCode = 1;
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
