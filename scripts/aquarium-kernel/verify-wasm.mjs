import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const makerRoot = resolve(scriptDirectory, "../..");
const resortRoot = resolve(makerRoot, "../pokemon-resort");
const outputDirectory = join(makerRoot, ".cache/aquarium-kernel");
const emscriptenCache = join(makerRoot, ".cache/emscripten");
const modulePath = join(outputDirectory, "aquarium_geometry.mjs");
const goldenDirectory = join(resortRoot, "shared/aquarium_geometry/goldens");
const nativeDump = join(resortRoot, "build/aquarium_geometry_golden_dump");

mkdirSync(outputDirectory, { recursive: true });
mkdirSync(emscriptenCache, { recursive: true });

execFileSync("cmake", ["--build", join(resortRoot, "build"), "--target", "aquarium_geometry_golden_dump", "-j4"], {
  cwd: resortRoot,
  stdio: "inherit",
});

const includeArguments = [
  "-I", join(resortRoot, "shared/aquarium_geometry/include"),
  "-I", join(resortRoot, "include"),
  "-I", join(resortRoot, "tools/aquarium_geometry_wasm"),
];
const sourceArguments = [
  join(resortRoot, "shared/aquarium_geometry/src/CellRegions.cpp"),
  join(resortRoot, "shared/aquarium_geometry/src/Footprint.cpp"),
  join(resortRoot, "shared/aquarium_geometry/src/GeometryBuilder.cpp"),
  join(resortRoot, "shared/aquarium_geometry/src/Kernel.cpp"),
  join(resortRoot, "shared/aquarium_geometry/src/Tunnel.cpp"),
  join(resortRoot, "shared/aquarium_geometry/src/TunnelGeometry.cpp"),
  join(resortRoot, "src/core/config/Json.cpp"),
  join(resortRoot, "src/gameplay/world3d/aquarium/construction/AquariumDesign.cpp"),
  join(resortRoot, "tools/aquarium_geometry_wasm/AquariumGeometryJsonAdapter.cpp"),
  join(resortRoot, "tools/aquarium_geometry_wasm/WasmBindings.cpp"),
];

execFileSync("em++", [
  "-std=c++17",
  "-O2",
  ...includeArguments,
  ...sourceArguments,
  "--bind",
  "-sMODULARIZE=1",
  "-sEXPORT_ES6=1",
  "-sENVIRONMENT=node",
  "-sFILESYSTEM=0",
  "-o", modulePath,
], {
  cwd: makerRoot,
  env: { ...process.env, EM_CACHE: emscriptenCache },
  stdio: "inherit",
});

const createKernelModule = (await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`)).default;
const kernelModule = await createKernelModule();
const goldenFiles = readdirSync(goldenDirectory)
  .filter((name) => name.endsWith(".aquarium.json"))
  .sort();
const results = [];
for (const name of goldenFiles) {
  const goldenPath = join(goldenDirectory, name);
  const designJson = readFileSync(goldenPath, "utf8");
  const nativeResult = JSON.parse(execFileSync(nativeDump, [goldenPath], { encoding: "utf8" }).trim());
  const wasmResult = JSON.parse(kernelModule.buildAquariumDocument(designJson));
  assert.deepStrictEqual(wasmResult, nativeResult, `native and WASM diverged for ${name}`);
  assert.equal(wasmResult.kernelAbiVersion, 12);
  assert.equal(wasmResult.designSchemaVersion, 5);
  assert.equal(wasmResult.valid, true);
  results.push({ name, designJson, result: wasmResult });
}

const rectangle = results.find(({ name }) => name === "rectangle-even.aquarium.json");
assert.ok(rectangle);
assert.equal(rectangle.result.contentHash, "fnv1a64:980d524c41647655");
assert.equal(rectangle.result.statistics.vertexCount, 188);
assert.equal(rectangle.result.statistics.collisionCellCount, 24);

const belowFloorTunnel = results.find(
  ({ name }) => name === "rectangle-tunnel-below-floor.aquarium.json",
);
assert.ok(belowFloorTunnel);
assert.ok(
  belowFloorTunnel.result.meshes.some(({ material }) => material === "tunnel-frame"),
  "below-floor tunnel is missing its opaque floor scaffold",
);

for (let index = 0; index < 20; index += 1) {
  kernelModule.buildAquariumDocument(rectangle.designJson);
}
const timings = [];
for (let index = 0; index < 200; index += 1) {
  const start = performance.now();
  kernelModule.buildAquariumDocument(rectangle.designJson);
  timings.push(performance.now() - start);
}
timings.sort((left, right) => left - right);
const p95 = timings[Math.floor((timings.length - 1) * 0.95)];

console.log(
  `aquarium kernel parity: ok (${results.length} goldens, ABI ${rectangle.result.kernelAbiVersion}, ` +
    `${rectangle.result.contentHash})`,
);
console.log(`aquarium kernel wasm adapter: samples=${timings.length} p95_ms=${p95.toFixed(4)}`);
