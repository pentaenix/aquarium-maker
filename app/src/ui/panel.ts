import * as THREE from 'three';
import type {
  AquariumProfile,
  AquariumSettings,
  CornerMode,
  CornerRadii,
  FootprintType,
  GroundPreset,
  ShapeCornerKey,
  TunnelAxis,
  WaterSurfacePreset,
} from '../model/settings';
import {
  activeShapeCornerKeys,
  cloneSettings,
  DEFAULT_SETTINGS,
  normalizeSettings,
  SHAPE_CORNER_LABELS,
  tunnelAllowed,
} from '../model/settings';
import { createFootprintShapeLoop } from '../model/aquarium';

export type SelectedCorner = keyof CornerRadii | ShapeCornerKey;
type PanelTab = 'shape' | 'profile' | 'tunnel' | 'water' | 'ground';

export interface PanelCallbacks {
  onChange: (settings: AquariumSettings, structural: boolean) => void;
  onReset: (settings: AquariumSettings) => void;
  onShare: () => void;
  onDownload: () => void;
  onView: (view: 'iso' | 'front' | 'side' | 'top' | 'fit') => void;
}

interface RangeDefinition {
  key: keyof AquariumSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  structural?: boolean;
  format?: (value: number) => string;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const surfaceLabel = (value: number) => value < 0.25 ? 'Subtle' : value < 0.55 ? 'Natural' : value < 0.82 ? 'Graphic' : 'Bold';
const tunnelShapeLabel = (value: number) => value <= 0.015 ? 'Square' : value < 0.55 ? 'Soft arch' : value < 0.98 ? 'Round arch' : 'Tall arch';

const GROUND_PRESETS: Record<GroundPreset, { color: string; variation: number; grain: number; irregularity: number; moundSize: number }> = {
  sand: { color: '#c8ad79', variation: 0.22, grain: 0.52, irregularity: 0.045, moundSize: 1.35 },
  dirt: { color: '#76533a', variation: 0.44, grain: 0.78, irregularity: 0.08, moundSize: 1.7 },
  algae: { color: '#687a49', variation: 0.52, grain: 0.92, irregularity: 0.025, moundSize: 2.1 },
  gravel: { color: '#888279', variation: 0.58, grain: 1.45, irregularity: 0.11, moundSize: 0.75 },
};

const RANGE_DEFINITIONS: RangeDefinition[] = [
  { key: 'width', label: 'Width', min: 2, max: 30, step: 0.1, unit: 'm', structural: true },
  { key: 'depth', label: 'Depth', min: 1, max: 15, step: 0.1, unit: 'm', structural: true },
  { key: 'height', label: 'Tank height', min: 0.5, max: 12, step: 0.1, unit: 'm', structural: true },
  { key: 'heightAboveFloor', label: 'Above floor', min: 0.25, max: 6, step: 0.05, unit: 'm', structural: true },
  { key: 'depthBelowFloor', label: 'Below floor', min: 0.2, max: 12, step: 0.05, unit: 'm', structural: true },
  { key: 'floorRimHeight', label: 'Floor rim', min: 0.02, max: 0.35, step: 0.005, unit: 'm', structural: true },
  { key: 'lArmWidth', label: 'L vertical arm', min: 0.8, max: 24, step: 0.05, unit: 'm', structural: true },
  { key: 'lRearDepth', label: 'L rear arm', min: 0.8, max: 12, step: 0.05, unit: 'm', structural: true },
  { key: 'lOpeningWidth', label: 'Open section width', min: 0.2, max: 24, step: 0.05, unit: 'm', structural: true },
  { key: 'lOpeningDepth', label: 'Open section depth', min: 0.2, max: 12, step: 0.05, unit: 'm', structural: true },
  { key: 'uLeftArmWidth', label: 'U left arm', min: 0.55, max: 12, step: 0.05, unit: 'm', structural: true },
  { key: 'uRightArmWidth', label: 'U right arm', min: 0.55, max: 12, step: 0.05, unit: 'm', structural: true },
  { key: 'uBackDepth', label: 'U bridge depth', min: 0.7, max: 12, step: 0.05, unit: 'm', structural: true },
  { key: 'uOpeningWidth', label: 'Opening width', min: 0.2, max: 24, step: 0.05, unit: 'm', structural: true },
  { key: 'uOpeningDepth', label: 'Opening depth', min: 0.2, max: 12, step: 0.05, unit: 'm', structural: true },
  { key: 'uOpeningOffset', label: 'Opening position', min: -8, max: 8, step: 0.05, unit: 'm', structural: true },
  { key: 'touchPoolHeight', label: 'Pool height', min: 0.25, max: 1.8, step: 0.025, unit: 'm', structural: true },
  { key: 'touchWaterDepth', label: 'Water depth', min: 0.08, max: 1.2, step: 0.025, unit: 'm', structural: true },
  { key: 'touchRimHeight', label: 'Rim height', min: 0.03, max: 0.3, step: 0.005, unit: 'm', structural: true },
  { key: 'touchRimWidth', label: 'Reach rim width', min: 0.08, max: 2, step: 0.01, unit: 'm', structural: true },
  { key: 'touchPedestalHeight', label: 'Pedestal height', min: 0, max: 1.4, step: 0.025, unit: 'm', structural: true },
  { key: 'touchBasinInset', label: 'Basin inset', min: 0.05, max: 2, step: 0.025, unit: 'm', structural: true },
  { key: 'waterLevel', label: 'Water level', min: 0.2, max: 0.97, step: 0.01, structural: true, format: percent },
  { key: 'waterTint', label: 'Side tint', min: 0, max: 1, step: 0.01, format: percent },
  { key: 'waveStrength', label: 'Wave definition', min: 0, max: 1, step: 0.01, format: percent },
  { key: 'waterSurfaceStyle', label: 'Surface character', min: 0, max: 1, step: 0.01, format: surfaceLabel },
  { key: 'waterWaveScale', label: 'Wave size', min: 0, max: 1, step: 0.01, format: (value) => value < 0.34 ? 'Broad' : value < 0.67 ? 'Medium' : 'Fine' },
  { key: 'sandVariation', label: 'Color variation', min: 0, max: 1, step: 0.01, format: percent },
  { key: 'sandGrain', label: 'Grain scale', min: 0.1, max: 2.5, step: 0.05, format: (value) => value.toFixed(2) },
  { key: 'groundIrregularity', label: 'Floor irregularity', min: 0, max: 0.6, step: 0.005, unit: 'm', structural: true },
  { key: 'groundMoundSize', label: 'Mound size', min: 0.25, max: 8, step: 0.05, unit: 'm', structural: true },
  { key: 'groundMoundCount', label: 'Mound count', min: 1, max: 10, step: 1, structural: true, format: (value) => `${Math.round(value)} forms` },
  { key: 'groundTerrainDetail', label: 'Terrain detail', min: 0, max: 3, step: 1, structural: true, format: (value) => ['Low', 'Medium', 'High', 'Very high'][Math.round(value)]! },
  { key: 'baseHeight', label: 'Base thickness', min: 0.02, max: 0.5, step: 0.005, unit: 'm', structural: true },
  { key: 'bottomRimHeight', label: 'Lower rim', min: 0.02, max: 0.5, step: 0.005, unit: 'm', structural: true },
  { key: 'topRimHeight', label: 'Upper rim', min: 0.02, max: 0.6, step: 0.005, unit: 'm', structural: true },
  { key: 'glassThickness', label: 'Acrylic thickness', min: 0.01, max: 0.25, step: 0.005, unit: 'm', structural: true },
  { key: 'baseOverhang', label: 'Base overhang', min: 0, max: 0.5, step: 0.005, unit: 'm', structural: true },
  { key: 'frameOverhang', label: 'Rim overhang', min: 0, max: 0.3, step: 0.005, unit: 'm', structural: true },
  { key: 'frameOverlap', label: 'Rim overlap', min: 0.01, max: 0.3, step: 0.005, unit: 'm', structural: true },
  { key: 'curveSegments', label: 'Corner quality', min: 2, max: 16, step: 1, structural: true, format: (value) => `${Math.round(value)} segments` },
  { key: 'tunnelWidth', label: 'Passage width', min: 0.8, max: 12, step: 0.05, unit: 'm', structural: true },
  { key: 'tunnelOffset', label: 'Lateral position', min: -10, max: 10, step: 0.05, unit: 'm', structural: true },
  { key: 'tunnelWallHeight', label: 'Straight wall height', min: 0.35, max: 5, step: 0.05, unit: 'm', structural: true },
  { key: 'tunnelRoundness', label: 'Roof shape', min: 0, max: 1.35, step: 0.01, structural: true, format: tunnelShapeLabel },
  { key: 'tunnelGlassThickness', label: 'Tunnel acrylic', min: 0.025, max: 0.25, step: 0.005, unit: 'm', structural: true },
  { key: 'tunnelCurveSegments', label: 'Arch quality', min: 5, max: 24, step: 1, structural: true, format: (value) => `${Math.round(value)} segments` },
  { key: 'tunnelEndExtension', label: 'End extension', min: 0, max: 0.8, step: 0.01, unit: 'm', structural: true },
  { key: 'portalFrameWidth', label: 'Portal border', min: 0.04, max: 0.45, step: 0.005, unit: 'm', structural: true },
  { key: 'portalFrameDepth', label: 'Portal depth', min: 0.04, max: 0.65, step: 0.005, unit: 'm', structural: true },
  { key: 'tunnelWaterClearance', label: 'Water clearance', min: 0.005, max: 0.12, step: 0.005, unit: 'm', structural: true },
  { key: 'tunnelSideRimWidth', label: 'Side rim width', min: 0.03, max: 0.35, step: 0.005, unit: 'm', structural: true },
  { key: 'tunnelBridgeRimHeight', label: 'Side rim height', min: 0.02, max: 0.35, step: 0.005, unit: 'm', structural: true },
  { key: 'tunnelBridgeSeparatorSpacing', label: 'Floor panel spacing', min: 0.3, max: 4, step: 0.05, unit: 'm', structural: true },
  { key: 'tunnelBridgeSeparatorWidth', label: 'Floor separator width', min: 0.005, max: 0.15, step: 0.005, unit: 'm', structural: true },
  { key: 'exportScale', label: 'Units per meter', min: 1, max: 100, step: 1, format: (value) => `${Math.round(value)}×` },
];

function rangeMarkup(id: keyof AquariumSettings): string {
  const definition = RANGE_DEFINITIONS.find((item) => item.key === id);
  if (!definition) throw new Error(`Missing range definition: ${String(id)}`);
  return `
    <div class="control-row" data-control="${definition.key}">
      <div class="control-label-row"><label for="${definition.key}-range">${definition.label}</label><output id="${definition.key}-output"></output></div>
      <div class="range-pair">
        <input id="${definition.key}-range" data-range-key="${definition.key}" type="range" min="${definition.min}" max="${definition.max}" step="${definition.step}" />
        <div class="number-wrap"><input id="${definition.key}-number" data-number-key="${definition.key}" type="number" ${definition.min >= 0 ? `min="${definition.min === 0 ? 0 : Math.min(definition.min, 0.001)}"` : ''} step="${definition.step}" />${definition.unit ? `<span>${definition.unit}</span>` : ''}</div>
      </div>
    </div>`;
}

function colorMarkup(key: 'waterColor' | 'sandColor' | 'subFloorBodyColor', label: string): string {
  return `<div class="color-row"><label for="${key}-color">${label}</label><div class="color-control"><input id="${key}-color" data-color-key="${key}" type="color" /><input id="${key}-text" data-color-text-key="${key}" type="text" maxlength="7" spellcheck="false" /></div></div>`;
}

function card(title: string, subtitle: string, content: string, className = ''): string {
  return `<section class="settings-card ${className}"><header><strong>${title}</strong><span>${subtitle}</span></header><div class="settings-card-body">${content}</div></section>`;
}

const RECTANGLE_KEYS: Array<keyof CornerRadii> = ['frontLeft', 'frontRight', 'backRight', 'backLeft'];
const RECTANGLE_LABELS: Record<keyof CornerRadii, string> = {
  frontLeft: 'Front left', frontRight: 'Front right', backRight: 'Back right', backLeft: 'Back left',
};

function cornerShortLabel(key: SelectedCorner): string {
  const labels: Partial<Record<SelectedCorner, string>> = {
    frontLeft: 'FL', frontRight: 'FR', backRight: 'BR', backLeft: 'BL',
    lBackLeft: 'BL', lBackRight: 'BR', lOuterRight: 'OR', lInnerElbow: 'IN', lFrontRight: 'FR', lFrontLeft: 'FL',
    uBackLeft: 'BL', uBackRight: 'BR', uFrontRight: 'FR', uMouthRight: 'MR', uInnerRight: 'IR', uInnerLeft: 'IL', uMouthLeft: 'ML', uFrontLeft: 'FL',
  };
  return labels[key] ?? '•';
}

export class ControlPanel {
  private settings: AquariumSettings;
  private readonly root: HTMLElement;
  private readonly callbacks: PanelCallbacks;
  private selectedCorner: SelectedCorner = 'frontLeft';
  private linkCorners = false;
  private activeTab: PanelTab = 'shape';

