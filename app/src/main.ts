import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildAquarium, exportAquariumGLB, type AquariumBuild } from './model/aquarium';
import { cloneSettings, DEFAULT_SETTINGS, normalizeSettings, type AquariumSettings } from './model/settings';
import { ControlPanel } from './ui/panel';

const STORAGE_KEY = 'aquarium-maker-settings-v6-composable';

type CameraView = 'iso' | 'front' | 'side' | 'top' | 'fit';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>('#viewer');
const viewport = requireElement<HTMLElement>('.viewport');
const controlRoot = requireElement<HTMLElement>('#control-panel');
const viewerError = requireElement<HTMLElement>('#viewer-error');
const toast = requireElement<HTMLElement>('#toast');
const scaleBadge = requireElement<HTMLElement>('#scale-badge');

function decodeConfiguration(encoded: string): Partial<AquariumSettings> {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Partial<AquariumSettings>;
}

function encodeConfiguration(value: AquariumSettings): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function mergeSettings(partial: Partial<AquariumSettings>): AquariumSettings {
  return normalizeSettings({
    ...cloneSettings(DEFAULT_SETTINGS),
    ...partial,
    radii: { ...DEFAULT_SETTINGS.radii, ...partial.radii },
    cornerModes: { ...DEFAULT_SETTINGS.cornerModes, ...partial.cornerModes },
  });
}

function loadSettings(): AquariumSettings {
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const encoded = hash.get('config');
    if (encoded) return mergeSettings(decodeConfiguration(encoded));
  } catch {
    // A malformed shared link should never prevent the editor from opening.
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? mergeSettings(JSON.parse(stored) as Partial<AquariumSettings>) : cloneSettings(DEFAULT_SETTINGS);
  } catch {
    // Storage may be blocked for local files, private windows, or hardened browsers.
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

let settings = loadSettings();

function saveSettings(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Persistence is optional. The editor and exporter remain fully functional.
  }
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

function showViewerFailure(message: string): void {
  viewerError.hidden = false;
  const detail = viewerError.querySelector<HTMLElement>('span');
  if (detail) detail.textContent = message;
  canvas.classList.add('is-unavailable');
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 500);
camera.position.set(12, 8, 12);

let renderer: THREE.WebGLRenderer | null = null;
let controls: OrbitControls | null = null;
let environment: THREE.Texture | null = null;

try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.07;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 1;
  controls.maxDistance = 120;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.set(0, settings.height * 0.42, 0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  pmrem.dispose();
} catch (error) {
  console.error('WebGL initialization failed:', error);
  showViewerFailure('WebGL could not start. You can still adjust settings and download the GLB.');
}

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  showViewerFailure('The WebGL context was lost. Reload the page to restore the preview.');
});

const hemisphere = new THREE.HemisphereLight(0xffffff, 0x8aa0aa, 1.2);
scene.add(hemisphere);

const keyLight = new THREE.DirectionalLight(0xffffff, 3.3);
keyLight.position.set(-7, 11, -8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.1;
keyLight.shadow.camera.far = 55;
keyLight.shadow.bias = -0.00008;
scene.add(keyLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: 0xe9eef0, roughness: 1, metalness: 0, transparent: true, opacity: 0.28, depthWrite: false }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.003;
ground.receiveShadow = true;
scene.add(ground);

let currentBuild: AquariumBuild | null = null;
let modelGroup: THREE.Group | null = null;
let rebuildTimer = 0;
let firstBuild = true;
let cameraAnimationToken = 0;

function updateStats(): void {
  const visibleHeight = settings.profile === 'belowFloor'
    ? settings.heightAboveFloor + settings.depthBelowFloor
    : settings.height;
  const profileLabel = settings.profile === 'belowFloor' ? 'below floor' : settings.profile === 'touchPool' ? 'touch pool' : 'standard';
  requireElement<HTMLElement>('#dimension-stat').textContent =
    `${settings.width.toFixed(1)} × ${settings.depth.toFixed(1)} × ${visibleHeight.toFixed(1)} m · ${profileLabel}`;
  requireElement<HTMLElement>('#triangle-stat').textContent =
    `${currentBuild?.triangles.toLocaleString() ?? '—'} triangles`;
  scaleBadge.textContent = `Preview in meters · export ${Math.round(settings.exportScale)}×`;
}

function rebuildNow(autoFrame = false): void {
  try {
    const nextBuild = buildAquarium(settings);
    if (currentBuild) {
      scene.remove(currentBuild.group);
      currentBuild.dispose();
    }
    currentBuild = nextBuild;
    modelGroup = nextBuild.group;
    scene.add(nextBuild.group);
    updateStats();
    saveSettings();

    if (firstBuild || autoFrame) {
      setCameraView('iso');
      firstBuild = false;
    }
  } catch (error) {
    console.error('Could not rebuild aquarium:', error);
    showToast('Those settings could not be applied');
  }
}

function scheduleRebuild(structural: boolean): void {
  window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => rebuildNow(false), structural ? 55 : 85);
}

