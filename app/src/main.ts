import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildAquarium, exportAquariumGLB, type AquariumBuild } from './model/aquarium';
import { cloneSettings, DEFAULT_SETTINGS, normalizeSettings, type AquariumSettings } from './model/settings';
import { ControlPanel } from './ui/panel';

const STORAGE_KEY = 'aquarium-maker-settings-v9-layout-passages-navigation';

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
  const migrated: Partial<AquariumSettings> = { ...partial };
  // Keep older v1.7 links and local settings useful after the arm-based layout refactor.
  if (partial.lVerticalArmWidth === undefined && partial.lArmWidth !== undefined) migrated.lVerticalArmWidth = partial.lArmWidth;
  if (partial.lVerticalArmLength === undefined && partial.depth !== undefined) migrated.lVerticalArmLength = partial.depth;
  if (partial.lHorizontalArmWidth === undefined && partial.lRearDepth !== undefined) migrated.lHorizontalArmWidth = partial.lRearDepth;
  if (partial.lHorizontalArmLength === undefined && partial.width !== undefined) migrated.lHorizontalArmLength = partial.width;
  if (partial.uLeftArmLength === undefined && partial.depth !== undefined) migrated.uLeftArmLength = partial.depth;
  if (partial.uRightArmLength === undefined && partial.depth !== undefined) migrated.uRightArmLength = partial.depth;
  if (partial.uBridgeLength === undefined && partial.width !== undefined) migrated.uBridgeLength = partial.width;
  if (partial.uBridgeDepth === undefined && partial.uBackDepth !== undefined) migrated.uBridgeDepth = partial.uBackDepth;

  return normalizeSettings({
    ...cloneSettings(DEFAULT_SETTINGS),
    ...migrated,
    passages: Array.isArray(partial.passages) ? partial.passages : [],
    radii: { ...DEFAULT_SETTINGS.radii, ...partial.radii },
    cornerModes: { ...DEFAULT_SETTINGS.cornerModes, ...partial.cornerModes },
    shapeCornerRadii: { ...DEFAULT_SETTINGS.shapeCornerRadii, ...partial.shapeCornerRadii },
    shapeCornerModes: { ...DEFAULT_SETTINGS.shapeCornerModes, ...partial.shapeCornerModes },
    wallModes: { ...DEFAULT_SETTINGS.wallModes, ...partial.wallModes },
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
  const initialHeight = settings.profile === 'belowFloor' ? settings.heightAboveFloor : settings.profile === 'touchPool' ? settings.touchPoolHeight : settings.height;
  controls.target.set(0, initialHeight * 0.42, 0);

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
const navOverlayGroup = new THREE.Group();
navOverlayGroup.name = 'VIEWPORT_NAV_OVERLAY';
scene.add(navOverlayGroup);
const simulationGroup = new THREE.Group();
simulationGroup.name = 'VIEWPORT_ANIMAL_SIMULATION';
scene.add(simulationGroup);
type SimAgent = { position: THREE.Vector3; velocity: THREE.Vector3; phase: number };
let simAgents: SimAgent[] = [];
let simMesh: THREE.InstancedMesh | null = null;
let simulationBounds: THREE.Box3 | null = null;
let simulationBoundary: number[][] = [];
let simulationYRange: [number, number] = [0, 1];
const dummyObject = new THREE.Object3D();

function pointInBoundary(x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = simulationBoundary.length - 1; i < simulationBoundary.length; j = i++) {
    const a = simulationBoundary[i]!; const b = simulationBoundary[j]!;
    if (((a[1]! > z) !== (b[1]! > z)) && x < (b[0]! - a[0]!) * (z - a[1]!) / Math.max(1e-9, b[1]! - a[1]!) + a[0]!) inside = !inside;
  }
  return inside;
}

const SIM_TEMPLATES = {
  school: { count: 140, size: 0.07, speed: 0.75, turn: 1.8, surface: 0.5 },
  reef: { count: 32, size: 0.16, speed: 0.42, turn: 1.15, surface: 0.5 },
  large: { count: 4, size: 0.48, speed: 0.28, turn: 0.38, surface: 0.55 },
  ray: { count: 5, size: 0.42, speed: 0.24, turn: 0.42, surface: 0.22 },
  dolphin: { count: 3, size: 0.58, speed: 0.62, turn: 0.34, surface: 0.72 },
  otter: { count: 4, size: 0.34, speed: 0.34, turn: 0.7, surface: 0.84 },
  bottom: { count: 18, size: 0.13, speed: 0.22, turn: 1.1, surface: 0.08 },
} as const;

function clearPreviewHelpers(): void {
  navOverlayGroup.clear();
  if (simMesh) { simMesh.geometry.dispose(); (simMesh.material as THREE.Material).dispose(); }
  simulationGroup.clear(); simMesh = null; simAgents = [];
}

function rebuildNavOverlay(): void {
  navOverlayGroup.clear();
  const navigation = modelGroup?.userData.navigation as Record<string, unknown> | undefined;
  if (!navigation || !settings.navOverlayEnabled) return;
  const boundary = navigation.waterBoundary as number[][];
  const range = navigation.waterHeightRangeMeters as number[];
  if (!Array.isArray(boundary) || boundary.length < 3) return;
  const shape = new THREE.Shape(boundary.map((point) => new THREE.Vector2(point[0]!, point[1]!)));
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, (range?.[0] ?? 0) + 0.02, 0);
  const material = new THREE.MeshBasicMaterial({ color: 0x31d169, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material); mesh.renderOrder = 20; navOverlayGroup.add(mesh);
}

function rebuildSimulation(): void {
  simulationGroup.clear(); simAgents = []; simMesh = null;
  const navigation = modelGroup?.userData.navigation as Record<string, unknown> | undefined;
  if (!navigation || !settings.fishSimulationEnabled) return;
  simulationBoundary = navigation.waterBoundary as number[][];
  const range = navigation.waterHeightRangeMeters as number[];
  simulationYRange = [range?.[0] ?? 0, range?.[1] ?? 1];
  const bounds = navigation.boundsMeters as { min:number[]; max:number[] };
  simulationBounds = new THREE.Box3(new THREE.Vector3(bounds.min[0], bounds.min[1], bounds.min[2]), new THREE.Vector3(bounds.max[0], bounds.max[1], bounds.max[2]));
  const template = SIM_TEMPLATES[settings.fishSimulationPreset];
  const geometry = settings.fishSimulationPreset === 'ray' ? new THREE.SphereGeometry(1, 8, 5) : new THREE.ConeGeometry(0.32, 1, 6);
  geometry.rotateZ(-Math.PI / 2); geometry.scale(template.size * 0.55, template.size * 0.35, template.size * 0.35);
  const material = new THREE.MeshStandardMaterial({ color: settings.fishSimulationPreset === 'school' ? 0x4d83aa : 0x65747a, roughness: 0.6, metalness: 0 });
  simMesh = new THREE.InstancedMesh(geometry, material, template.count); simulationGroup.add(simMesh);
  const center = simulationBounds.getCenter(new THREE.Vector3());
  for (let i=0;i<template.count;i++) {
    let x=center.x,z=center.z, tries=0;
    do { x=THREE.MathUtils.lerp(simulationBounds.min.x,simulationBounds.max.x,Math.random()); z=THREE.MathUtils.lerp(simulationBounds.min.z,simulationBounds.max.z,Math.random()); tries++; } while(!pointInBoundary(x,z)&&tries<80);
    const y=THREE.MathUtils.lerp(simulationYRange[0]+template.size,simulationYRange[1]-template.size,Math.min(0.98,Math.max(0.02,template.surface+THREE.MathUtils.randFloatSpread(0.28))));
    simAgents.push({position:new THREE.Vector3(x,y,z),velocity:new THREE.Vector3(THREE.MathUtils.randFloatSpread(1),THREE.MathUtils.randFloatSpread(.25),THREE.MathUtils.randFloatSpread(1)).normalize().multiplyScalar(template.speed),phase:Math.random()*Math.PI*2});
  }
}

function refreshPreviewHelpers(): void { rebuildNavOverlay(); rebuildSimulation(); }
let lastValidSettings = cloneSettings(settings);
let panel: ControlPanel | null = null;
let rebuildTimer = 0;
let firstBuild = true;
let cameraAnimationToken = 0;

function updateStats(): void {
  const visibleHeight = settings.profile === 'belowFloor'
    ? settings.heightAboveFloor + settings.depthBelowFloor
    : settings.profile === 'touchPool'
      ? settings.touchPoolHeight
      : settings.height;
  const profileLabel = settings.profile === 'belowFloor' ? 'below floor' : settings.profile === 'touchPool' ? 'touch pool' : 'standard';
  const rotated = settings.footprintRotation === 90 || settings.footprintRotation === 270;
  const displayWidth = rotated ? settings.depth : settings.width;
  const displayDepth = rotated ? settings.width : settings.depth;
  requireElement<HTMLElement>('#dimension-stat').textContent =
    `${displayWidth.toFixed(1)} × ${displayDepth.toFixed(1)} × ${visibleHeight.toFixed(1)} m · ${profileLabel}`;
  requireElement<HTMLElement>('#triangle-stat').textContent =
    `${currentBuild?.triangles.toLocaleString() ?? '—'} triangles`;
  scaleBadge.textContent = `Preview in meters · export ${Number(settings.exportScale.toFixed(3))}×`;
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
    refreshPreviewHelpers();
    lastValidSettings = cloneSettings(settings);
    updateStats();
    saveSettings();

    if (firstBuild || autoFrame) {
      setCameraView('iso');
      firstBuild = false;
    }
  } catch (error) {
    console.error('Could not rebuild aquarium:', error);
    const detail = error instanceof Error ? error.message : 'Those settings could not be applied';
    showToast(detail.length > 92 ? `${detail.slice(0, 89)}…` : detail);
    settings = cloneSettings(lastValidSettings);
    panel?.setSettings(settings);
    updateStats();
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

function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
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
    const fileInput = requireElement<HTMLInputElement>('#file-name');
    const stem = cleanFileName(fileInput.value);
    downloadBlob(new Blob([buffer], { type: 'model/gltf-binary' }), `${stem}.glb`);

    if (settings.exportNavigationJson && modelGroup.userData.navigation) {
      const navigation = {
        ...modelGroup.userData.navigation,
        exportUnitsPerMeter: settings.exportScale,
        exportedBoundsUnits: {
          width: (settings.footprintRotation === 90 || settings.footprintRotation === 270 ? settings.depth : settings.width) * settings.exportScale,
          depth: (settings.footprintRotation === 90 || settings.footprintRotation === 270 ? settings.width : settings.depth) * settings.exportScale,
          height: (settings.profile === 'belowFloor' ? settings.heightAboveFloor + settings.depthBelowFloor : settings.profile === 'touchPool' ? settings.touchPoolHeight : settings.height) * settings.exportScale,
        },
      };
      downloadBlob(new Blob([JSON.stringify(navigation, null, 2)], { type: 'application/json' }), `${stem}.navigation.json`);
      showToast('GLB and navigation JSON downloaded');
    } else {
      showToast('GLB downloaded');
    }
  } catch (error) {
    console.error('GLB export failed:', error);
    showToast('Could not export the GLB');
  } finally {
    overlay.hidden = true;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

panel = new ControlPanel(controlRoot, settings, {
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

const navButton = requireElement<HTMLButtonElement>('#toggle-nav-overlay');
const fishButton = requireElement<HTMLButtonElement>('#toggle-fish-simulation');
const fishPreset = requireElement<HTMLSelectElement>('#fish-preset');
navButton.addEventListener('click', () => { settings.navOverlayEnabled = !settings.navOverlayEnabled; navButton.classList.toggle('is-active', settings.navOverlayEnabled); rebuildNavOverlay(); saveSettings(); });
fishButton.addEventListener('click', () => { settings.fishSimulationEnabled = !settings.fishSimulationEnabled; fishButton.classList.toggle('is-active', settings.fishSimulationEnabled); rebuildSimulation(); saveSettings(); });
fishPreset.value = settings.fishSimulationPreset;
fishPreset.addEventListener('change', () => { settings.fishSimulationPreset = fishPreset.value as AquariumSettings['fishSimulationPreset']; rebuildSimulation(); saveSettings(); });
navButton.classList.toggle('is-active', settings.navOverlayEnabled); fishButton.classList.toggle('is-active', settings.fishSimulationEnabled);

let previousRenderTime = performance.now();
let animationFrame = 0;
function render(time = performance.now()): void {
  if (!renderer) return;
  const delta = Math.min(0.05, Math.max(0, (time - previousRenderTime) / 1000)); previousRenderTime = time;
  controls?.update();
  if (modelGroup && settings.waterAnimationEnabled) {
    modelGroup.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.name !== 'WATER_Surface') return;
      const material = object.material as THREE.MeshPhysicalMaterial;
      const speed = settings.waterAnimationSpeed * delta;
      if (material.map) { material.map.wrapS = material.map.wrapT = THREE.RepeatWrapping; material.map.offset.x += speed * 0.018; material.map.offset.y += speed * 0.011; }
      if (material.normalMap) { material.normalMap.wrapS = material.normalMap.wrapT = THREE.RepeatWrapping; material.normalMap.offset.x -= speed * 0.013; material.normalMap.offset.y += speed * 0.016; }
      object.position.y = Math.sin(time * 0.0014 * Math.max(0.1, settings.waterAnimationSpeed)) * settings.waterAnimationAmount;
    });
  }
  if (simMesh && settings.fishSimulationEnabled && simulationBounds) {
    const activeBounds = simulationBounds;
    const template = SIM_TEMPLATES[settings.fishSimulationPreset];
    simAgents.forEach((agent,index) => {
      agent.phase += delta;
      agent.velocity.x += Math.sin(agent.phase*1.7+index)*template.turn*delta*0.08;
      agent.velocity.z += Math.cos(agent.phase*1.3+index)*template.turn*delta*0.08;
      const desiredY = THREE.MathUtils.lerp(simulationYRange[0], simulationYRange[1], template.surface);
      agent.velocity.y += (desiredY-agent.position.y)*delta*0.18;
      agent.velocity.setLength(template.speed);
      const next=agent.position.clone().addScaledVector(agent.velocity,delta);
      const margin=template.size*0.8;
      if (!pointInBoundary(next.x,next.z) || next.y<simulationYRange[0]+margin || next.y>simulationYRange[1]-margin) {
        const center=activeBounds.getCenter(new THREE.Vector3()); agent.velocity.lerp(center.sub(agent.position).normalize().multiplyScalar(template.speed),0.42);
      } else agent.position.copy(next);
      dummyObject.position.copy(agent.position); dummyObject.lookAt(agent.position.clone().add(agent.velocity)); dummyObject.updateMatrix(); simMesh!.setMatrixAt(index,dummyObject.matrix);
    });
    simMesh.instanceMatrix.needsUpdate=true;
  }
  renderer.render(scene, camera);
  animationFrame = requestAnimationFrame(render);
}

rebuildNow(true);
panel?.setSettings(settings);
render();

// Small non-UI test hook used by the repository's validation workflow.
Object.assign(window as unknown as { __aquariumMaker?: unknown }, {
  __aquariumMaker: {
    getSettings: () => JSON.parse(JSON.stringify(settings)) as AquariumSettings,
    getStats: () => ({ triangles: currentBuild?.triangles ?? 0, vertices: currentBuild?.vertices ?? 0 }),
    getNavigation: () => modelGroup?.userData.navigation ?? null,
    exportCurrent: async () => modelGroup ? exportAquariumGLB(modelGroup, settings.exportScale) : null,
  },
});

window.addEventListener('beforeunload', () => {
  window.clearTimeout(rebuildTimer);
  if (animationFrame) cancelAnimationFrame(animationFrame);
  clearPreviewHelpers();
  currentBuild?.dispose();
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  environment?.dispose();
  controls?.dispose();
  renderer?.dispose();
});