  constructor(root: HTMLElement, settings: AquariumSettings, callbacks: PanelCallbacks) {
    this.root = root;
    this.settings = settings;
    this.callbacks = callbacks;
    this.render();
    this.bind();
    this.refresh();
  }

  setSettings(settings: AquariumSettings): void {
    this.settings = settings;
    this.ensureSelectedCorner();
    this.refresh();
  }

  private activeCornerKeys(): SelectedCorner[] {
    return this.settings.footprint === 'rectangle'
      ? RECTANGLE_KEYS
      : activeShapeCornerKeys(this.settings.footprint);
  }

  private ensureSelectedCorner(): void {
    const keys = this.activeCornerKeys();
    if (!keys.includes(this.selectedCorner)) this.selectedCorner = keys[0] ?? 'frontLeft';
  }

  private getCornerRadius(key: SelectedCorner): number {
    return key in this.settings.radii
      ? this.settings.radii[key as keyof CornerRadii]
      : this.settings.shapeCornerRadii[key as ShapeCornerKey];
  }

  private setCornerRadius(key: SelectedCorner, value: number): void {
    if (key in this.settings.radii) this.settings.radii[key as keyof CornerRadii] = value;
    else this.settings.shapeCornerRadii[key as ShapeCornerKey] = value;
  }

