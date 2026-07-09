import * as THREE from 'three';
import type { AquariumSettings, CornerMode, CornerRadii, GroundPreset, TunnelAxis } from '../model/settings';
import { cloneSettings, DEFAULT_SETTINGS, normalizeSettings } from '../model/settings';
import { createFootprintLoop, offsetRadii } from '../model/aquarium';

export type SelectedCorner = keyof CornerRadii;
type PanelTab = 'tank' | 'shape' | 'water' | 'tunnel' | 'details';

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
const surfaceLabel = (value: number) => value < 0.34 ? 'Realistic' : value < 0.67 ? 'Balanced' : 'Cartoon';
const tunnelShapeLabel = (value: number) => value <= 0.015 ? 'Square' : value < 0.55 ? 'Soft arch' : value < 0.98 ? 'Round arch' : 'Tall arch';

const GROUND_PRESETS: Record<GroundPreset, { color: string; variation: number; grain: number }> = {
  sand: { color: '#c8ad79', variation: 0.22, grain: 0.52 },
  dirt: { color: '#76533a', variation: 0.44, grain: 0.78 },
  algae: { color: '#687a49', variation: 0.52, grain: 0.92 },
  gravel: { color: '#888279', variation: 0.58, grain: 1.45 },
};

const RANGE_DEFINITIONS: RangeDefinition[] = [
  { key: 'width', label: 'Width', min: 2, max: 30, step: 0.1, unit: 'm', structural: true },
  { key: 'depth', label: 'Depth', min: 1, max: 15, step: 0.1, unit: 'm', structural: true },
  { key: 'height', label: 'Height', min: 1, max: 12, step: 0.1, unit: 'm', structural: true },
  { key: 'waterLevel', label: 'Water level', min: 0.2, max: 0.97, step: 0.01, structural: true, format: percent },
  { key: 'waterTint', label: 'Side tint', min: 0, max: 1, step: 0.01, format: percent },
  { key: 'waveStrength', label: 'Wave definition', min: 0, max: 1, step: 0.01, format: percent },
  { key: 'waterSurfaceStyle', label: 'Surface character', min: 0, max: 1, step: 0.01, format: surfaceLabel },
  { key: 'waterWaveScale', label: 'Wave size', min: 0, max: 1, step: 0.01, format: (value) => value < 0.34 ? 'Broad' : value < 0.67 ? 'Medium' : 'Fine' },
  { key: 'sandVariation', label: 'Color variation', min: 0, max: 1, step: 0.01, format: percent },
  { key: 'sandGrain', label: 'Grain scale', min: 0.1, max: 2.5, step: 0.05, format: (value) => value.toFixed(2) },
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
  { key: 'exportScale', label: 'Units per meter', min: 1, max: 100, step: 1, format: (value) => `${Math.round(value)}×` },
];

function rangeMarkup(id: string): string {
  const definition = RANGE_DEFINITIONS.find((item) => item.key === id);
  if (!definition) throw new Error(`Missing range definition: ${id}`);
  return `
    <div class="control-row" data-control="${definition.key}">
      <div class="control-label-row">
        <label for="${definition.key}-range">${definition.label}</label>
        <output id="${definition.key}-output"></output>
      </div>
      <div class="range-pair">
        <input id="${definition.key}-range" data-range-key="${definition.key}" type="range" min="${definition.min}" max="${definition.max}" step="${definition.step}" />
        <div class="number-wrap">
          <input id="${definition.key}-number" data-number-key="${definition.key}" type="number" min="${definition.min}" max="${definition.max}" step="${definition.step}" />
          ${definition.unit ? `<span>${definition.unit}</span>` : ''}
        </div>
      </div>
    </div>`;
}

function colorMarkup(key: 'waterColor' | 'sandColor', label: string): string {
  return `
    <div class="color-row">
      <label for="${key}-color">${label}</label>
      <div class="color-control">
        <input id="${key}-color" data-color-key="${key}" type="color" />
        <input id="${key}-text" data-color-text-key="${key}" type="text" maxlength="7" spellcheck="false" />
      </div>
    </div>`;
}

function card(title: string, subtitle: string, content: string, className = ''): string {
  return `<section class="settings-card ${className}"><header><strong>${title}</strong><span>${subtitle}</span></header><div class="settings-card-body">${content}</div></section>`;
}

