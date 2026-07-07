import * as THREE from 'three';

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

function makeTexture(canvas: HTMLCanvasElement, color = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function createSandTexture(
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

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const v = y / height;
      const broad = fbm(u * broadScale, v * broadScale, seed, 4) - 0.5;
      const fine = fbm(u * fineScale, v * fineScale, seed + 4409, 3) - 0.5;
      const speck = hash2(x, y, seed + 971) > 0.985 ? -0.65 : 0;
      const delta = variation * (broad * 46 + fine * 19 + speck * 28);
      const warmShift = variation * broad * 8;
      const index = (y * width + x) * 4;
      image.data[index] = clampByte(baseR + delta + warmShift);
      image.data[index + 1] = clampByte(baseG + delta * 0.88 + warmShift * 0.4);
      image.data[index + 2] = clampByte(baseB + delta * 0.62 - warmShift * 0.2);
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

export function createWaterTextures(
  color: string,
  strength: number,
  seed: number,
  width = 512,
  height = 256,
): WaterTextures {
  const heightField = new Float32Array(width * height);
  const [baseR, baseG, baseB] = hexToRgb(color);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / Math.max(1, width - 1);
      const v = y / Math.max(1, height - 1);
      const ripples =
        Math.sin(Math.PI * 2 * (1.28 * u + 0.67 * v + 0.09 * u * v) + 0.4) * 0.42 +
        Math.sin(Math.PI * 2 * (0.51 * u - 1.61 * v + 0.08 * u * u) + 2.1) * 0.29 +
        Math.sin(Math.PI * 2 * (2.08 * u + 0.37 * v) + 4.2) * 0.16;
      const organic = (fbm(u * 5.2, v * 5.2, seed, 4) - 0.5) * 0.34;
      heightField[y * width + x] = ripples + organic;
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

  for (let i = 0; i < heightField.length; i += 1) {
    const normalized = (heightField[i]! - min) / span;
    const variation = (normalized - 0.5) * 24;
    const index = i * 4;
    colorImage.data[index] = clampByte(baseR + variation * 0.55);
    colorImage.data[index + 1] = clampByte(baseG + variation * 0.8);
    colorImage.data[index + 2] = clampByte(baseB + variation);
    colorImage.data[index + 3] = 255;
  }
  colorContext.putImageData(colorImage, 0, 0);

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = width;
  normalCanvas.height = height;
  const normalContext = normalCanvas.getContext('2d', { alpha: false });
  if (!normalContext) throw new Error('Canvas 2D is unavailable.');
  const normalImage = normalContext.createImageData(width, height);
  const normalScale = 3.2 + strength * 13;

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
    color: makeTexture(colorCanvas, true),
    normal: makeTexture(normalCanvas, false),
  };
}