  private getCornerMode(key: SelectedCorner): CornerMode {
    return key in this.settings.cornerModes
      ? this.settings.cornerModes[key as keyof CornerRadii]
      : this.settings.shapeCornerModes[key as ShapeCornerKey];
  }

  private setCornerMode(key: SelectedCorner, mode: CornerMode): void {
    if (key in this.settings.cornerModes) this.settings.cornerModes[key as keyof CornerRadii] = mode;
    else this.settings.shapeCornerModes[key as ShapeCornerKey] = mode;
  }

  private cornerName(key: SelectedCorner): string {
    return key in RECTANGLE_LABELS ? RECTANGLE_LABELS[key as keyof CornerRadii] : SHAPE_CORNER_LABELS[key as ShapeCornerKey];
  }

  private render(): void {
    const tabs: Array<[PanelTab, string, string]> = [
      ['shape', 'Shape', 'M5 19V9a4 4 0 0 1 4-4h10v14Z'],
      ['profile', 'Profile', 'M6 20V6h12v14M6 12h12M10 6v14'],
      ['tunnel', 'Tunnel', 'M4 19V11a8 8 0 0 1 16 0v8M8 19v-8a4 4 0 0 1 8 0v8'],
      ['water', 'Water', 'M3 15c3-3 6 3 9 0s6 3 9 0M4 9c3-3 5 2 8 0s5 3 8 0'],
      ['ground', 'Ground', 'M4 17c4-2 8-2 16 0M5 13c5-2 9-2 14 0M7 9h10'],
    ];

    this.root.innerHTML = `
      <nav class="panel-tabs" aria-label="Aquarium editor sections">${tabs.map(([id, label, icon]) => `<button type="button" data-tab="${id}" class="${id === this.activeTab ? 'is-active' : ''}"><svg viewBox="0 0 24 24"><path d="${icon}" /></svg><span>${label}</span></button>`).join('')}</nav>
      <div class="tab-stage">
        <section class="tab-pane" data-tab-panel="shape">
          ${card('Footprint', 'Choose a plan, then tune its usable dimensions', `
            <div class="mode-grid footprint-grid" role="group" aria-label="Footprint type">
              <button type="button" data-footprint="rectangle"><strong>Rectangle</strong><small>Classic exhibit tank</small></button>
              <button type="button" data-footprint="lShape"><strong>L shape</strong><small>One open inside elbow</small></button>
              <button type="button" data-footprint="uShape"><strong>U shape</strong><small>Two arms and an opening</small></button>
            </div>
            ${rangeMarkup('width')}${rangeMarkup('depth')}
            <div id="shape-standard-height">${rangeMarkup('height')}</div>
            <div id="shape-below-heights">${rangeMarkup('heightAboveFloor')}${rangeMarkup('depthBelowFloor')}</div>
            <div id="shape-touch-height">${rangeMarkup('touchPoolHeight')}</div>
            <div class="shape-options" id="l-shape-options"><div class="shape-subheading"><strong>Solid arms</strong><span>Thickness of the two legs</span></div>${rangeMarkup('lArmWidth')}${rangeMarkup('lRearDepth')}<div class="shape-subheading"><strong>Open section</strong><span>Edit the missing rectangle directly</span></div>${rangeMarkup('lOpeningWidth')}${rangeMarkup('lOpeningDepth')}</div>
            <div class="shape-options" id="u-shape-options"><div class="shape-subheading"><strong>Solid arms</strong><span>Independent left, right, and back thickness</span></div>${rangeMarkup('uLeftArmWidth')}${rangeMarkup('uRightArmWidth')}${rangeMarkup('uBackDepth')}<div class="shape-subheading"><strong>Central opening</strong><span>Size and lateral placement of the empty area</span></div>${rangeMarkup('uOpeningWidth')}${rangeMarkup('uOpeningDepth')}${rangeMarkup('uOpeningOffset')}</div>
            <p class="section-note manual-value-note">Sliders cover the most useful range. You can type a larger positive value whenever the shape can physically contain it.</p>
          `)}
          ${card('Corner designer', 'Every outside and inside corner can be tuned independently', `
            <div class="corner-editor">
              <div class="corner-canvas-wrap">
                <svg id="corner-preview" viewBox="0 0 240 150" role="img" aria-label="Interactive top view of the aquarium footprint">
                  <path id="corner-preview-frame" class="corner-preview-frame"></path>
                  <path id="corner-preview-path" class="corner-preview-body"></path>
                  <path id="corner-preview-water" class="corner-preview-water"></path>
                  <path id="corner-preview-tunnel" class="corner-preview-tunnel"></path>
                  <g id="corner-hotspots"></g>
                  <text class="front-label" x="120" y="143">FRONT</text>
                </svg>
              </div>
              <div class="corner-preset-row"><button type="button" data-corner-preset="soft">Soft</button><button type="button" data-corner-preset="balanced">Balanced</button><button type="button" data-corner-preset="square">Square</button></div>
              <div class="toggle-row"><div><strong>Edit all active corners</strong><span>Apply the next style or radius everywhere</span></div><button class="switch" id="link-corners" type="button" role="switch" aria-checked="false"><span></span></button></div>
              <div class="selected-corner-row"><div><span>Selected corner</span><strong id="selected-corner-name"></strong></div><output id="corner-output"></output></div>
              <div class="corner-mode-selector" role="group"><button type="button" data-corner-mode="rounded"><span class="mode-icon mode-rounded"></span>Rounded</button><button type="button" data-corner-mode="chamfer"><span class="mode-icon mode-chamfer"></span>Flat pane</button><button type="button" data-corner-mode="square"><span class="mode-icon mode-square"></span>Square</button></div>
              <div id="corner-radius-control" class="corner-radius-pair"><input class="corner-range" id="corner-range" type="range" min="0.002" max="2" step="0.01" /><div class="number-wrap"><input id="corner-number" type="number" min="0.001" step="0.01" /><span>m</span></div></div>
              <div class="corner-values" id="corner-values"></div>
            </div>
            <p class="section-note" id="corner-compat-note"></p>
            ${rangeMarkup('curveSegments')}
          `)}
        </section>

        <section class="tab-pane" data-tab-panel="profile" hidden>
          ${card('Vertical profile', 'Change how the selected footprint is built vertically', `
            <div class="mode-grid profile-grid" role="group">
              <button type="button" data-profile="standard"><strong>Standard</strong><small>Freestanding public aquarium</small></button>
              <button type="button" data-profile="belowFloor"><strong>Below floor</strong><small>Opaque body below Z = 0</small></button>
              <button type="button" data-profile="touchPool"><strong>Touch pool</strong><small>True shallow opaque basin</small></button>
            </div><p class="section-note" id="profile-note"></p>
          `)}
          <div id="standard-profile-section">${card('Standard structure', 'Slim base and clear acrylic walls', `${rangeMarkup('baseHeight')}${rangeMarkup('bottomRimHeight')}${rangeMarkup('topRimHeight')}${rangeMarkup('glassThickness')}`)}</div>
          <div id="below-profile-section">${card('Below-floor structure', 'Vertical dimensions live in Shape; this section controls the floor transition', `${rangeMarkup('floorRimHeight')}${colorMarkup('subFloorBodyColor', 'Sub-floor body')}${rangeMarkup('glassThickness')}`)}</div>
          <div id="touch-profile-section">${card('Touch pool basin', 'No acrylic wall: an opaque shallow basin with a broad reach rim', `${rangeMarkup('touchWaterDepth')}${rangeMarkup('touchRimWidth')}${rangeMarkup('touchRimHeight')}${rangeMarkup('touchBasinInset')}${rangeMarkup('touchPedestalHeight')}`)}</div>
          ${card('Shared structure', 'Advanced footprint-to-frame spacing', `${rangeMarkup('baseOverhang')}${rangeMarkup('frameOverhang')}${rangeMarkup('frameOverlap')}`)}
        </section>

        <section class="tab-pane" data-tab-panel="tunnel" hidden>
          ${card('Walk-through tunnel', 'Works in rectangle, L, and U tanks; move it into the arm you want to cross', `
            <div class="feature-toggle-card"><div><strong>Enable tunnel</strong><span id="tunnel-availability"></span></div><button class="switch switch-large" id="tunnel-enabled" type="button" role="switch"><span></span></button></div>
            <div class="tunnel-editor" id="tunnel-editor">
              <div class="tunnel-axis-selector"><button type="button" data-tunnel-axis="depth"><svg viewBox="0 0 24 24"><path d="M12 3v18m-4-4 4 4 4-4M8 7l4-4 4 4" /></svg><span><strong>Front ↔ Back</strong><small>Depth axis</small></span></button><button type="button" data-tunnel-axis="width"><svg viewBox="0 0 24 24"><path d="M3 12h18m-4-4 4 4-4 4M7 8l-4 4 4 4" /></svg><span><strong>Left ↔ Right</strong><small>Width axis</small></span></button></div>
              <div class="tunnel-direction"><span id="tunnel-entrance-label"></span><svg viewBox="0 0 42 14"><path d="M2 7h36m-5-4 5 4-5 4" /></svg><span id="tunnel-exit-label"></span></div>
              <div class="tunnel-preview-wrap"><svg id="tunnel-preview" viewBox="0 0 240 132"><rect class="tunnel-water-background" x="12" y="12" width="216" height="104" rx="8"></rect><path id="tunnel-preview-water" class="tunnel-preview-water"></path><path id="tunnel-preview-outer" class="tunnel-preview-outer"></path><path id="tunnel-preview-inner" class="tunnel-preview-inner"></path><line class="tunnel-ground-guide" x1="20" y1="112" x2="220" y2="112"></line></svg><div class="tunnel-off-message"><strong>Tunnel is off</strong><span>Enable it to edit the passage.</span></div></div>
              ${rangeMarkup('tunnelWidth')}${rangeMarkup('tunnelOffset')}${rangeMarkup('tunnelWallHeight')}
              <div class="tunnel-shape-presets"><button type="button" data-tunnel-shape="square"><span class="tunnel-shape-icon shape-square"></span><strong>Square</strong></button><button type="button" data-tunnel-shape="soft"><span class="tunnel-shape-icon shape-soft"></span><strong>Soft</strong></button><button type="button" data-tunnel-shape="arch"><span class="tunnel-shape-icon shape-arch"></span><strong>Arch</strong></button></div>
              ${rangeMarkup('tunnelRoundness')}
              <div class="below-tunnel-options" id="below-tunnel-options"><div class="toggle-row"><div><strong>Acrylic bridge floor</strong><span>The aquarium and substrate continue beneath the walkable glass bridge</span></div><button class="switch" id="tunnel-glass-floor" type="button" role="switch"><span></span></button></div>${rangeMarkup('tunnelSideRimWidth')}${rangeMarkup('tunnelBridgeRimHeight')}${rangeMarkup('tunnelBridgeSeparatorSpacing')}${rangeMarkup('tunnelBridgeSeparatorWidth')}<p class="section-note">Slim cross strips divide the glass into readable floor panels while keeping the view below open.</p></div>
              <details class="advanced-block"><summary>Advanced tunnel geometry</summary>${rangeMarkup('tunnelGlassThickness')}${rangeMarkup('tunnelCurveSegments')}${rangeMarkup('tunnelEndExtension')}${rangeMarkup('portalFrameWidth')}${rangeMarkup('portalFrameDepth')}${rangeMarkup('tunnelWaterClearance')}</details>
              <p class="section-note">On concave footprints, the passage uses the continuous arm under its center. If it enters an opening, move or narrow it until the preview updates.</p>
            </div>
          `)}
        </section>

        <section class="tab-pane" data-tab-panel="water" hidden>
          ${card('Water surface', 'Start with a visual preset, then tune its definition', `<div class="water-style-presets"><button type="button" data-water-preset="calm"><span class="water-swatch water-calm"></span><strong>Calm</strong><small>Broad and quiet</small></button><button type="button" data-water-preset="realistic"><span class="water-swatch water-realistic"></span><strong>Realistic</strong><small>Fine natural ripples</small></button><button type="button" data-water-preset="balanced"><span class="water-swatch water-balanced"></span><strong>Balanced</strong><small>Readable game water</small></button><button type="button" data-water-preset="cartoon"><span class="water-swatch water-cartoon"></span><strong>Cartoon</strong><small>Graphic highlights</small></button><button type="button" data-water-preset="pixel"><span class="water-swatch water-pixel"></span><strong>Pixel</strong><small>Blocky stepped waves</small></button></div>${colorMarkup('waterColor', 'Water color')}${rangeMarkup('waterTint')}${rangeMarkup('waterSurfaceStyle')}${rangeMarkup('waveStrength')}${rangeMarkup('waterWaveScale')}`)}
          ${card('Water placement', 'The touch-pool depth is controlled in Profile', `<div id="standard-water-level">${rangeMarkup('waterLevel')}</div>`)}
        </section>

        <section class="tab-pane" data-tab-panel="ground" hidden>
          ${card('Ground material', 'Choose a starting substrate, then fine-tune it', `<div class="ground-presets"><button type="button" data-ground-preset="sand"><strong>Sand</strong><small>Warm and soft</small></button><button type="button" data-ground-preset="dirt"><strong>Dirt</strong><small>Dark organic soil</small></button><button type="button" data-ground-preset="algae"><strong>Algae</strong><small>Muted green growth</small></button><button type="button" data-ground-preset="gravel"><strong>Gravel</strong><small>Coarse mixed stones</small></button></div>${colorMarkup('sandColor', 'Ground color')}${rangeMarkup('sandVariation')}${rangeMarkup('sandGrain')}`)}
          ${card('Floor shape', 'Real mesh deformation creates low mounds without visible giant triangles', `${rangeMarkup('groundIrregularity')}${rangeMarkup('groundMoundSize')}${rangeMarkup('groundMoundCount')}${rangeMarkup('groundTerrainDetail')}<div class="action-row"><button class="button button-quiet" id="randomize-ground" type="button">New terrain seed</button></div>`)}
        </section>

      </div>`;
  }

