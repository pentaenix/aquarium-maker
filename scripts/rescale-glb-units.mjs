#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function usage() {
  throw new Error('Usage: node scripts/rescale-glb-units.mjs MODEL.glb FROM_UNITS_PER_METRE TO_UNITS_PER_METRE');
}

function chunksOf(buffer) {
  const chunks = [];
  for (let offset = 12; offset < buffer.length;) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    chunks.push({ type, data: Buffer.from(buffer.subarray(start, start + length)) });
    offset = start + length;
  }
  return chunks;
}

function pad4(buffer, fill) {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding, fill)]) : buffer;
}

function scaleAccessor(gltf, bin, accessorIndex, factor) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor || accessor.componentType !== 5126 || accessor.type !== 'VEC3' || accessor.sparse) {
    throw new Error(`POSITION accessor ${accessorIndex} is not a dense FLOAT VEC3`);
  }
  const view = gltf.bufferViews?.[accessor.bufferView];
  if (!view || (view.buffer ?? 0) !== 0) throw new Error(`POSITION accessor ${accessorIndex} is not in GLB buffer 0`);
  const stride = view.byteStride ?? 12;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  for (let vertex = 0; vertex < accessor.count; vertex += 1) {
    const offset = start + vertex * stride;
    for (let axis = 0; axis < 3; axis += 1) {
      bin.writeFloatLE(bin.readFloatLE(offset + axis * 4) * factor, offset + axis * 4);
    }
  }
  if (Array.isArray(accessor.min)) accessor.min = accessor.min.map((value) => value * factor);
  if (Array.isArray(accessor.max)) accessor.max = accessor.max.map((value) => value * factor);
}

function updateUnitsMetadata(value, fromUnits, toUnits) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'exportUnitsPerMeter' || key === 'outputUnitsPerMeter') &&
        typeof child === 'number' && Math.abs(child - fromUnits) < 1e-6) {
      value[key] = toUnits;
    } else {
      updateUnitsMetadata(child, fromUnits, toUnits);
    }
  }
}

async function main() {
  const [path, fromText, toText, extra] = process.argv.slice(2);
  if (!path || !fromText || !toText || extra) usage();
  const fromUnits = Number(fromText);
  const toUnits = Number(toText);
  if (!(fromUnits > 0) || !(toUnits > 0)) usage();
  const factor = toUnits / fromUnits;

  const source = await readFile(path);
  if (source.readUInt32LE(0) !== GLB_MAGIC || source.readUInt32LE(4) !== 2) {
    throw new Error(`${path} is not a GLB 2.0 file`);
  }
  const chunks = chunksOf(source);
  const jsonChunk = chunks.find((chunk) => chunk.type === JSON_CHUNK);
  const binChunk = chunks.find((chunk) => chunk.type === BIN_CHUNK);
  if (!jsonChunk || !binChunk) throw new Error(`${path} must contain JSON and BIN chunks`);
  const gltf = JSON.parse(jsonChunk.data.toString('utf8').replace(/\0/g, '').trim());
  if ((gltf.skins?.length ?? 0) > 0) throw new Error('Skinned GLBs require inverse-bind scaling and are not supported by this migration');

  const positionAccessors = new Set();
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.attributes?.POSITION !== undefined) positionAccessors.add(primitive.attributes.POSITION);
      for (const target of primitive.targets ?? []) {
        if (target.POSITION !== undefined) positionAccessors.add(target.POSITION);
      }
    }
  }
  for (const animation of gltf.animations ?? []) {
    for (const channel of animation.channels ?? []) {
      if (channel.target?.path !== 'translation') continue;
      const sampler = animation.samplers?.[channel.sampler];
      if (sampler?.output !== undefined) positionAccessors.add(sampler.output);
    }
  }
  for (const accessor of positionAccessors) scaleAccessor(gltf, binChunk.data, accessor, factor);

  for (const node of gltf.nodes ?? []) {
    if (Array.isArray(node.translation)) node.translation = node.translation.map((value) => value * factor);
    if (Array.isArray(node.matrix) && node.matrix.length === 16) {
      node.matrix[12] *= factor;
      node.matrix[13] *= factor;
      node.matrix[14] *= factor;
    }
  }
  for (const material of gltf.materials ?? []) {
    const volume = material.extensions?.KHR_materials_volume;
    if (typeof volume?.attenuationDistance === 'number' && Number.isFinite(volume.attenuationDistance)) {
      volume.attenuationDistance *= factor;
    }
  }
  updateUnitsMetadata(gltf, fromUnits, toUnits);

  const encodedJson = pad4(Buffer.from(JSON.stringify(gltf)), 0x20);
  const encodedChunks = [
    { type: JSON_CHUNK, data: encodedJson },
    ...chunks.filter((chunk) => chunk.type !== JSON_CHUNK),
  ];
  const totalLength = 12 + encodedChunks.reduce((sum, chunk) => sum + 8 + chunk.data.length, 0);
  const output = Buffer.alloc(totalLength);
  output.writeUInt32LE(GLB_MAGIC, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  let offset = 12;
  for (const chunk of encodedChunks) {
    output.writeUInt32LE(chunk.data.length, offset);
    output.writeUInt32LE(chunk.type, offset + 4);
    chunk.data.copy(output, offset + 8);
    offset += 8 + chunk.data.length;
  }
  await writeFile(path, output);
  console.log(`${path}: ${fromUnits} -> ${toUnits} units/metre (${positionAccessors.size} position accessors)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
