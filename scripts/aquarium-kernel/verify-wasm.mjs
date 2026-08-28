import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const makerRoot = resolve(scriptDirectory, "../..");
const resortRoot = resolve(makerRoot, "../pokemon-resort");
const outputDirectory = join(makerRoot, ".cache/aquarium-kernel");
const emscriptenCache = join(makerRoot, ".cache/emscripten");
const modulePath = join(outputDirectory, "aquarium_geometry.mjs");
const goldenPath = join(
  resortRoot,
  "shared/aquarium_geometry/goldens/rectangle-even.aquarium.json",
);
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
  join(resortRoot, "shared/aquarium_geometry/src/Kernel.cpp"),
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

const designJson = readFileSync(goldenPath, "utf8");
const nativeJson = execFileSync(nativeDump, [goldenPath], { encoding: "utf8" }).trim();
const createKernelModule = (await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`)).default;
const kernelModule = await createKernelModule();
const wasmJson = kernelModule.buildAquariumDocument(designJson);

const nativeResult = JSON.parse(nativeJson);
const wasmResult = JSON.parse(wasmJson);
assert.deepStrictEqual(wasmResult, nativeResult, "native and WASM kernel output diverged");
assert.equal(wasmResult.kernelAbiVersion, 1);
assert.equal(wasmResult.designSchemaVersion, 1);
assert.equal(wasmResult.contentHash, "fnv1a64:5f18ef72142032cb");
assert.equal(wasmResult.statistics.vertexCount, 296);
assert.equal(wasmResult.statistics.collisionCellCount, 16);

for (let index = 0; index < 20; index += 1) {
  kernelModule.buildAquariumDocument(designJson);
}
const timings = [];
for (let index = 0; index < 200; index += 1) {
  const start = performance.now();
  kernelModule.buildAquariumDocument(designJson);
  timings.push(performance.now() - start);
}
timings.sort((left, right) => left - right);
const p95 = timings[Math.floor((timings.length - 1) * 0.95)];

console.log(
  `aquarium kernel parity: ok (${wasmResult.contentHash}, ` +
    `${wasmResult.statistics.vertexCount} vertices, ${wasmResult.statistics.triangleCount} triangles)`,
);
console.log(`aquarium kernel wasm adapter: samples=${timings.length} p95_ms=${p95.toFixed(4)}`);