function fitDistance(direction: THREE.Vector3): { position: THREE.Vector3; target: THREE.Vector3 } {
  if (!modelGroup) {
    return { position: new THREE.Vector3(12, 8, 12), target: new THREE.Vector3(0, 2, 0) };
  }

  const box = new THREE.Box3().setFromObject(modelGroup);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const verticalFit = size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const horizontalFit = size.x / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.max(camera.aspect, 0.25));
  const depthFit = size.z * 0.78;
  const distance = Math.max(verticalFit, horizontalFit, depthFit) * 1.25;
  return {
    position: center.clone().add(direction.clone().normalize().multiplyScalar(distance)),
    target: center,
  };
}

function animateCamera(position: THREE.Vector3, target: THREE.Vector3): void {
  if (!controls) return;
  cameraAnimationToken += 1;
  const token = cameraAnimationToken;
  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const startTime = performance.now();
  const duration = 360;

  function step(time: number): void {
    if (!controls || token !== cameraAnimationToken) return;
    const raw = Math.min(1, (time - startTime) / duration);
    const eased = 1 - Math.pow(1 - raw, 3);
    camera.position.lerpVectors(startPosition, position, eased);
    controls.target.lerpVectors(startTarget, target, eased);
    controls.update();
    if (raw < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

function setCameraView(view: CameraView): void {
  if (!controls) return;
  const directions: Record<CameraView, THREE.Vector3> = {
    iso: new THREE.Vector3(1.25, 0.82, 1.45),
    front: new THREE.Vector3(0, 0.14, 1),
    side: new THREE.Vector3(1, 0.14, 0),
    top: new THREE.Vector3(0.001, 1, 0.001),
    fit: camera.position.clone().sub(controls.target).normalize(),
  };
  const fitted = fitDistance(directions[view]);
  animateCamera(fitted.position, fitted.target);
}

async function shareSettings(): Promise<void> {
  const url = new URL(window.location.href);
  url.hash = `config=${encodeConfiguration(settings)}`;
  try {
    window.history.replaceState(null, '', url);
  } catch {
    // File URLs may not allow history replacement.
  }

  try {
    await navigator.clipboard.writeText(url.toString());
    showToast('Share link copied');
  } catch {
    showToast('Settings added to the address bar');
  }
}

function cleanFileName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/\.glb$/i, '')
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'aquarium';
}

async function downloadModel(): Promise<void> {
  if (!modelGroup) {
    showToast('The model is not ready yet');
    return;
  }

  const overlay = requireElement<HTMLElement>('#loading-overlay');
  const button = requireElement<HTMLButtonElement>('#download-button');
  overlay.hidden = false;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');

  try {
    const buffer = await exportAquariumGLB(modelGroup, settings.exportScale);
    const blob = new Blob([buffer], { type: 'model/gltf-binary' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const fileInput = requireElement<HTMLInputElement>('#file-name');
    link.href = objectUrl;
    link.download = `${cleanFileName(fileInput.value)}.glb`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    showToast('GLB downloaded');
  } catch (error) {
    console.error('GLB export failed:', error);
    showToast('Could not export the GLB');
  } finally {
    overlay.hidden = true;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

const panel = new ControlPanel(controlRoot, settings, {
  onChange: (nextSettings, structural) => {
    settings = nextSettings;
    updateStats();
    scheduleRebuild(structural);
  },
  onReset: (nextSettings) => {
    settings = nextSettings;
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      // Harmless when opened directly from disk.
    }
    rebuildNow(true);
  },
  onShare: () => void shareSettings(),
  onDownload: () => void downloadModel(),
  onView: setCameraView,
});

function resize(): void {
  if (!renderer) return;
  const width = Math.max(1, viewport.clientWidth);
  const height = Math.max(1, viewport.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(viewport);
resize();

let hintHidden = false;
controls?.addEventListener('start', () => {
  if (hintHidden) return;
  hintHidden = true;
  document.querySelector('#viewer-hint')?.classList.add('is-hidden');
});

let animationFrame = 0;
function render(): void {
  if (!renderer) return;
  controls?.update();
  renderer.render(scene, camera);
  animationFrame = requestAnimationFrame(render);
}

rebuildNow(true);
panel.setSettings(settings);
render();

// Small non-UI test hook used by the repository's validation workflow.
Object.assign(window as unknown as { __aquariumMaker?: unknown }, {
  __aquariumMaker: {
    getSettings: () => JSON.parse(JSON.stringify(settings)) as AquariumSettings,
    getStats: () => ({ triangles: currentBuild?.triangles ?? 0, vertices: currentBuild?.vertices ?? 0 }),
    exportCurrent: async () => modelGroup ? exportAquariumGLB(modelGroup, settings.exportScale) : null,
  },
});

window.addEventListener('beforeunload', () => {
  window.clearTimeout(rebuildTimer);
  if (animationFrame) cancelAnimationFrame(animationFrame);
  currentBuild?.dispose();
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  environment?.dispose();
  controls?.dispose();
  renderer?.dispose();
});