  private bind(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => button.addEventListener('click', () => { this.activeTab = button.dataset.tab as PanelTab; this.refreshTabs(); }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-footprint]').forEach((button) => button.addEventListener('click', () => {
      this.settings.footprint = button.dataset.footprint as FootprintType;
      normalizeSettings(this.settings);
      this.ensureSelectedCorner();
      this.refresh();
      this.callbacks.onChange(this.settings, true);
    }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-profile]').forEach((button) => button.addEventListener('click', () => {
      this.settings.profile = button.dataset.profile as AquariumProfile;
      normalizeSettings(this.settings);
      this.refresh();
      this.callbacks.onChange(this.settings, true);
    }));

    this.root.querySelectorAll<HTMLInputElement>('[data-range-key]').forEach((input) => input.addEventListener('input', () => this.applyNumeric(input.dataset.rangeKey as keyof AquariumSettings, input.value)));
    this.root.querySelectorAll<HTMLInputElement>('[data-number-key]').forEach((input) => input.addEventListener('change', () => this.applyNumeric(input.dataset.numberKey as keyof AquariumSettings, input.value)));
    this.root.querySelectorAll<HTMLInputElement>('[data-color-key]').forEach((input) => input.addEventListener('input', () => this.applyColor(input.dataset.colorKey as 'waterColor' | 'sandColor' | 'subFloorBodyColor', input.value)));
    this.root.querySelectorAll<HTMLInputElement>('[data-color-text-key]').forEach((input) => input.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(input.value)) this.applyColor(input.dataset.colorTextKey as 'waterColor' | 'sandColor' | 'subFloorBodyColor', input.value); else this.refresh(); }));

    this.root.querySelector<HTMLInputElement>('#corner-range')!.addEventListener('input', (event) => {
      const value = Number.parseFloat((event.target as HTMLInputElement).value);
      const targets = this.linkCorners ? this.activeCornerKeys() : [this.selectedCorner];
      for (const key of targets) this.setCornerRadius(key, value);
      normalizeSettings(this.settings);
      this.refreshCornerEditor();
      this.callbacks.onChange(this.settings, true);
    });
    this.root.querySelector<HTMLInputElement>('#corner-number')!.addEventListener('change', (event) => {
      const value = Number.parseFloat((event.target as HTMLInputElement).value);
      if (!Number.isFinite(value) || value <= 0) { this.refreshCornerEditor(); return; }
      const targets = this.linkCorners ? this.activeCornerKeys() : [this.selectedCorner];
      for (const key of targets) this.setCornerRadius(key, value);
      normalizeSettings(this.settings);
      this.refreshCornerEditor();
      this.callbacks.onChange(this.settings, true);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-corner-mode]').forEach((button) => button.addEventListener('click', () => {
      const mode = button.dataset.cornerMode as CornerMode;
      const targets = this.linkCorners ? this.activeCornerKeys() : [this.selectedCorner];
      for (const key of targets) this.setCornerMode(key, mode);
      normalizeSettings(this.settings);
      this.refreshCornerEditor();
      this.callbacks.onChange(this.settings, true);
    }));
    this.root.querySelector<HTMLButtonElement>('#link-corners')!.addEventListener('click', () => { this.linkCorners = !this.linkCorners; this.refreshCornerEditor(); });
    this.root.querySelectorAll<HTMLButtonElement>('[data-corner-preset]').forEach((button) => button.addEventListener('click', () => {
      const preset = button.dataset.cornerPreset;
      const keys = this.activeCornerKeys();
      for (const key of keys) {
        const inside = String(key).includes('Inner') || key === 'lInnerElbow';
        this.setCornerMode(key, preset === 'square' ? 'square' : 'rounded');
        this.setCornerRadius(key, preset === 'soft' ? (inside ? 0.72 : 0.48) : preset === 'balanced' ? (inside ? 0.48 : 0.3) : 0.002);
      }
      normalizeSettings(this.settings);
      this.refreshCornerEditor();
      this.callbacks.onChange(this.settings, true);
    }));

    this.root.querySelector<HTMLButtonElement>('#tunnel-enabled')!.addEventListener('click', () => {
      if (!tunnelAllowed(this.settings)) return;
      this.settings.tunnelEnabled = !this.settings.tunnelEnabled;
      this.refresh();
      this.callbacks.onChange(this.settings, true);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-tunnel-axis]').forEach((button) => button.addEventListener('click', () => {
      this.settings.tunnelAxis = button.dataset.tunnelAxis as TunnelAxis;
      this.settings.tunnelOffset = 0;
      normalizeSettings(this.settings);
      this.refresh();
      this.callbacks.onChange(this.settings, true);
    }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-tunnel-shape]').forEach((button) => button.addEventListener('click', () => {
      this.settings.tunnelRoundness = button.dataset.tunnelShape === 'square' ? 0 : button.dataset.tunnelShape === 'soft' ? 0.48 : 0.88;
      this.refresh();
      this.callbacks.onChange(this.settings, true);
    }));
    this.root.querySelector<HTMLButtonElement>('#tunnel-glass-floor')!.addEventListener('click', () => { this.settings.tunnelGlassFloor = !this.settings.tunnelGlassFloor; this.refreshTunnelEditor(); this.callbacks.onChange(this.settings, true); });

    this.root.querySelectorAll<HTMLButtonElement>('[data-ground-preset]').forEach((button) => button.addEventListener('click', () => {
      const preset = button.dataset.groundPreset as GroundPreset;
      const values = GROUND_PRESETS[preset];
      this.settings.groundPreset = preset;
      this.settings.sandColor = values.color;
      this.settings.sandVariation = values.variation;
      this.settings.sandGrain = values.grain;
      this.settings.groundIrregularity = values.irregularity;
      this.settings.groundMoundSize = values.moundSize;
      this.refresh();
      this.callbacks.onChange(this.settings, true);
    }));
    this.root.querySelector<HTMLButtonElement>('#randomize-ground')!.addEventListener('click', () => { this.settings.sandSeed = Math.floor(Math.random() * 1_000_000); this.callbacks.onChange(this.settings, true); });
    this.root.querySelectorAll<HTMLButtonElement>('[data-water-preset]').forEach((button) => button.addEventListener('click', () => {
      const preset = button.dataset.waterPreset as WaterSurfacePreset;
      this.settings.waterSurfacePreset = preset;
      if (preset === 'calm') { this.settings.waterSurfaceStyle = 0.08; this.settings.waveStrength = 0.12; this.settings.waterWaveScale = 0.18; }
      else if (preset === 'realistic') { this.settings.waterSurfaceStyle = 0.18; this.settings.waveStrength = 0.32; this.settings.waterWaveScale = 0.74; }
      else if (preset === 'balanced') { this.settings.waterSurfaceStyle = 0.5; this.settings.waveStrength = 0.55; this.settings.waterWaveScale = 0.48; }
      else if (preset === 'cartoon') { this.settings.waterSurfaceStyle = 0.9; this.settings.waveStrength = 0.82; this.settings.waterWaveScale = 0.24; }
      else { this.settings.waterSurfaceStyle = 0.96; this.settings.waveStrength = 0.72; this.settings.waterWaveScale = 0.58; }
      this.refresh();
      this.callbacks.onChange(this.settings, false);
    }));

    document.querySelector<HTMLInputElement>('#export-scale-number')!.addEventListener('change', (event) => {
      const value = Number.parseFloat((event.target as HTMLInputElement).value);
      if (Number.isFinite(value) && value > 0) this.settings.exportScale = value;
      normalizeSettings(this.settings);
      this.refresh();
      this.callbacks.onChange(this.settings, false);
    });

    document.querySelector<HTMLButtonElement>('#reset-button')!.addEventListener('click', () => { const defaults = cloneSettings(DEFAULT_SETTINGS); this.settings = defaults; this.callbacks.onReset(defaults); this.ensureSelectedCorner(); this.refresh(); });
    document.querySelector<HTMLButtonElement>('#share-button')!.addEventListener('click', this.callbacks.onShare);
    document.querySelector<HTMLButtonElement>('#download-button')!.addEventListener('click', this.callbacks.onDownload);
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.addEventListener('click', () => {
      const view = button.dataset.view as 'iso' | 'front' | 'side' | 'top' | 'fit';
      this.callbacks.onView(view);
      if (view !== 'fit') { document.querySelectorAll('[data-view]').forEach((item) => item.classList.remove('is-active')); button.classList.add('is-active'); }
    }));
  }

  private applyNumeric(key: keyof AquariumSettings, raw: string): void {
    const definition = RANGE_DEFINITIONS.find((item) => item.key === key);
    if (!definition) return;
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return;

    // Opening controls are direct views of the same dimensions used by the arm
    // controls. Keep both representations synchronized so either can be edited.
    if (key === 'lOpeningWidth') this.settings.lArmWidth = this.settings.width - value;
    else if (key === 'lOpeningDepth') this.settings.lRearDepth = this.settings.depth - value;
    else if (key === 'uOpeningWidth') {
      const offset = this.settings.uOpeningOffset;
      const totalArms = this.settings.width - value;
      this.settings.uLeftArmWidth = totalArms * 0.5 + offset;
      this.settings.uRightArmWidth = totalArms * 0.5 - offset;
    } else if (key === 'uOpeningDepth') this.settings.uBackDepth = this.settings.depth - value;
    else if (key === 'uOpeningOffset') {
      const halfArms = (this.settings.width - this.settings.uOpeningWidth) * 0.5;
      this.settings.uLeftArmWidth = halfArms + value;
      this.settings.uRightArmWidth = halfArms - value;
    } else {
      (this.settings as unknown as Record<string, number>)[key] = value;
    }

    normalizeSettings(this.settings);
    this.refresh();
    this.callbacks.onChange(this.settings, Boolean(definition.structural));
  }

  private applyColor(key: 'waterColor' | 'sandColor' | 'subFloorBodyColor', value: string): void {
    this.settings[key] = value.toLowerCase();
    this.refresh();
    this.callbacks.onChange(this.settings, false);
  }

  private formatValue(definition: RangeDefinition, value: number): string {
    if (definition.format) return definition.format(value);
    const decimals = definition.step < 0.01 ? 3 : definition.step < 0.1 ? 2 : 1;
    return `${value.toFixed(decimals)}${definition.unit ? ` ${definition.unit}` : ''}`;
  }

  private refresh(): void {
    const tunnelCrossDimension = this.settings.tunnelAxis === 'depth' ? this.settings.width : this.settings.depth;
    const maxTunnelWidth = Math.max(0.9, tunnelCrossDimension - 0.5);
    const tunnelEdgeMargin = this.settings.glassThickness + this.settings.portalFrameWidth + this.settings.tunnelGlassThickness + 0.12;
    const maxTunnelOffset = Math.max(0, tunnelCrossDimension * 0.5 - this.settings.tunnelWidth * 0.5 - tunnelEdgeMargin);
    const activeVerticalHeight = this.settings.profile === 'belowFloor' ? this.settings.heightAboveFloor : this.settings.profile === 'touchPool' ? this.settings.touchPoolHeight : this.settings.height;

    for (const definition of RANGE_DEFINITIONS) {
      const value = Number((this.settings as unknown as Record<string, number>)[definition.key]);
      const range = this.root.querySelector<HTMLInputElement>(`[data-range-key="${definition.key}"]`);
      const number = this.root.querySelector<HTMLInputElement>(`[data-number-key="${definition.key}"]`);
      const output = this.root.querySelector<HTMLOutputElement>(`#${definition.key}-output`);
      if (range) {
        if (definition.key === 'tunnelWidth') range.max = String(maxTunnelWidth);
        if (definition.key === 'tunnelOffset') { range.min = String(-maxTunnelOffset); range.max = String(maxTunnelOffset); }
        if (definition.key === 'tunnelWallHeight') range.max = String(Math.max(0.45, activeVerticalHeight * 0.65));
        const sliderMin = Number.parseFloat(range.min);
        const sliderMax = Number.parseFloat(range.max);
        range.value = String(THREE.MathUtils.clamp(value, sliderMin, sliderMax));
        range.closest('.control-row')?.classList.toggle('is-beyond-slider', value < sliderMin - 1e-9 || value > sliderMax + 1e-9);
      }
      if (number) number.value = String(Number(value.toFixed(3)));
      if (output) output.textContent = this.formatValue(definition, value);
    }

    for (const key of ['waterColor', 'sandColor', 'subFloorBodyColor'] as const) {
      this.root.querySelector<HTMLInputElement>(`[data-color-key="${key}"]`)!.value = this.settings[key];
      this.root.querySelector<HTMLInputElement>(`[data-color-text-key="${key}"]`)!.value = this.settings[key].toUpperCase();
    }

    this.refreshTabs();
    this.refreshProfileAndFootprint();
    this.refreshCornerEditor();
    this.refreshGroundPreset();
    this.refreshWaterStyle();
    this.refreshTunnelEditor();
    const exportedHeight = this.settings.profile === 'belowFloor'
      ? this.settings.heightAboveFloor + this.settings.depthBelowFloor
      : this.settings.profile === 'touchPool' ? this.settings.touchPoolHeight : this.settings.height;
    const scaleInput = document.querySelector<HTMLInputElement>('#export-scale-number');
    if (scaleInput) scaleInput.value = String(Number(this.settings.exportScale.toFixed(3)));
    const dimensions = document.querySelector<HTMLElement>('#footer-export-dimensions');
    if (dimensions) dimensions.textContent = `${(this.settings.width * this.settings.exportScale).toFixed(1)} × ${(this.settings.depth * this.settings.exportScale).toFixed(1)} × ${(exportedHeight * this.settings.exportScale).toFixed(1)} units`;
  }

  private refreshTabs(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === this.activeTab));
    this.root.querySelectorAll<HTMLElement>('[data-tab-panel]').forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== this.activeTab; });
  }

  private refreshProfileAndFootprint(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-profile]').forEach((button) => button.classList.toggle('is-active', button.dataset.profile === this.settings.profile));
    this.root.querySelectorAll<HTMLButtonElement>('[data-footprint]').forEach((button) => button.classList.toggle('is-active', button.dataset.footprint === this.settings.footprint));
    const below = this.settings.profile === 'belowFloor';
    const touch = this.settings.profile === 'touchPool';
    this.root.querySelector<HTMLElement>('#shape-standard-height')!.hidden = below || touch;
    this.root.querySelector<HTMLElement>('#shape-below-heights')!.hidden = !below;
    this.root.querySelector<HTMLElement>('#shape-touch-height')!.hidden = !touch;
    this.root.querySelector<HTMLElement>('#standard-profile-section')!.hidden = below || touch;
    this.root.querySelector<HTMLElement>('#below-profile-section')!.hidden = !below;
    this.root.querySelector<HTMLElement>('#touch-profile-section')!.hidden = !touch;
    this.root.querySelector<HTMLElement>('#l-shape-options')!.hidden = this.settings.footprint !== 'lShape';
    this.root.querySelector<HTMLElement>('#u-shape-options')!.hidden = this.settings.footprint !== 'uShape';
    this.root.querySelector<HTMLElement>('#standard-water-level')!.hidden = touch;

    const note = this.root.querySelector<HTMLElement>('#profile-note')!;
    if (below) note.textContent = 'Above- and below-floor dimensions are in Shape. No floor polygon is exported; the game floor owns Z = 0.';
    else if (touch) note.textContent = 'A true opaque basin with no acrylic side wall. The default total height is 0.50 m.';
    else note.textContent = 'Freestanding aquarium with a slim base, clear acrylic shell, and open top.';
    this.root.querySelector<HTMLElement>('#corner-compat-note')!.textContent = 'The same rounded contour drives the rims, acrylic, water, ground, and tunnel cuts— including concave inside corners.';
  }

  private refreshGroundPreset(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-ground-preset]').forEach((button) => button.classList.toggle('is-active', button.dataset.groundPreset === this.settings.groundPreset));
  }

  private refreshWaterStyle(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-water-preset]').forEach((button) => button.classList.toggle('is-active', button.dataset.waterPreset === this.settings.waterSurfacePreset));
  }

  private refreshTunnelEditor(): void {
    const allowed = tunnelAllowed(this.settings);
    const button = this.root.querySelector<HTMLButtonElement>('#tunnel-enabled')!;
    button.disabled = !allowed;
    button.setAttribute('aria-checked', String(this.settings.tunnelEnabled && allowed));
    button.classList.toggle('is-on', this.settings.tunnelEnabled && allowed);
    this.root.querySelector<HTMLElement>('#tunnel-availability')!.textContent = allowed
      ? `Cuts through the active ${this.settings.footprint === 'rectangle' ? 'tank' : 'continuous arm'} at the selected position`
      : 'Touch pools are shallow open basins, so tunnels are disabled';
    this.root.querySelector<HTMLElement>('#tunnel-editor')!.classList.toggle('is-disabled', !this.settings.tunnelEnabled || !allowed);
    this.root.querySelectorAll<HTMLButtonElement>('[data-tunnel-axis]').forEach((axisButton) => axisButton.classList.toggle('is-active', axisButton.dataset.tunnelAxis === this.settings.tunnelAxis));
    this.root.querySelector<HTMLElement>('#below-tunnel-options')!.hidden = this.settings.profile !== 'belowFloor';
    const glassFloorButton = this.root.querySelector<HTMLButtonElement>('#tunnel-glass-floor')!;
    glassFloorButton.setAttribute('aria-checked', String(this.settings.tunnelGlassFloor));
    glassFloorButton.classList.toggle('is-on', this.settings.tunnelGlassFloor);
    const depthAxis = this.settings.tunnelAxis === 'depth';
    this.root.querySelector<HTMLElement>('#tunnel-entrance-label')!.innerHTML = depthAxis ? '<b>01</b> Entrance · Front' : '<b>01</b> Entrance · Left';
    this.root.querySelector<HTMLElement>('#tunnel-exit-label')!.innerHTML = depthAxis ? '<b>02</b> Exit · Back' : '<b>02</b> Exit · Right';

    const offsetControl = this.root.querySelector<HTMLElement>('[data-control="tunnelOffset"]')!;
    offsetControl.querySelector<HTMLLabelElement>('label')!.textContent = depthAxis ? 'Left / right position' : 'Front / back position';
    const output = this.root.querySelector<HTMLOutputElement>('#tunnelOffset-output')!;
    const offset = this.settings.tunnelOffset;
    if (Math.abs(offset) < 0.025) output.textContent = 'Centered';
    else if (depthAxis) output.textContent = `${Math.abs(offset).toFixed(2)} m ${offset > 0 ? 'right' : 'left'}`;
    else output.textContent = `${Math.abs(offset).toFixed(2)} m ${offset > 0 ? 'front' : 'back'}`;

    const selectedShape = this.settings.tunnelRoundness <= 0.015 ? 'square' : this.settings.tunnelRoundness < 0.7 ? 'soft' : 'arch';
    this.root.querySelectorAll<HTMLButtonElement>('[data-tunnel-shape]').forEach((shapeButton) => shapeButton.classList.toggle('is-active', shapeButton.dataset.tunnelShape === selectedShape));

    const width = 240;
    const floorY = 112;
    const centerX = width * 0.5;
    const half = Math.min(72, 28 + this.settings.tunnelWidth * 11);
    const wallPixels = Math.min(62, 18 + this.settings.tunnelWallHeight * 22);
    const squareRoof = this.settings.tunnelRoundness <= 0.015;
    const risePixels = squareRoof ? 0 : Math.min(55, half * 0.52 * this.settings.tunnelRoundness);
    const springY = floorY - wallPixels;
    const thickness = Math.max(4, this.settings.tunnelGlassThickness * 55);
    const innerLeft = centerX - half;
    const innerRight = centerX + half;
    const outerLeft = innerLeft - thickness;
    const outerRight = innerRight + thickness;
    const innerCrown = springY - risePixels;
    const outerCrown = innerCrown - thickness;
    let innerPath: string;
    let outerPath: string;
    let waterPath: string;
    if (squareRoof) {
      innerPath = `M ${innerLeft} ${floorY} V ${springY} H ${innerRight} V ${floorY}`;
      outerPath = `M ${outerLeft} ${floorY} V ${outerCrown} H ${outerRight} V ${floorY}`;
      waterPath = `M 12 12 H 228 V 116 H ${outerRight} V ${outerCrown} H ${outerLeft} V 116 H 12 Z`;
    } else {
      innerPath = `M ${innerLeft} ${floorY} L ${innerLeft} ${springY} Q ${centerX} ${innerCrown - risePixels * 0.35} ${innerRight} ${springY} L ${innerRight} ${floorY}`;
      outerPath = `M ${outerLeft} ${floorY} L ${outerLeft} ${springY} Q ${centerX} ${outerCrown - risePixels * 0.35} ${outerRight} ${springY} L ${outerRight} ${floorY}`;
      waterPath = `M 12 12 H 228 V 116 H ${outerRight} V ${springY} Q ${centerX} ${outerCrown - risePixels * 0.35} ${outerLeft} ${springY} V 116 H 12 Z`;
    }
    this.root.querySelector<SVGPathElement>('#tunnel-preview-inner')!.setAttribute('d', innerPath);
    this.root.querySelector<SVGPathElement>('#tunnel-preview-outer')!.setAttribute('d', outerPath);
    this.root.querySelector<SVGPathElement>('#tunnel-preview-water')!.setAttribute('d', waterPath);
  }

  private rawCornerAnchors(): Array<{ key: SelectedCorner; point: THREE.Vector2 }> {
    const w = this.settings.width;
    const d = this.settings.depth;
    const left = -w * 0.5;
    const right = w * 0.5;
    const back = -d * 0.5;
    const front = d * 0.5;
    if (this.settings.footprint === 'rectangle') return [
      { key: 'backLeft', point: new THREE.Vector2(left, back) },
      { key: 'backRight', point: new THREE.Vector2(right, back) },
      { key: 'frontRight', point: new THREE.Vector2(right, front) },
      { key: 'frontLeft', point: new THREE.Vector2(left, front) },
    ];
    if (this.settings.footprint === 'lShape') return [
      { key: 'lBackLeft', point: new THREE.Vector2(left, back) },
      { key: 'lBackRight', point: new THREE.Vector2(right, back) },
      { key: 'lOuterRight', point: new THREE.Vector2(right, back + this.settings.lRearDepth) },
      { key: 'lInnerElbow', point: new THREE.Vector2(left + this.settings.lArmWidth, back + this.settings.lRearDepth) },
      { key: 'lFrontRight', point: new THREE.Vector2(left + this.settings.lArmWidth, front) },
      { key: 'lFrontLeft', point: new THREE.Vector2(left, front) },
    ];
    return [
      { key: 'uBackLeft', point: new THREE.Vector2(left, back) },
      { key: 'uBackRight', point: new THREE.Vector2(right, back) },
      { key: 'uFrontRight', point: new THREE.Vector2(right, front) },
      { key: 'uMouthRight', point: new THREE.Vector2(right - this.settings.uRightArmWidth, front) },
      { key: 'uInnerRight', point: new THREE.Vector2(right - this.settings.uRightArmWidth, back + this.settings.uBackDepth) },
      { key: 'uInnerLeft', point: new THREE.Vector2(left + this.settings.uLeftArmWidth, back + this.settings.uBackDepth) },
      { key: 'uMouthLeft', point: new THREE.Vector2(left + this.settings.uLeftArmWidth, front) },
      { key: 'uFrontLeft', point: new THREE.Vector2(left, front) },
    ];
  }

  private refreshCornerEditor(): void {
    this.ensureSelectedCorner();
    const maxRadius = Math.max(0.02, Math.min(this.settings.width, this.settings.depth) * 0.49);
    const range = this.root.querySelector<HTMLInputElement>('#corner-range')!;
    const mode = this.getCornerMode(this.selectedCorner);
    range.max = String(maxRadius);
    range.value = String(Math.min(maxRadius, this.getCornerRadius(this.selectedCorner)));
    range.disabled = mode === 'square';
    const cornerNumber = this.root.querySelector<HTMLInputElement>('#corner-number')!;
    cornerNumber.value = String(Number(this.getCornerRadius(this.selectedCorner).toFixed(3)));
    cornerNumber.disabled = mode === 'square';
    this.root.querySelector<HTMLElement>('#corner-radius-control')!.classList.toggle('is-disabled', mode === 'square');
    this.root.querySelector<HTMLOutputElement>('#corner-output')!.textContent = mode === 'square' ? 'Sharp' : `${this.getCornerRadius(this.selectedCorner).toFixed(2)} m`;
    this.root.querySelector<HTMLElement>('#selected-corner-name')!.textContent = this.cornerName(this.selectedCorner);
    this.root.querySelectorAll<HTMLButtonElement>('[data-corner-mode]').forEach((button) => button.classList.toggle('is-active', button.dataset.cornerMode === mode));
    const linked = this.root.querySelector<HTMLButtonElement>('#link-corners')!;
    linked.setAttribute('aria-checked', String(this.linkCorners));
    linked.classList.toggle('is-on', this.linkCorners);

    const outerWidth = this.settings.width + this.settings.frameOverhang * 2;
    const outerDepth = this.settings.depth + this.settings.frameOverhang * 2;
    const scale = Math.min(190 / outerWidth, 100 / outerDepth);
    const centerX = 120;
    const centerY = 70;
    const pathFrom = (points: THREE.Vector2[]) => `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${(centerX + point.x * scale).toFixed(2)} ${(centerY + point.y * scale).toFixed(2)}`).join(' ')} Z`;
    const body = createFootprintShapeLoop(this.settings, 0);
    const frame = createFootprintShapeLoop(this.settings, this.settings.frameOverhang);
    const water = createFootprintShapeLoop(this.settings, -(this.settings.glassThickness + this.settings.waterWallGap));
    this.root.querySelector<SVGPathElement>('#corner-preview-frame')!.setAttribute('d', pathFrom(frame));
    this.root.querySelector<SVGPathElement>('#corner-preview-path')!.setAttribute('d', pathFrom(body));
    this.root.querySelector<SVGPathElement>('#corner-preview-water')!.setAttribute('d', pathFrom(water));

    const tunnel = this.root.querySelector<SVGPathElement>('#corner-preview-tunnel')!;
    if (this.settings.tunnelEnabled) {
      const half = this.settings.tunnelWidth * 0.5 * scale;
      if (this.settings.tunnelAxis === 'depth') {
        const x = centerX + this.settings.tunnelOffset * scale;
        tunnel.setAttribute('d', `M ${x - half} ${centerY - this.settings.depth * 0.5 * scale - 7} V ${centerY + this.settings.depth * 0.5 * scale + 7} M ${x + half} ${centerY - this.settings.depth * 0.5 * scale - 7} V ${centerY + this.settings.depth * 0.5 * scale + 7}`);
      } else {
        const y = centerY + this.settings.tunnelOffset * scale;
        tunnel.setAttribute('d', `M ${centerX - this.settings.width * 0.5 * scale - 7} ${y - half} H ${centerX + this.settings.width * 0.5 * scale + 7} M ${centerX - this.settings.width * 0.5 * scale - 7} ${y + half} H ${centerX + this.settings.width * 0.5 * scale + 7}`);
      }
      tunnel.style.display = '';
    } else tunnel.style.display = 'none';

    const hotspots = this.root.querySelector<SVGGElement>('#corner-hotspots')!;
    hotspots.innerHTML = this.rawCornerAnchors().map(({ key, point }) => `<g class="corner-hotspot ${key === this.selectedCorner ? 'is-selected' : ''}" data-corner="${key}" transform="translate(${centerX + point.x * scale} ${centerY + point.y * scale})"><circle r="11"></circle><text>${cornerShortLabel(key)}</text></g>`).join('');
    hotspots.querySelectorAll<SVGGElement>('[data-corner]').forEach((element) => element.addEventListener('click', () => { this.selectedCorner = element.dataset.corner as SelectedCorner; this.refreshCornerEditor(); }));

    const values = this.root.querySelector<HTMLElement>('#corner-values')!;
    values.innerHTML = this.activeCornerKeys().map((key) => `<button type="button" data-corner-value="${key}" class="${key === this.selectedCorner ? 'is-selected' : ''}"><span>${cornerShortLabel(key)}</span><strong>${this.getCornerMode(key) === 'square' ? 'SQ' : this.getCornerRadius(key).toFixed(2)}</strong></button>`).join('');
    values.querySelectorAll<HTMLButtonElement>('[data-corner-value]').forEach((button) => button.addEventListener('click', () => { this.selectedCorner = button.dataset.cornerValue as SelectedCorner; this.refreshCornerEditor(); }));
  }
}