export class ControlPanel {
  private settings: AquariumSettings;
  private readonly root: HTMLElement;
  private readonly callbacks: PanelCallbacks;
  private selectedCorner: SelectedCorner = 'frontLeft';
  private linkCorners = false;
  private activeTab: PanelTab = 'tank';

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
    this.refresh();
  }

  private render(): void {
    const tabs: Array<[PanelTab, string, string]> = [
      ['tank', 'Tank', 'M4 5h16v14H4zM4 13c4-2 7 2 11 0 2-1 4-1 5 0'],
      ['shape', 'Corners', 'M5 19V9a4 4 0 0 1 4-4h10v14Z'],
      ['water', 'Water', 'M3 15c3-3 6 3 9 0s6 3 9 0M4 9c3-3 5 2 8 0s5 3 8 0'],
      ['tunnel', 'Tunnel', 'M4 19V11a8 8 0 0 1 16 0v8M8 19v-8a4 4 0 0 1 8 0v8'],
      ['details', 'Details', 'M4 7h16M4 12h16M4 17h16M8 5v4m8 1v4m-6 1v4'],
    ];

    this.root.innerHTML = `
      <nav class="panel-tabs" aria-label="Aquarium editor sections">
        ${tabs.map(([id, label, icon]) => `<button type="button" data-tab="${id}" class="${id === this.activeTab ? 'is-active' : ''}"><svg viewBox="0 0 24 24"><path d="${icon}" /></svg><span>${label}</span></button>`).join('')}
      </nav>
      <div class="tab-stage">
        <section class="tab-pane" data-tab-panel="tank">
          ${card('Tank size', 'Authored dimensions in meters', `${rangeMarkup('width')}${rangeMarkup('depth')}${rangeMarkup('height')}<p class="section-note">The preview stays in meters. The game-unit scale is only applied to the downloaded GLB.</p>`)}
          ${card('Ground', 'Choose a ready-made substrate, then fine-tune it', `
            <div class="ground-presets" role="group" aria-label="Ground material presets">
              <button type="button" data-ground-preset="sand"><span class="ground-swatch ground-sand"></span><strong>Sand</strong><small>Warm and clean</small></button>
              <button type="button" data-ground-preset="dirt"><span class="ground-swatch ground-dirt"></span><strong>Dirt</strong><small>Dark and natural</small></button>
              <button type="button" data-ground-preset="algae"><span class="ground-swatch ground-algae"></span><strong>Algae</strong><small>Organic green</small></button>
              <button type="button" data-ground-preset="gravel"><span class="ground-swatch ground-gravel"></span><strong>Gravel</strong><small>Coarse stones</small></button>
            </div>
            ${colorMarkup('sandColor', 'Ground color')}${rangeMarkup('sandVariation')}${rangeMarkup('sandGrain')}
            <button class="secondary-action" id="randomize-sand" type="button"><svg viewBox="0 0 24 24"><path d="M4 7h3l10 10h3M4 17h3l3-3m4-4 3-3h3m0 0-2-2m2 2-2 2m2 8-2-2m2 2-2 2" /></svg>Randomize pattern</button>
          `)}
        </section>

        <section class="tab-pane" data-tab-panel="shape" hidden>
          ${card('Corner designer', 'Each corner can be rounded, faceted, or square', `
            <div class="corner-editor">
              <div class="corner-canvas-wrap">
                <svg id="corner-preview" viewBox="0 0 240 150" role="img" aria-label="Interactive top view of the aquarium footprint">
                  <path id="corner-preview-frame" class="corner-preview-frame"></path>
                  <path id="corner-preview-path" class="corner-preview-body"></path>
                  <path id="corner-preview-water" class="corner-preview-water"></path>
                  <path id="corner-preview-tunnel" class="corner-preview-tunnel"></path>
                  <g class="corner-hotspot" data-corner="backLeft"><circle r="12"></circle><text>BL</text></g>
                  <g class="corner-hotspot" data-corner="backRight"><circle r="12"></circle><text>BR</text></g>
                  <g class="corner-hotspot" data-corner="frontLeft"><circle r="12"></circle><text>FL</text></g>
                  <g class="corner-hotspot" data-corner="frontRight"><circle r="12"></circle><text>FR</text></g>
                  <text class="front-label" x="120" y="143">FRONT</text>
                </svg>
              </div>
              <div class="corner-preset-row" aria-label="Corner presets">
                <button type="button" data-corner-preset="panoramic">Panoramic</button>
                <button type="button" data-corner-preset="balanced">Balanced</button>
                <button type="button" data-corner-preset="faceted">Faceted</button>
              </div>
              <div class="toggle-row">
                <div><strong>Edit all corners</strong><span>Apply style and radius everywhere</span></div>
                <button class="switch" id="link-corners" type="button" role="switch" aria-checked="false"><span></span></button>
              </div>
              <div class="selected-corner-row">
                <div><span>Selected corner</span><strong id="selected-corner-name">Front left</strong></div>
                <output id="corner-output">0.58 m</output>
              </div>
              <div class="corner-mode-selector" role="group" aria-label="Selected corner type">
                <button type="button" data-corner-mode="rounded"><span class="mode-icon mode-rounded"></span>Rounded</button>
                <button type="button" data-corner-mode="chamfer"><span class="mode-icon mode-chamfer"></span>Flat pane</button>
                <button type="button" data-corner-mode="square"><span class="mode-icon mode-square"></span>Square</button>
              </div>
              <div id="corner-radius-control"><input class="corner-range" id="corner-range" type="range" min="0.01" max="2" step="0.01" /></div>
              <div class="corner-values" id="corner-values"></div>
            </div>
            <p class="section-note">One shared footprint drives the acrylic, both rims, sand, water, and tunnel openings, so every layer stays aligned.</p>
            ${rangeMarkup('curveSegments')}
          `)}
        </section>

        <section class="tab-pane" data-tab-panel="water" hidden>
          ${card('Water body', 'Color, fill level, and depth tint', `${colorMarkup('waterColor', 'Water color')}${rangeMarkup('waterLevel')}${rangeMarkup('waterTint')}<p class="section-note">Side tint controls how quickly the blue builds up while looking through the tank.</p>`)}
          ${card('Top surface', 'Move from restrained realism to graphic water', `
            <div class="water-style-presets" role="group" aria-label="Water surface style">
              <button type="button" data-water-preset="realistic"><span class="water-swatch water-realistic"></span><strong>Realistic</strong><small>Subtle, clear</small></button>
              <button type="button" data-water-preset="balanced"><span class="water-swatch water-balanced"></span><strong>Balanced</strong><small>Readable detail</small></button>
              <button type="button" data-water-preset="cartoon"><span class="water-swatch water-cartoon"></span><strong>Cartoon</strong><small>Broad color bands</small></button>
            </div>
            ${rangeMarkup('waterSurfaceStyle')}
            ${rangeMarkup('waveStrength')}
            ${rangeMarkup('waterWaveScale')}
            <p class="section-note">The exported GLB contains the generated color and normal textures—no external image files are required.</p>
          `)}
        </section>

        <section class="tab-pane" data-tab-panel="tunnel" hidden>
          ${card('Walk-through tunnel', 'Place a dry passage on either tank axis', `
            <div class="feature-toggle-card">
              <div><strong>Enable tunnel</strong><span>Cut through the base, sand, end panes, and water volume</span></div>
              <button class="switch switch-large" id="tunnel-enabled" type="button" role="switch" aria-checked="false"><span></span></button>
            </div>
            <div class="tunnel-editor" id="tunnel-editor">
              <div class="tunnel-axis-selector" role="group" aria-label="Tunnel direction">
                <button type="button" data-tunnel-axis="depth"><svg viewBox="0 0 24 24"><path d="M12 3v18m-4-4 4 4 4-4M8 7l4-4 4 4" /></svg><span><strong>Front ↔ Back</strong><small>Depth axis</small></span></button>
                <button type="button" data-tunnel-axis="width"><svg viewBox="0 0 24 24"><path d="M3 12h18m-4-4 4 4-4 4M7 8l-4 4 4 4" /></svg><span><strong>Left ↔ Right</strong><small>Width axis</small></span></button>
              </div>
              <div class="tunnel-direction"><span id="tunnel-entrance-label"><b>01</b> Entrance · Front</span><svg viewBox="0 0 42 14"><path d="M2 7h36m-5-4 5 4-5 4" /></svg><span id="tunnel-exit-label"><b>02</b> Exit · Back</span></div>
              <div class="tunnel-preview-wrap">
                <svg id="tunnel-preview" viewBox="0 0 240 132" role="img" aria-label="Tunnel cross section preview">
                  <rect class="tunnel-water-background" x="12" y="12" width="216" height="104" rx="8"></rect>
                  <path id="tunnel-preview-water" class="tunnel-preview-water"></path>
                  <path id="tunnel-preview-outer" class="tunnel-preview-outer"></path>
                  <path id="tunnel-preview-inner" class="tunnel-preview-inner"></path>
                  <line class="tunnel-ground-guide" x1="20" y1="112" x2="220" y2="112"></line>
                </svg>
                <div class="tunnel-off-message"><strong>Tunnel is off</strong><span>Enable it to edit the passage.</span></div>
              </div>
              ${rangeMarkup('tunnelWidth')}
              ${rangeMarkup('tunnelOffset')}
              ${rangeMarkup('tunnelWallHeight')}
              <div class="tunnel-shape-presets" role="group" aria-label="Tunnel roof presets">
                <button type="button" data-tunnel-shape="square"><span class="tunnel-shape-icon shape-square"></span><strong>Square</strong></button>
                <button type="button" data-tunnel-shape="soft"><span class="tunnel-shape-icon shape-soft"></span><strong>Soft</strong></button>
                <button type="button" data-tunnel-shape="arch"><span class="tunnel-shape-icon shape-arch"></span><strong>Arch</strong></button>
              </div>
              ${rangeMarkup('tunnelRoundness')}
              <details class="advanced-details"><summary>Advanced tunnel fit</summary><div>${rangeMarkup('tunnelGlassThickness')}${rangeMarkup('portalFrameWidth')}${rangeMarkup('portalFrameDepth')}${rangeMarkup('tunnelEndExtension')}${rangeMarkup('tunnelWaterClearance')}${rangeMarkup('tunnelCurveSegments')}</div></details>
              <p class="section-note">The passage has no floor mesh. Water is generated as one continuous volume around the selected tunnel profile.</p>
            </div>
          `, 'tunnel-card')}
        </section>

        <section class="tab-pane" data-tab-panel="details" hidden>
          ${card('Structure', 'Slim frame and acrylic fit', `${rangeMarkup('baseHeight')}${rangeMarkup('bottomRimHeight')}${rangeMarkup('topRimHeight')}${rangeMarkup('glassThickness')}<details class="advanced-details"><summary>Advanced fit</summary><div>${rangeMarkup('baseOverhang')}${rangeMarkup('frameOverhang')}${rangeMarkup('frameOverlap')}</div></details>`)}
          ${card('Export', 'GLB size and game units', `${rangeMarkup('exportScale')}<div class="export-summary"><svg viewBox="0 0 24 24"><path d="M4 18 12 4l8 14M7 18h10" /></svg><div><strong id="export-dimensions">—</strong><span>Final dimensions after export scaling</span></div></div>`)}
        </section>
      </div>`;
  }

  private bind(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        this.activeTab = button.dataset.tab as PanelTab;
        this.refreshTabs();
      });
    });

    this.root.querySelectorAll<HTMLInputElement>('[data-range-key]').forEach((range) => {
      range.addEventListener('input', () => this.applyNumeric(range.dataset.rangeKey as keyof AquariumSettings, range.value));
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-number-key]').forEach((number) => {
      number.addEventListener('input', () => {
        if (number.value.trim() !== '') this.applyNumeric(number.dataset.numberKey as keyof AquariumSettings, number.value);
      });
      number.addEventListener('change', () => this.refresh());
    });

    this.root.querySelectorAll<HTMLInputElement>('[data-color-key]').forEach((input) => {
      input.addEventListener('input', () => this.applyColor(input.dataset.colorKey as 'waterColor' | 'sandColor', input.value));
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-color-text-key]').forEach((input) => {
      input.addEventListener('change', () => {
        const value = input.value.trim();
        if (/^#[0-9a-f]{6}$/i.test(value)) this.applyColor(input.dataset.colorTextKey as 'waterColor' | 'sandColor', value);
        else this.refresh();
      });
    });

    this.root.querySelectorAll<SVGGElement>('[data-corner]').forEach((element) => {
      element.addEventListener('click', () => {
        this.selectedCorner = element.dataset.corner as SelectedCorner;
        this.refreshCornerEditor();
      });
    });

    const cornerRange = this.root.querySelector<HTMLInputElement>('#corner-range')!;
    cornerRange.addEventListener('input', () => {
      const value = Number.parseFloat(cornerRange.value);
      const targets = this.linkCorners ? Object.keys(this.settings.radii) as SelectedCorner[] : [this.selectedCorner];
      for (const key of targets) this.settings.radii[key] = value;
      normalizeSettings(this.settings);
      this.refreshCornerEditor();
      this.callbacks.onChange(this.settings, true);
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-corner-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.cornerMode as CornerMode;
        const targets = this.linkCorners ? Object.keys(this.settings.cornerModes) as SelectedCorner[] : [this.selectedCorner];
        for (const key of targets) this.settings.cornerModes[key] = mode;
        normalizeSettings(this.settings);
        this.refreshCornerEditor();
        this.callbacks.onChange(this.settings, true);
      });
    });

    this.root.querySelector<HTMLButtonElement>('#link-corners')!.addEventListener('click', (event) => {
      this.linkCorners = !this.linkCorners;
      const button = event.currentTarget as HTMLButtonElement;
      button.setAttribute('aria-checked', String(this.linkCorners));
      button.classList.toggle('is-on', this.linkCorners);
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-corner-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        const unit = Math.min(this.settings.width, this.settings.depth);
        const preset = button.dataset.cornerPreset;
        if (preset === 'panoramic') {
          this.settings.radii = { frontLeft: unit * 0.12, frontRight: unit * 0.12, backRight: unit * 0.033, backLeft: unit * 0.033 };
          this.settings.cornerModes = { frontLeft: 'rounded', frontRight: 'rounded', backRight: 'rounded', backLeft: 'rounded' };
        } else if (preset === 'balanced') {
          this.settings.radii = { frontLeft: unit * 0.085, frontRight: unit * 0.085, backRight: unit * 0.085, backLeft: unit * 0.085 };
          this.settings.cornerModes = { frontLeft: 'rounded', frontRight: 'rounded', backRight: 'rounded', backLeft: 'rounded' };
        } else {
          this.settings.radii = { frontLeft: unit * 0.1, frontRight: unit * 0.1, backRight: unit * 0.035, backLeft: unit * 0.035 };
          this.settings.cornerModes = { frontLeft: 'chamfer', frontRight: 'chamfer', backRight: 'square', backLeft: 'square' };
        }
        normalizeSettings(this.settings);
        this.refreshCornerEditor();
        this.callbacks.onChange(this.settings, true);
      });
    });

    this.root.querySelector<HTMLButtonElement>('#tunnel-enabled')!.addEventListener('click', () => {
      this.settings.tunnelEnabled = !this.settings.tunnelEnabled;
      this.refreshTunnelEditor();
      this.refreshCornerEditor();
      this.callbacks.onChange(this.settings, true);
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-tunnel-axis]').forEach((button) => {
      button.addEventListener('click', () => {
        this.settings.tunnelAxis = button.dataset.tunnelAxis as TunnelAxis;
        this.settings.tunnelOffset = 0;
        normalizeSettings(this.settings);
        this.refresh();
        this.callbacks.onChange(this.settings, true);
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-tunnel-shape]').forEach((button) => {
      button.addEventListener('click', () => {
        const shape = button.dataset.tunnelShape;
        this.settings.tunnelRoundness = shape === 'square' ? 0 : shape === 'soft' ? 0.48 : 0.9;
        normalizeSettings(this.settings);
        this.refresh();
        this.callbacks.onChange(this.settings, true);
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-ground-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        const preset = button.dataset.groundPreset as GroundPreset;
        const values = GROUND_PRESETS[preset];
        this.settings.groundPreset = preset;
        this.settings.sandColor = values.color;
        this.settings.sandVariation = values.variation;
        this.settings.sandGrain = values.grain;
        this.settings.sandSeed = Math.floor(Math.random() * 1_000_000_000);
        this.refresh();
        this.callbacks.onChange(this.settings, false);
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-water-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        const preset = button.dataset.waterPreset;
        if (preset === 'realistic') {
          this.settings.waterSurfaceStyle = 0.08;
          this.settings.waveStrength = 0.38;
          this.settings.waterWaveScale = 0.62;
        } else if (preset === 'balanced') {
          this.settings.waterSurfaceStyle = 0.46;
          this.settings.waveStrength = 0.58;
          this.settings.waterWaveScale = 0.48;
        } else {
          this.settings.waterSurfaceStyle = 0.9;
          this.settings.waveStrength = 0.72;
          this.settings.waterWaveScale = 0.25;
        }
        this.refresh();
        this.callbacks.onChange(this.settings, false);
      });
    });

    this.root.querySelector<HTMLButtonElement>('#randomize-sand')!.addEventListener('click', () => {
      this.settings.sandSeed = Math.floor(Math.random() * 1_000_000_000);
      this.callbacks.onChange(this.settings, false);
    });

    document.querySelector<HTMLButtonElement>('#reset-button')!.addEventListener('click', () => {
      const defaults = cloneSettings(DEFAULT_SETTINGS);
      this.settings = defaults;
      this.callbacks.onReset(defaults);
      this.refresh();
    });
    document.querySelector<HTMLButtonElement>('#share-button')!.addEventListener('click', this.callbacks.onShare);
    document.querySelector<HTMLButtonElement>('#download-button')!.addEventListener('click', this.callbacks.onDownload);
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
      button.addEventListener('click', () => {
        const view = button.dataset.view as 'iso' | 'front' | 'side' | 'top' | 'fit';
        this.callbacks.onView(view);
        if (view !== 'fit') {
          document.querySelectorAll('[data-view]').forEach((item) => item.classList.remove('is-active'));
          button.classList.add('is-active');
        }
      });
    });
  }

  private applyNumeric(key: keyof AquariumSettings, raw: string): void {
    const definition = RANGE_DEFINITIONS.find((item) => item.key === key);
    if (!definition) return;
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return;
    (this.settings as unknown as Record<string, number>)[key] = value;
    normalizeSettings(this.settings);
    this.refresh();
    this.callbacks.onChange(this.settings, Boolean(definition.structural));
  }

  private applyColor(key: 'waterColor' | 'sandColor', value: string): void {
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

    for (const definition of RANGE_DEFINITIONS) {
      const value = Number((this.settings as unknown as Record<string, number>)[definition.key]);
      const range = this.root.querySelector<HTMLInputElement>(`[data-range-key="${definition.key}"]`);
      const number = this.root.querySelector<HTMLInputElement>(`[data-number-key="${definition.key}"]`);
      const output = this.root.querySelector<HTMLOutputElement>(`#${definition.key}-output`);
      if (range) {
        if (definition.key === 'tunnelWidth') range.max = String(maxTunnelWidth);
        if (definition.key === 'tunnelOffset') { range.min = String(-maxTunnelOffset); range.max = String(maxTunnelOffset); }
        if (definition.key === 'tunnelWallHeight') range.max = String(Math.max(0.45, this.settings.height * 0.52));
        range.value = String(value);
      }
      if (number) {
        if (definition.key === 'tunnelWidth') number.max = String(maxTunnelWidth);
        if (definition.key === 'tunnelOffset') { number.min = String(-maxTunnelOffset); number.max = String(maxTunnelOffset); }
        if (definition.key === 'tunnelWallHeight') number.max = String(Math.max(0.45, this.settings.height * 0.52));
        number.value = String(Number(value.toFixed(3)));
      }
      if (output) output.textContent = this.formatValue(definition, value);
    }

    for (const key of ['waterColor', 'sandColor'] as const) {
      this.root.querySelector<HTMLInputElement>(`[data-color-key="${key}"]`)!.value = this.settings[key];
      this.root.querySelector<HTMLInputElement>(`[data-color-text-key="${key}"]`)!.value = this.settings[key].toUpperCase();
    }

    this.refreshTabs();
    this.refreshCornerEditor();
    this.refreshGroundPreset();
    this.refreshWaterStyle();
    this.refreshTunnelEditor();
    const exportDimensions = this.root.querySelector<HTMLElement>('#export-dimensions')!;
    exportDimensions.textContent = `${(this.settings.width * this.settings.exportScale).toFixed(1)} × ${(this.settings.depth * this.settings.exportScale).toFixed(1)} × ${(this.settings.height * this.settings.exportScale).toFixed(1)} units`;
  }

  private refreshTabs(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === this.activeTab));
    this.root.querySelectorAll<HTMLElement>('[data-tab-panel]').forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== this.activeTab; });
  }

  private refreshGroundPreset(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-ground-preset]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.groundPreset === this.settings.groundPreset);
    });
  }

  private refreshWaterStyle(): void {
    const style = this.settings.waterSurfaceStyle;
    const selected = style < 0.28 ? 'realistic' : style < 0.72 ? 'balanced' : 'cartoon';
    this.root.querySelectorAll<HTMLButtonElement>('[data-water-preset]').forEach((button) => button.classList.toggle('is-active', button.dataset.waterPreset === selected));
  }

  private refreshTunnelEditor(): void {
    const button = this.root.querySelector<HTMLButtonElement>('#tunnel-enabled')!;
    button.setAttribute('aria-checked', String(this.settings.tunnelEnabled));
    button.classList.toggle('is-on', this.settings.tunnelEnabled);
    const editor = this.root.querySelector<HTMLElement>('#tunnel-editor')!;
    editor.classList.toggle('is-disabled', !this.settings.tunnelEnabled);

    this.root.querySelectorAll<HTMLButtonElement>('[data-tunnel-axis]').forEach((axisButton) => {
      axisButton.classList.toggle('is-active', axisButton.dataset.tunnelAxis === this.settings.tunnelAxis);
    });
    const depthAxis = this.settings.tunnelAxis === 'depth';
    this.root.querySelector<HTMLElement>('#tunnel-entrance-label')!.innerHTML = depthAxis
      ? '<b>01</b> Entrance · Front'
      : '<b>01</b> Entrance · Left';
    this.root.querySelector<HTMLElement>('#tunnel-exit-label')!.innerHTML = depthAxis
      ? '<b>02</b> Exit · Back'
      : '<b>02</b> Exit · Right';

    const offsetControl = this.root.querySelector<HTMLElement>('[data-control="tunnelOffset"]')!;
    const offsetLabel = offsetControl.querySelector<HTMLLabelElement>('label')!;
    const offsetOutput = this.root.querySelector<HTMLOutputElement>('#tunnelOffset-output')!;
    offsetLabel.textContent = depthAxis ? 'Left / right position' : 'Front / back position';
    const offset = this.settings.tunnelOffset;
    if (Math.abs(offset) < 0.025) offsetOutput.textContent = 'Centered';
    else if (depthAxis) offsetOutput.textContent = `${Math.abs(offset).toFixed(2)} m ${offset > 0 ? 'right' : 'left'}`;
    else offsetOutput.textContent = `${Math.abs(offset).toFixed(2)} m ${offset > 0 ? 'front' : 'back'}`;

    const selectedShape = this.settings.tunnelRoundness <= 0.015
      ? 'square'
      : this.settings.tunnelRoundness < 0.7 ? 'soft' : 'arch';
    this.root.querySelectorAll<HTMLButtonElement>('[data-tunnel-shape]').forEach((shapeButton) => {
      shapeButton.classList.toggle('is-active', shapeButton.dataset.tunnelShape === selectedShape);
    });

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

  private refreshCornerEditor(): void {
    const maxRadius = Math.max(0.02, Math.min(this.settings.width, this.settings.depth) * 0.49);
    const range = this.root.querySelector<HTMLInputElement>('#corner-range')!;
    const mode = this.settings.cornerModes[this.selectedCorner];
    range.max = String(maxRadius);
    range.value = String(this.settings.radii[this.selectedCorner]);
    range.disabled = mode === 'square';
    this.root.querySelector<HTMLElement>('#corner-radius-control')!.classList.toggle('is-disabled', mode === 'square');
    this.root.querySelector<HTMLOutputElement>('#corner-output')!.textContent = mode === 'square' ? 'Sharp' : `${this.settings.radii[this.selectedCorner].toFixed(2)} m`;
    this.root.querySelector<HTMLElement>('#selected-corner-name')!.textContent = {
      frontLeft: 'Front left', frontRight: 'Front right', backRight: 'Back right', backLeft: 'Back left',
    }[this.selectedCorner];
    this.root.querySelectorAll<HTMLButtonElement>('[data-corner-mode]').forEach((button) => button.classList.toggle('is-active', button.dataset.cornerMode === mode));

    const outerWidth = this.settings.width + this.settings.frameOverhang * 2;
    const outerDepth = this.settings.depth + this.settings.frameOverhang * 2;
    const scale = Math.min(190 / outerWidth, 100 / outerDepth);
    const centerX = 120;
    const centerY = 70;
    const pathFrom = (points: THREE.Vector2[]) => `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${(centerX + point.x * scale).toFixed(2)} ${(centerY + point.y * scale).toFixed(2)}`).join(' ')} Z`;

    const body = createFootprintLoop(this.settings.width, this.settings.depth, this.settings.radii, this.settings.cornerModes, this.settings.curveSegments);
    const frame = createFootprintLoop(
      outerWidth,
      outerDepth,
      offsetRadii(this.settings.radii, this.settings.frameOverhang),
      this.settings.cornerModes,
      this.settings.curveSegments,
    );
    const waterInset = this.settings.glassThickness + this.settings.waterWallGap;
    const water = createFootprintLoop(
      this.settings.width - waterInset * 2,
      this.settings.depth - waterInset * 2,
      offsetRadii(this.settings.radii, -waterInset),
      this.settings.cornerModes,
      this.settings.curveSegments,
    );
    this.root.querySelector<SVGPathElement>('#corner-preview-frame')!.setAttribute('d', pathFrom(frame));
    this.root.querySelector<SVGPathElement>('#corner-preview-path')!.setAttribute('d', pathFrom(body));
    this.root.querySelector<SVGPathElement>('#corner-preview-water')!.setAttribute('d', pathFrom(water));

    const tunnel = this.root.querySelector<SVGPathElement>('#corner-preview-tunnel')!;
    if (this.settings.tunnelEnabled) {
      const half = this.settings.tunnelWidth * 0.5 * scale;
      if (this.settings.tunnelAxis === 'depth') {
        const tunnelCenterX = centerX + this.settings.tunnelOffset * scale;
        const top = centerY - this.settings.depth * 0.5 * scale - 7;
        const bottom = centerY + this.settings.depth * 0.5 * scale + 7;
        tunnel.setAttribute('d', `M ${tunnelCenterX - half} ${top} L ${tunnelCenterX - half} ${bottom} M ${tunnelCenterX + half} ${top} L ${tunnelCenterX + half} ${bottom}`);
      } else {
        const tunnelCenterY = centerY + this.settings.tunnelOffset * scale;
        const left = centerX - this.settings.width * 0.5 * scale - 7;
        const right = centerX + this.settings.width * 0.5 * scale + 7;
        tunnel.setAttribute('d', `M ${left} ${tunnelCenterY - half} L ${right} ${tunnelCenterY - half} M ${left} ${tunnelCenterY + half} L ${right} ${tunnelCenterY + half}`);
      }
      tunnel.style.display = '';
    } else tunnel.style.display = 'none';

    const positions: Record<SelectedCorner, [number, number]> = {
      backLeft: [centerX - this.settings.width * 0.5 * scale + 8, centerY - this.settings.depth * 0.5 * scale + 8],
      backRight: [centerX + this.settings.width * 0.5 * scale - 8, centerY - this.settings.depth * 0.5 * scale + 8],
      frontLeft: [centerX - this.settings.width * 0.5 * scale + 8, centerY + this.settings.depth * 0.5 * scale - 8],
      frontRight: [centerX + this.settings.width * 0.5 * scale - 8, centerY + this.settings.depth * 0.5 * scale - 8],
    };
    this.root.querySelectorAll<SVGGElement>('[data-corner]').forEach((element) => {
      const corner = element.dataset.corner as SelectedCorner;
      const [x, y] = positions[corner];
      element.setAttribute('transform', `translate(${x} ${y})`);
      element.classList.toggle('is-selected', corner === this.selectedCorner);
    });

    const cornerValues = this.root.querySelector<HTMLElement>('#corner-values')!;
    const labels: Record<SelectedCorner, string> = { frontLeft: 'FL', frontRight: 'FR', backRight: 'BR', backLeft: 'BL' };
    cornerValues.innerHTML = (Object.keys(this.settings.radii) as SelectedCorner[]).map((corner) => {
      const value = this.settings.cornerModes[corner] === 'square' ? 'SQ' : this.settings.radii[corner].toFixed(2);
      return `<button type="button" data-corner-value="${corner}" class="${corner === this.selectedCorner ? 'is-selected' : ''}"><span>${labels[corner]}</span><strong>${value}</strong></button>`;
    }).join('');
    cornerValues.querySelectorAll<HTMLButtonElement>('[data-corner-value]').forEach((button) => {
      button.addEventListener('click', () => {
        this.selectedCorner = button.dataset.cornerValue as SelectedCorner;
        this.refreshCornerEditor();
      });
    });
  }
}
