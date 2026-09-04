import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const makerRoot = resolve(scriptDirectory, '../..');
const resortRoot = resolve(makerRoot, '../pokemon-resort');
const outputDirectory = join(makerRoot, 'app/src/generated');
const emscriptenCache = join(makerRoot, '.cache/emscripten');
const kernelTypesPath = join(
  resortRoot, 'shared/aquarium_geometry/include/aquarium_geometry/Types.hpp');

mkdirSync(outputDirectory, { recursive: true });
mkdirSync(emscriptenCache, { recursive: true });

execFileSync('em++', [
  '-std=c++17',
  '-O2',
  '-I', join(resortRoot, 'shared/aquarium_geometry/include'),
  '-I', join(resortRoot, 'include'),
  '-I', join(resortRoot, 'tools/aquarium_geometry_wasm'),
  join(resortRoot, 'shared/aquarium_geometry/src/CellRegions.cpp'),
  join(resortRoot, 'shared/aquarium_geometry/src/Footprint.cpp'),
  join(resortRoot, 'shared/aquarium_geometry/src/GeometryBuilder.cpp'),
  join(resortRoot, 'shared/aquarium_geometry/src/Kernel.cpp'),
  join(resortRoot, 'shared/aquarium_geometry/src/Tunnel.cpp'),
  join(resortRoot, 'shared/aquarium_geometry/src/TunnelFloorGeometry.cpp'),
  join(resortRoot, 'shared/aquarium_geometry/src/TunnelGeometry.cpp'),
  join(resortRoot, 'src/core/config/Json.cpp'),
  join(resortRoot, 'src/gameplay/world3d/aquarium/construction/AquariumDesign.cpp'),
  join(resortRoot, 'tools/aquarium_geometry_wasm/AquariumGeometryJsonAdapter.cpp'),
  join(resortRoot, 'tools/aquarium_geometry_wasm/WasmBindings.cpp'),
  '--bind',
  '-sMODULARIZE=1',
  '-sEXPORT_ES6=1',
  '-sENVIRONMENT=web',
  '-sFILESYSTEM=0',
  '-sSINGLE_FILE=1',
  '-o', join(outputDirectory, 'aquarium_geometry.mjs'),
], {
  cwd: makerRoot,
  env: { ...process.env, EM_CACHE: emscriptenCache },
  stdio: 'inherit',
});

const kernelTypes = readFileSync(kernelTypesPath, 'utf8');
const abiMatch = kernelTypes.match(/kKernelAbiVersion\s*=\s*(\d+)/);
if (!abiMatch) {
  throw new Error(`Could not read the aquarium kernel ABI from ${kernelTypesPath}`);
}
console.log(`Aquarium geometry browser WASM generated from Resort kernel ABI ${abiMatch[1]}.`);
