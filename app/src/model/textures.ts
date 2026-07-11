import * as THREE from 'three';
import type { GroundPreset, WaterSurfacePreset } from './settings';

function hash2(x: number, y: number, seed: number): number {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothStep(x - x0);
  const ty = smoothStep(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  const ab = a + (b - a) * tx;
  const cd = c + (d - c) * tx;
  return ab + (cd - ab) * ty;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  let normalizer = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise(x * frequency, y * frequency, seed + octave * 1013) * amplitude;
    normalizer += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return total / normalizer;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized.length === 3
    ? normalized.split('').map((character) => character + character).join('')
    : normalized, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function makeTexture(canvas: HTMLCanvasElement, color = true, pixelated = false): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = pixelated ? THREE.NearestFilter : THREE.LinearFilter;
  texture.minFilter = pixelated ? THREE.NearestMipmapNearestFilter : THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function createGroundTexture(
  preset: GroundPreset,
  color: string,
  variation: number,
  grain: number,
  seed: number,
  width = 512,
  height = 256,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D is unavailable.');

  const image = context.createImageData(width, height);
  const [baseR, baseG, baseB] = hexToRgb(color);
  const broadScale = 2.4 + grain * 2.2;
  const fineScale = 18 + grain * 34;

  const pebbleSample = (u: number, v: number): number => {
    const scale = 16 + grain * 10;
    const gx = u * scale;
    const gy = v * scale;
    const cellX = Math.floor(gx);
    const cellY = Math.floor(gy);
    let nearest = 10;
    let shade = 0;
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const px = cellX + ox + 0.18 + hash2(cellX + ox, cellY + oy, seed + 7103) * 0.64;
        const py = cellY + oy + 0.18 + hash2(cellX + ox, cellY + oy, seed + 9011) * 0.64;
        const distance = Math.hypot(gx - px, gy - py);
        if (distance < nearest) {
          nearest = distance;
          shade = hash2(cellX + ox, cellY + oy, seed + 3301) - 0.5;
        }
      }
    }
    const pebble = Math.max(0, 1 - nearest * 1.8);
    return pebble * (0.72 + shade * 0.52) - (1 - pebble) * 0.18;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const v = y / height;
      const broad = fbm(u * broadScale, v * broadScale, seed, 4) - 0.5;
      const fine = fbm(u * fineScale, v * fineScale, seed + 4409, 3) - 0.5;
      const point = hash2(x, y, seed + 971);
      let deltaR = 0;
      let deltaG = 0;
      let deltaB = 0;

      if (preset === 'dirt') {
        const clump = fbm(u * (6 + grain * 2), v * (6 + grain * 2), seed + 707, 4) - 0.5;
        const darkSpeck = point > 0.977 ? -32 : 0;
        deltaR = variation * (broad * 50 + fine * 22 + clump * 28 + darkSpeck);
        deltaG = variation * (broad * 39 + fine * 17 + clump * 18 + darkSpeck * 0.8);
        deltaB = variation * (broad * 27 + fine * 12 + clump * 10 + darkSpeck * 0.58);
      } else if (preset === 'algae') {
        const patch = fbm(u * (3.2 + grain * 1.8), v * (3.2 + grain * 1.8), seed + 1811, 5) - 0.46;
        const filament = Math.sin((u * 1.7 + v * 0.8 + broad * 0.22) * Math.PI * 8) * 0.5;
        const brownSpot = point > 0.989 ? -22 : 0;
        deltaR = variation * (broad * 27 + fine * 10 + patch * 18 + brownSpot);
        deltaG = variation * (broad * 48 + fine * 16 + patch * 55 + filament * 9 + brownSpot * 0.55);
        deltaB = variation * (broad * 20 + fine * 9 + patch * 13 + brownSpot * 0.35);
      } else if (preset === 'gravel') {
        const pebble = pebbleSample(u, v);
        const speck = point > 0.993 ? 26 : 0;
        deltaR = variation * (pebble * 72 + broad * 18 + speck);
        deltaG = variation * (pebble * 68 + broad * 17 + speck * 0.9);
        deltaB = variation * (pebble * 62 + broad * 16 + speck * 0.78);
      } else {
        const speck = point > 0.985 ? -0.65 : 0;
        const delta = variation * (broad * 46 + fine * 19 + speck * 28);
        const warmShift = variation * broad * 8;
        deltaR = delta + warmShift;
        deltaG = delta * 0.88 + warmShift * 0.4;
        deltaB = delta * 0.62 - warmShift * 0.2;
      }

      const index = (y * width + x) * 4;
      image.data[index] = clampByte(baseR + deltaR);
      image.data[index + 1] = clampByte(baseG + deltaG);
      image.data[index + 2] = clampByte(baseB + deltaB);
      image.data[index + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return makeTexture(canvas, true);
}

export interface WaterTextures {
  color: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
}

/**
 * Build one non-repeating surface texture that can move continuously from
 * physically restrained water to broad, graphic, cartoon-like bands.
 */
export function createWaterTextures(
  color: string,
  strength: number,
  seed: number,
  style = 0.25,
  waveScale = 0.5,
  preset: WaterSurfacePreset = 'balanced',
  width = 512,
  height = 256,
): WaterTextures {
  const heightField = new Float32Array(width * height);
  const [baseR, baseG, baseB] = hexToRgb(color);
  const presetFrequency = preset === 'calm' ? 0.68 : preset === 'pixel' ? 1.18 : preset === 'cartoon' ? 0.9 : 1;
  const frequency = (0.65 + waveScale * 2.15) * presetFrequency;
  const pixelBlock = preset === 'pixel' ? Math.max(4, Math.round(13 - waveScale * 7)) : 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sampledX = preset === 'pixel' ? Math.floor(x / pixelBlock) * pixelBlock : x;
      const sampledY = preset === 'pixel' ? Math.floor(y / pixelBlock) * pixelBlock : y;
      const u = sampledX / Math.max(1, width - 1);
      const v = sampledY / Math.max(1, height - 1);
      const broad =
        Math.sin(Math.PI * 2 * frequency * (0.84 * u + 0.43 * v + 0.07 * u * v) + 0.35) * 0.46 +
        Math.sin(Math.PI * 2 * frequency * (0.31 * u - 0.92 * v + 0.06 * u * u) + 2.0) * 0.30 +
        Math.sin(Math.PI * 2 * frequency * (1.42 * u + 0.28 * v) + 4.1) * 0.16;
      const realistic =
        Math.sin(Math.PI * 2 * (1.28 * u + 0.67 * v + 0.09 * u * v) + 0.4) * 0.34 +
        Math.sin(Math.PI * 2 * (0.51 * u - 1.61 * v + 0.08 * u * u) + 2.1) * 0.24 +
        (fbm(u * (5.2 + waveScale * 5), v * (5.2 + waveScale * 5), seed, 4) - 0.5) * 0.42;
      const graphic = broad + (fbm(u * (2.4 + waveScale * 1.8), v * (2.4 + waveScale * 1.8), seed + 441, 3) - 0.5) * 0.16;
      let sample = realistic * (1 - style) + graphic * style;
      if (preset === 'calm') sample = sample * 0.42 + broad * 0.08;
      if (preset === 'pixel') sample = Math.round(sample * 7) / 7;
      heightField[y * width + x] = sample;
    }
  }

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = width;
  colorCanvas.height = height;
  const colorContext = colorCanvas.getContext('2d', { alpha: false });
  if (!colorContext) throw new Error('Canvas 2D is unavailable.');
  const colorImage = colorContext.createImageData(width, height);

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const sample of heightField) {
    min = Math.min(min, sample);
    max = Math.max(max, sample);
  }
  const span = Math.max(0.0001, max - min);
  const bandCount = preset === 'pixel' ? 4 : Math.round(5 + style * 3);

  for (let i = 0; i < heightField.length; i += 1) {
    const normalized = (heightField[i]! - min) / span;
    const quantized = Math.round(normalized * bandCount) / bandCount;
    const quantizeWeight = preset === 'pixel' ? 1 : style * 0.72;
    const styled = normalized * (1 - quantizeWeight) + quantized * quantizeWeight;
    const variation = (styled - 0.5) * (12 + style * 38);
    const crest = Math.max(0, styled - (0.70 - style * 0.08)) * style * 38;
    const index = i * 4;
    colorImage.data[index] = clampByte(baseR + variation * 0.42 + crest * 0.45);
    colorImage.data[index + 1] = clampByte(baseG + variation * 0.72 + crest * 0.72);
    colorImage.data[index + 2] = clampByte(baseB + variation + crest);
    colorImage.data[index + 3] = 255;
  }
  colorContext.putImageData(colorImage, 0, 0);

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = width;
  normalCanvas.height = height;
  const normalContext = normalCanvas.getContext('2d', { alpha: false });
  if (!normalContext) throw new Error('Canvas 2D is unavailable.');
  const normalImage = normalContext.createImageData(width, height);
  const normalScale = (2.7 + strength * (11 + style * 5.5)) * (preset === 'calm' ? 0.5 : preset === 'pixel' ? 0.82 : 1);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = heightField[y * width + Math.max(0, x - 1)]!;
      const right = heightField[y * width + Math.min(width - 1, x + 1)]!;
      const down = heightField[Math.max(0, y - 1) * width + x]!;
      const up = heightField[Math.min(height - 1, y + 1) * width + x]!;
      let nx = -(right - left) * normalScale;
      let ny = -(up - down) * normalScale;
      let nz = 1;
      const length = Math.hypot(nx, ny, nz);
      nx /= length;
      ny /= length;
      nz /= length;
      const index = (y * width + x) * 4;
      normalImage.data[index] = clampByte((nx * 0.5 + 0.5) * 255);
      normalImage.data[index + 1] = clampByte((ny * 0.5 + 0.5) * 255);
      normalImage.data[index + 2] = clampByte((nz * 0.5 + 0.5) * 255);
      normalImage.data[index + 3] = 255;
    }
  }
  normalContext.putImageData(normalImage, 0, 0);

  return {
    color: makeTexture(colorCanvas, true, preset === 'pixel'),
    normal: makeTexture(normalCanvas, false, preset === 'pixel'),
  };
}
