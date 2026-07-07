import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildAquarium, exportAquariumGLB, type AquariumBuild } from './model/aquarium';
import { cloneSettings, DEFAULT_SETTINGS, normalizeSettings, type AquariumSettings } from './model/settings';
import { ControlPanel } from './ui/panel';

const STORAGE_KEY = 'aquarium-studio-settings-v1';
const canvas = document.querySelector<HTMLCanvasElement>('#viewer');
const viewportElement = document.querySelector<HTMLElement>('.viewport');
const controlRootElement = document.querySelector<HTMLElement>('#control-panel');
if (!canvas || !viewportElement || !controlRootElement) throw new Error('Application shell is incomplete.');
const viewport = viewportElement;
const controlRoot = controlRootElement;

function loadSettings(): AquariumSettings {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const encoded = hash.get('config');
  if (encoded) {
    try {
      const json = decodeURIComponent(escape(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))));
      const parsed = JSON.parse(json) as Partial<AquariumSettings>;
      return normalizeSettings({
        ...cloneSettings(DEFAULT_SETTINGS),
        ...parsed,
        radii: { ...DEFAULT_SETTINGS.radii, ...parsed.radii },
      });
    } catch {
      // Fall through to local settings.
    }
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return cloneSettings(DEFAULT_SETTINGS);
    const parsed = JSON.parse(stored) as Partial<AquariumSettings>;
    return normalizeSettings({
      ...cloneSettings(DEFAULT_SETTINGS),
      ...parsed,
      radii: { ...DEFAULT_SETTINGS.radii, ...parsed.radii },
    });
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

let settings = loadSettings();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.07;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 300);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 1;
controls.maxDistance = 80;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.set(0, settings.height * 0.42, 0);

const pmrem = new THREE.PMREMGenerator(renderer);
const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = environment;
pmrem.dispose();

const hemisphere = new THREE.HemisphereLight(0xffffff, 0x8aa0aa, 1.2);
scene.add(hemisphere);
const keyLight = new THREE.DirectionalLight(0xffffff, 3.3);
keyLight.position.set(-7, 11, -8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.1;
keyLight.shadow.camera.far = 45;
keyLight.shadow.bias = -0.00008;
scene.add(keyLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: 0xe9eef0, roughness: 1, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.003;
ground.receiveShadow = true;
scene.add(ground);

let currentBuild: AquariumBuild | null = null;
let modelGroup: THREE.Group | null = null;
let rebuildTimer = 0;
let firstBuild = true;

function saveSettings(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function rebuildNow(autoFrame = false): void {
  if (currentBuild) {
    scene.remove(currentBuild.group);
    currentBuild.dispose();
  }
  currentBuild = buildAquarium(settings);
  modelGroup = currentBuild.group;
  scene.add(modelGroup);
  updateStats();
  saveSettings();
  if (firstBuild || autoFrame) {
    setCameraView('iso');
    firstBuild = false;
  }
}

function scheduleRebuild(structural: boolean): void {
  window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => rebuildNow(structural && false), structural ? 55 : 90);
}

function updateStats(): void {
  document.querySelector<HTMLElement>('#dimension-stat')!.textContent = `${settings.width.toFixed(1)} × ${settings.depth.toFixed(1)} × ${settings.height.toFixed(1)} m`;
  document.querySelector<HTMLElement>('#triangle-stat')!.textContent = `${currentBuild?.triangles.toLocaleString() ?? '—'} triangles`;
}

function fitDistance(direction: THREE.Vector3): { position: THREE.Vector3; target: THREE.Vector3 } {
  if (!modelGroup) return { position: new THREE.Vector3(12, 8, 12), target: new THREE.Vector3() };
  const box = new THREE.Box3().setFromObject(modelGroup);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const fitHeightDistance = maxSize / (2 * Math.tan(fov / 2));
  const fitWidthDistance = fitHeightDistance / Math.max(0.35, camera.aspect);
  const distance = Math.max(fitHeightDistance, fitWidthDistance) * 1.22;
  return { position: center.clone().add(direction.clone().normalize().multiplyScalar(distance)), target: center };
}

function animateCamera(position: THREE.Vector3, target: THREE.Vector3): void {
  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const startTime = performance.now();
  const duration = 360;
  function step(time: number): void {
    const raw = Math.min(1, (time - startTime) / duration);
    const eased = 1 - Math.pow(1 - raw, 3);
    camera.position.lerpVectors(startPosition, position, eased);
    controls.target.lerpVectors(startTarget, target, eased);
    controls.update();
    if (raw < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function setCameraView(view: 'iso' | 'front' | 'side' | 'top' | 'fit'): void {
  const directions = {
    iso: new THREE.Vector3(1.25, 0.82, 1.45),
    front: new THREE.Vector3(0, 0.18, 1),
    side: new THREE.Vector3(1, 0.18, 0),
    top: new THREE.Vector3(0.001, 1, 0.001),
    fit: camera.position.clone().sub(controls.target).normalize(),
  };
  const fitted = fitDistance(directions[view]);
  animateCamera(fitted.position, fitted.target);
}

function showToast(message: string): void {
  const toast = document.querySelector<HTMLElement>('#toast')!;
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

function encodeSettings(): string {
  const json = JSON.stringify(settings);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function shareSettings(): Promise<void> {
  const url = new URL(window.location.href);
  url.hash = `config=${encodeSettings()}`;
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url.toString());
    showToast('Share link copied');
  } catch {
    showToast('Settings added to the address bar');
  }
}

function cleanFileName(value: string): string {
  const cleaned = value.trim().replace(/\.glb$/i, '').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'public-aquarium';
}

async function downloadModel(): Promise<void> {
  if (!modelGroup) return;
  const overlay = document.querySelector<HTMLElement>('#loading-overlay')!;
  const button = document.querySelector<HTMLButtonElement>('#download-button')!;
  overlay.hidden = false;
  button.disabled = true;
  try {
    const buffer = await exportAquariumGLB(modelGroup, settings.exportScale);
    const blob = new Blob([buffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const fileInput = document.querySelector<HTMLInputElement>('#file-name')!;
    link.href = url;
    link.download = `${cleanFileName(fileInput.value)}.glb`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('GLB downloaded');
  } catch (error) {
    console.error(error);
    showToast('Could not export the GLB');
  } finally {
    overlay.hidden = true;
    button.disabled = false;
  }
}

const panel = new ControlPanel(controlRoot, settings, {
  onChange: (nextSettings, structural) => {
    settings = nextSettings;
    scheduleRebuild(structural);
  },
  onReset: (nextSettings) => {
    settings = nextSettings;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    rebuildNow(true);
  },
  onShare: () => void shareSettings(),
  onDownload: () => void downloadModel(),
  onView: setCameraView,
});

function resize(): void {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(viewport);
resize();

let hintHidden = false;
controls.addEventListener('start', () => {
  if (hintHidden) return;
  hintHidden = true;
  document.querySelector('#viewer-hint')?.classList.add('is-hidden');
});

function render(): void {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

rebuildNow(true);
panel.setSettings(settings);
render();

window.addEventListener('beforeunload', () => {
  currentBuild?.dispose();
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  environment.dispose();
  renderer.dispose();
});
