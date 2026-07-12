import * as THREE from 'three';
import type {
  AquariumProfile,
  AquariumSettings,
  CornerMode,
  CornerRadii,
  FootprintType,
  GroundPreset,
  PassageSettings,
  PassageSide,
  ShapeCornerKey,
  WaterSurfacePreset,
} from '../model/settings';
import {
  activeShapeCornerKeys,
  cloneSettings,
  createPassage,
  DEFAULT_SETTINGS,
  legacyPassage,
  normalizeSettings,
  oppositeSide,
  SHAPE_CORNER_LABELS,
  sidesAreAdjacent,
  tunnelAllowed,
} from '../model/settings';
import { createFootprintShapeLoop } from '../model/aquarium';

export type SelectedCorner = keyof CornerRadii | ShapeCornerKey;
type PanelTab = 'layout' | 'height' | 'passages' | 'water' | 'ground';
type LayoutElement = 'bounds' | 'lVertical' | 'lHorizontal' | 'uLeft' | 'uRight' | 'uBridge';

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
  { key: 'lVerticalArmWidth', label: 'Arm width', min: 0.5, max: 12, step: 0.05, unit: 'm', structural: true },
  { key: 'lVerticalArmLength', label: 'Arm length', min: 1, max: 24, step: 0.05, unit: 'm', structural: true },
  { key: 'lHorizontalArmWidth', label: 'Arm width', min: 0.5, max: 12, step: 0.05, unit: 'm', structural: true },
  { key: 'lHorizontalArmLength', label: 'Arm length', min: 1, max: 30, step: 0.05, unit: 'm', structural: true },
  { key: 'uLeftArmWidth', label: 'Arm width', min: 0.4, max: 12, step: 0.05, unit: 'm', structural: true },
  { key: 'uLeftArmLength', label: 'Arm length', min: 1, max: 24, step: 0.05, unit: 'm', structural: true },
  { key: 'uRightArmWidth', label: 'Arm width', min: 0.4, max: 12, step: 0.05, unit: 'm', structural: true },
  { key: 'uRightArmLength', label: 'Arm length', min: 1, max: 24, step: 0.05, unit: 'm', structural: true },
  { key: 'uBridgeDepth', label: 'Connector depth', min: 0.5, max: 12, step: 0.05, unit: 'm', structural: true },
  { key: 'uBridgeLength', label: 'Connector length', min: 2, max: 30, step: 0.05, unit: 'm', structural: true },
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
  { key: 'waterAnimationSpeed', label: 'Animation speed', min: 0, max: 2, step: 0.01, format: (value) => `${value.toFixed(2)}×` },
  { key: 'waterAnimationAmount', label: 'Surface motion', min: 0, max: 0.08, step: 0.001, unit: 'm' },
  { key: 'sandVariation', label: 'Color variation', min: 0, max: 1, step: 0.01, format: percent },
  { key: 'sandGrain', label: 'Grain scale', min: 0.1, max: 2.5, step: 0.05, format: (value) => value.toFixed(2) },
  { key: 'groundIrregularity', label: 'Fine irregularity', min: 0, max: 0.6, step: 0.005, unit: 'm', structural: true },
  { key: 'groundMoundHeight', label: 'Mound height', min: 0, max: 5, step: 0.05, unit: 'm', structural: true },
  { key: 'groundMoundSize', label: 'Mound radius', min: 0.25, max: 8, step: 0.05, unit: 'm', structural: true },
  { key: 'groundWallFalloff', label: 'Wall falloff', min: 0, max: 3, step: 0.05, unit: 'm', structural: true },
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
];

interface PassageRangeDefinition {
  key: keyof PassageSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  format?: (value: number) => string;
}

const PASSAGE_RANGES: PassageRangeDefinition[] = [
  { key: 'width', label: 'Passage width', min: 0.8, max: 8, step: 0.05, unit: 'm' },
  { key: 'entryOffset', label: 'Entrance position', min: -10, max: 10, step: 0.05, unit: 'm' },
  { key: 'exitOffset', label: 'Exit position', min: -10, max: 10, step: 0.05, unit: 'm' },
  { key: 'alcoveDepth', label: 'Alcove depth', min: 0.6, max: 10, step: 0.05, unit: 'm' },
  { key: 'wallHeight', label: 'Straight wall height', min: 0.35, max: 5, step: 0.05, unit: 'm' },
  { key: 'roundness', label: 'Roof shape', min: 0, max: 1.35, step: 0.01, format: tunnelShapeLabel },
  { key: 'bendRadius', label: 'L-corner radius', min: 0, max: 6, step: 0.05, unit: 'm' },
  { key: 'glassThickness', label: 'Passage acrylic', min: 0.025, max: 0.25, step: 0.005, unit: 'm' },
  { key: 'curveSegments', label: 'Arch quality', min: 5, max: 24, step: 1, format: (value) => `${Math.round(value)} segments` },
  { key: 'endExtension', label: 'Portal extension', min: 0, max: 0.8, step: 0.01, unit: 'm' },
  { key: 'portalFrameWidth', label: 'Portal border', min: 0.04, max: 0.45, step: 0.005, unit: 'm' },
  { key: 'portalFrameDepth', label: 'Portal depth', min: 0.04, max: 0.65, step: 0.005, unit: 'm' },
  { key: 'waterClearance', label: 'Water clearance', min: 0.005, max: 0.12, step: 0.005, unit: 'm' },
  { key: 'sideRimWidth', label: 'Bridge side rim width', min: 0.03, max: 0.35, step: 0.005, unit: 'm' },
  { key: 'bridgeRimHeight', label: 'Bridge side rim height', min: 0.02, max: 0.35, step: 0.005, unit: 'm' },
  { key: 'separatorSpacing', label: 'Floor panel spacing', min: 0.3, max: 4, step: 0.05, unit: 'm' },
  { key: 'separatorWidth', label: 'Floor separator width', min: 0.005, max: 0.15, step: 0.005, unit: 'm' },
];

function rangeMarkup(id: keyof AquariumSettings): string {
  const definition = RANGE_DEFINITIONS.find((item) => item.key === id);
  if (!definition) throw new Error(`Missing range definition: ${String(id)}`);
  return `<div class="control-row" data-control="${definition.key}">
    <div class="control-label-row"><label for="${definition.key}-range">${definition.label}</label><output id="${definition.key}-output"></output></div>
    <div class="range-pair"><input id="${definition.key}-range" data-range-key="${definition.key}" type="range" min="${definition.min}" max="${definition.max}" step="${definition.step}" />
    <div class="number-wrap"><input id="${definition.key}-number" data-number-key="${definition.key}" type="number" ${definition.min >= 0 ? 'min="0.001"' : ''} step="${definition.step}" />${definition.unit ? `<span>${definition.unit}</span>` : ''}</div></div>
  </div>`;
}

function passageRangeMarkup(key: keyof PassageSettings): string {
  const definition = PASSAGE_RANGES.find((item) => item.key === key);
  if (!definition) throw new Error(`Missing passage range: ${String(key)}`);
  return `<div class="control-row passage-control" data-passage-control="${key}">
    <div class="control-label-row"><label>${definition.label}</label><output data-passage-output="${key}"></output></div>
    <div class="range-pair"><input data-passage-range="${key}" type="range" min="${definition.min}" max="${definition.max}" step="${definition.step}" />
    <div class="number-wrap"><input data-passage-number="${key}" type="number" ${definition.min >= 0 ? 'min="0.001"' : ''} step="${definition.step}" />${definition.unit ? `<span>${definition.unit}</span>` : ''}</div></div>
  </div>`;
}

function colorMarkup(key: 'waterColor' | 'sandColor' | 'subFloorBodyColor' | 'solidWallColor', label: string): string {
  return `<div class="color-row"><label for="${key}-color">${label}</label><div class="color-control"><input id="${key}-color" data-color-key="${key}" type="color" /><input id="${key}-text" data-color-text-key="${key}" type="text" maxlength="7" spellcheck="false" /></div></div>`;
}

function card(title: string, subtitle: string, content: string): string {
  return `<section class="control-card"><header><strong>${title}</strong><span>${subtitle}</span></header><div class="control-card-body">${content}</div></section>`;
}

const RECTANGLE_KEYS: Array<keyof CornerRadii> = ['frontLeft', 'frontRight', 'backRight', 'backLeft'];
const RECTANGLE_LABELS: Record<keyof CornerRadii, string> = { frontLeft: 'Front left', frontRight: 'Front right', backRight: 'Back right', backLeft: 'Back left' };

function cornerShortLabel(key: SelectedCorner): string {
  const labels: Partial<Record<SelectedCorner, string>> = {
    frontLeft: 'FL', frontRight: 'FR', backRight: 'BR', backLeft: 'BL',
    lBackLeft: 'BL', lBackRight: 'BR', lOuterRight: 'OR', lInnerElbow: 'IN', lFrontRight: 'VE', lFrontLeft: 'FL',
    uBackLeft: 'BL', uBackRight: 'BR', uFrontRight: 'RE', uMouthRight: 'RI', uInnerRight: 'IR', uInnerLeft: 'IL', uMouthLeft: 'LI', uFrontLeft: 'LE',
  };
  return labels[key] ?? '•';
}

const SIDES: PassageSide[] = ['front', 'back', 'left', 'right'];
const SIDE_LABELS: Record<PassageSide, string> = { front: 'Front', back: 'Back', left: 'Left', right: 'Right' };

export class ControlPanel {
  private settings: AquariumSettings;
  private readonly root: HTMLElement;
  private readonly callbacks: PanelCallbacks;
  private selectedCorner: SelectedCorner = 'frontLeft';
  private linkCorners = false;
  private activeTab: PanelTab = 'layout';
  private selectedLayoutElement: LayoutElement = 'bounds';
  private selectedPassageId: string | null = null;

  constructor(root: HTMLElement, settings: AquariumSettings, callbacks: PanelCallbacks) {
    this.root = root;
    this.settings = settings;
    this.callbacks = callbacks;
    if (this.settings.passages.length === 0 && this.settings.tunnelEnabled && tunnelAllowed(this.settings)) {
      this.settings.passages = [legacyPassage(this.settings)];
      this.settings.tunnelEnabled = false;
    }
    this.selectedPassageId = this.settings.passages[0]?.id ?? null;
    this.render();
    this.bind();
    this.refresh();
  }

  setSettings(settings: AquariumSettings): void {
    this.settings = settings;
    if (this.settings.passages.length === 0 && this.settings.tunnelEnabled && tunnelAllowed(this.settings)) {
      this.settings.passages = [legacyPassage(this.settings)];
      this.settings.tunnelEnabled = false;
    }
    if (!this.settings.passages.some((passage) => passage.id === this.selectedPassageId)) this.selectedPassageId = this.settings.passages[0]?.id ?? null;
    this.ensureSelectedCorner();
    this.refresh();
  }

  private selectedPassage(): PassageSettings | null {
    return this.settings.passages.find((passage) => passage.id === this.selectedPassageId) ?? null;
  }

  private activeCornerKeys(): SelectedCorner[] {
    return this.settings.footprint === 'rectangle' ? RECTANGLE_KEYS : activeShapeCornerKeys(this.settings.footprint);
  }
  private ensureSelectedCorner(): void {
    const keys = this.activeCornerKeys();
    if (!keys.includes(this.selectedCorner)) this.selectedCorner = keys[0] ?? 'frontLeft';
  }
  private getCornerRadius(key: SelectedCorner): number {
    return key in this.settings.radii ? this.settings.radii[key as keyof CornerRadii] : this.settings.shapeCornerRadii[key as ShapeCornerKey];
  }
  private setCornerRadius(key: SelectedCorner, value: number): void {
    if (key in this.settings.radii) this.settings.radii[key as keyof CornerRadii] = value;
    else this.settings.shapeCornerRadii[key as ShapeCornerKey] = value;
  }
  private getCornerMode(key: SelectedCorner): CornerMode {
    return key in this.settings.cornerModes ? this.settings.cornerModes[key as keyof CornerRadii] : this.settings.shapeCornerModes[key as ShapeCornerKey];
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
      ['layout', 'Layout', 'M4 18V6h7v5h9v7H4Zm7-7v7'],
      ['height', 'Height', 'M6 20V6h12v14M6 12h12M10 6v14'],
      ['passages', 'Passages', 'M4 19V11a8 8 0 0 1 16 0v8M8 19v-8a4 4 0 0 1 8 0v8'],
      ['water', 'Water', 'M3 15c3-3 6 3 9 0s6 3 9 0M4 9c3-3 5 2 8 0s5 3 8 0'],
      ['ground', 'Ground', 'M4 17c4-2 8-2 16 0M5 13c5-2 9-2 14 0M7 9h10'],
    ];
    this.root.innerHTML = `
      <nav class="panel-tabs" aria-label="Aquarium editor sections">${tabs.map(([id, label, icon]) => `<button type="button" data-tab="${id}" class="${id === this.activeTab ? 'is-active' : ''}"><svg viewBox="0 0 24 24"><path d="${icon}" /></svg><span>${label}</span></button>`).join('')}</nav>
      <div class="tab-stage">
        <section class="tab-pane" data-tab-panel="layout">
          ${card('Footprint', 'Choose a plan, then click an arm or connector to edit only that piece', `
            <div class="mode-grid footprint-grid"><button type="button" data-footprint="rectangle"><strong>Rectangle</strong><small>Single continuous body</small></button><button type="button" data-footprint="lShape"><strong>L shape</strong><small>Two independent arms</small></button><button type="button" data-footprint="uShape"><strong>U shape</strong><small>Two arms plus connector</small></button></div>
            <div class="layout-canvas-wrap"><svg id="layout-preview" viewBox="0 0 260 170" aria-label="Editable top view"><path id="layout-outline"></path><path id="layout-water"></path><g id="layout-element-hotspots"></g><g id="layout-passage-lines"></g><text x="130" y="163" class="front-label">FRONT</text></svg></div>
            <div class="layout-toolbar"><button type="button" id="rotate-layout">Rotate 90°</button><button type="button" id="mirror-layout">Mirror</button><button type="button" id="equalize-layout">Equalize arms</button></div>
            <div id="rectangle-layout-controls">${rangeMarkup('width')}${rangeMarkup('depth')}</div>
            <div class="selected-layout-card" id="selected-layout-card"><span>Selected element</span><strong id="selected-layout-name">Overall layout</strong></div>
            <div id="l-vertical-controls">${rangeMarkup('lVerticalArmWidth')}${rangeMarkup('lVerticalArmLength')}</div>
            <div id="l-horizontal-controls">${rangeMarkup('lHorizontalArmWidth')}${rangeMarkup('lHorizontalArmLength')}</div>
            <div id="u-left-controls">${rangeMarkup('uLeftArmWidth')}${rangeMarkup('uLeftArmLength')}</div>
            <div id="u-right-controls">${rangeMarkup('uRightArmWidth')}${rangeMarkup('uRightArmLength')}</div>
            <div id="u-bridge-controls">${rangeMarkup('uBridgeDepth')}${rangeMarkup('uBridgeLength')}</div>
            <p class="section-note manual-value-note">Sliders stay in comfortable ranges. Typed positive values may be larger whenever the layout remains physically valid.</p>
          `)}
          ${card('Corner designer', 'Outside and inside corners remain independently editable after arm changes', `
            <div class="corner-editor"><div class="corner-canvas-wrap"><svg id="corner-preview" viewBox="0 0 240 150"><path id="corner-preview-frame" class="corner-preview-frame"></path><path id="corner-preview-path" class="corner-preview-body"></path><path id="corner-preview-water" class="corner-preview-water"></path><path id="corner-preview-tunnel" class="corner-preview-tunnel"></path><g id="corner-hotspots"></g><text class="front-label" x="120" y="143">FRONT</text></svg></div>
            <div class="corner-preset-row"><button type="button" data-corner-preset="soft">Soft</button><button type="button" data-corner-preset="balanced">Balanced</button><button type="button" data-corner-preset="square">Square</button></div>
            <div class="toggle-row"><div><strong>Edit all active corners</strong><span>Apply style and radius together</span></div><button class="switch" id="link-corners" type="button" role="switch"><span></span></button></div>
            <div class="selected-corner-row"><div><span>Selected corner</span><strong id="selected-corner-name"></strong></div><output id="corner-output"></output></div>
            <div class="corner-mode-selector"><button type="button" data-corner-mode="rounded"><span class="mode-icon mode-rounded"></span>Rounded</button><button type="button" data-corner-mode="chamfer"><span class="mode-icon mode-chamfer"></span>Flat pane</button><button type="button" data-corner-mode="square"><span class="mode-icon mode-square"></span>Square</button></div>
            <div id="corner-radius-control" class="corner-radius-pair"><input class="corner-range" id="corner-range" type="range" min="0.002" max="2" step="0.01" /><div class="number-wrap"><input id="corner-number" type="number" min="0.001" step="0.01" /><span>m</span></div></div><div class="corner-values" id="corner-values"></div></div>${rangeMarkup('curveSegments')}
          `)}
          ${card('Wall construction', 'Make any cardinal face opaque while keeping the same water volume', `<div class="wall-mode-grid">${(['front','back','left','right'] as PassageSide[]).map((side) => `<button type="button" data-wall-side="${side}"><strong>${side[0]!.toUpperCase()+side.slice(1)}</strong><small>Glass</small></button>`).join('')}</div>${colorMarkup('solidWallColor', 'Solid wall color')}<p class="section-note">Solid panels are structural overlays. Passage openings remain clear where a tunnel enters that wall.</p>`)}
          ${card('Fish AI data', 'Navigation information is embedded in the GLB as named NAV nodes and glTF extras', `<div class="toggle-row"><div><strong>Download companion JSON</strong><span>Regions, portals, bounds, area, volume, spawn points, and dry passage paths</span></div><button class="switch" id="navigation-json" type="button" role="switch"><span></span></button></div><p class="section-note">The GLB always includes the same metadata. The JSON option simply makes it easier to inspect or import separately.</p>`)}
        </section>

        <section class="tab-pane" data-tab-panel="height" hidden>
          ${card('Vertical profile', 'The same layout can become a display aquarium, sunk exhibit, or touch pool', `<div class="mode-grid profile-grid"><button type="button" data-profile="standard"><strong>Standard</strong><small>Freestanding aquarium</small></button><button type="button" data-profile="belowFloor"><strong>Below floor</strong><small>Negative-Y structural body</small></button><button type="button" data-profile="touchPool"><strong>Touch pool</strong><small>Shallow opaque basin</small></button></div><p class="section-note" id="profile-note"></p>`)}
          <div id="standard-height-section">${card('Standard dimensions', 'Clear walls above a slim base', `${rangeMarkup('height')}${rangeMarkup('baseHeight')}${rangeMarkup('bottomRimHeight')}${rangeMarkup('topRimHeight')}${rangeMarkup('glassThickness')}`)}</div>
          <div id="below-height-section">${card('Below-floor dimensions', 'The game floor sits at Y = 0; no floor polygon is exported', `${rangeMarkup('heightAboveFloor')}${rangeMarkup('depthBelowFloor')}${rangeMarkup('floorRimHeight')}${colorMarkup('subFloorBodyColor', 'Sub-floor body')}${rangeMarkup('glassThickness')}`)}</div>
          <div id="touch-height-section">${card('Touch pool basin', 'Defaults to a true 0.5 m shallow opaque pool with no glass walls', `${rangeMarkup('touchPoolHeight')}${rangeMarkup('touchWaterDepth')}${rangeMarkup('touchRimWidth')}${rangeMarkup('touchRimHeight')}${rangeMarkup('touchBasinInset')}${rangeMarkup('touchPedestalHeight')}`)}</div>
          ${card('Shared structure', 'Advanced footprint-to-frame spacing', `${rangeMarkup('baseOverhang')}${rangeMarkup('frameOverhang')}${rangeMarkup('frameOverlap')}`)}
        </section>

        <section class="tab-pane" data-tab-panel="passages" hidden>
          ${card('Passage network', 'Add several straight tunnels, one-bend L tunnels, or one-ended viewing alcoves', `
            <div id="passage-incompatible" class="compatibility-banner" hidden>Touch pools intentionally do not support passages. Your passage list is preserved if you switch back.</div>
            <div class="passage-add-row"><button type="button" data-add-passage="straight"><span>＋</span><strong>Straight tunnel</strong></button><button type="button" data-add-passage="elbow"><span>⌞</span><strong>L tunnel</strong></button><button type="button" data-add-passage="alcove"><span>◧</span><strong>Viewing alcove</strong></button></div>
            <div class="passage-list" id="passage-list"></div>
            <div class="empty-passage-state" id="empty-passage-state"><strong>No passages yet</strong><span>Add one above. Multiple directions and separate U arms are supported.</span></div>
          `)}
          <div id="passage-editor-wrap">
            ${card('Selected passage', 'Only the selected route is shown here, keeping a complex network manageable', `
              <div class="passage-title-row"><input id="passage-name" type="text" maxlength="48" /><div><button type="button" id="duplicate-passage" title="Duplicate passage">Duplicate</button><button type="button" id="delete-passage" class="danger-button" title="Delete passage">Delete</button></div></div>
              <div class="passage-kind-summary"><span id="passage-kind-label"></span><span id="passage-route-label"></span></div>
              <div class="passage-map-wrap"><svg id="passage-map" viewBox="0 0 260 170"><path id="passage-map-outline"></path><g id="passage-map-routes"></g><text x="130" y="163" class="front-label">FRONT</text></svg></div>
              <div class="shape-subheading"><strong>Entrance wall</strong><span>World-facing side of the tank</span></div><div class="side-selector" id="entry-side-selector">${SIDES.map((side) => `<button type="button" data-entry-side="${side}">${SIDE_LABELS[side]}</button>`).join('')}</div>
              <div id="exit-side-block"><div class="shape-subheading"><strong>Exit wall</strong><span id="exit-side-hint">Opposite for straight tunnels; adjacent for L tunnels</span></div><div class="side-selector" id="exit-side-selector">${SIDES.map((side) => `<button type="button" data-exit-side="${side}">${SIDE_LABELS[side]}</button>`).join('')}</div></div>
              ${passageRangeMarkup('width')}${passageRangeMarkup('entryOffset')}<div id="passage-exit-offset">${passageRangeMarkup('exitOffset')}</div><div id="passage-alcove-depth">${passageRangeMarkup('alcoveDepth')}</div>${passageRangeMarkup('wallHeight')}
              <div class="tunnel-shape-presets"><button type="button" data-passage-shape="square"><span class="tunnel-shape-icon shape-square"></span><strong>Square</strong></button><button type="button" data-passage-shape="soft"><span class="tunnel-shape-icon shape-soft"></span><strong>Soft</strong></button><button type="button" data-passage-shape="arch"><span class="tunnel-shape-icon shape-arch"></span><strong>Arch</strong></button></div>${passageRangeMarkup('roundness')}<div id="passage-bend-radius">${passageRangeMarkup('bendRadius')}</div>
              <div id="passage-bridge-options"><div class="toggle-row"><div><strong>Acrylic bridge floor</strong><span>Water and substrate continue below the walkable floor</span></div><button class="switch" id="passage-glass-floor" type="button" role="switch"><span></span></button></div>${passageRangeMarkup('sideRimWidth')}${passageRangeMarkup('bridgeRimHeight')}${passageRangeMarkup('separatorSpacing')}${passageRangeMarkup('separatorWidth')}</div>
              <details class="advanced-block"><summary>Advanced passage geometry</summary>${passageRangeMarkup('glassThickness')}${passageRangeMarkup('curveSegments')}${passageRangeMarkup('endExtension')}${passageRangeMarkup('portalFrameWidth')}${passageRangeMarkup('portalFrameDepth')}${passageRangeMarkup('waterClearance')}</details>
              <p class="section-note">For U tanks, place separate passages at the center of each arm. L routes use one offset per wall, so their bend moves naturally as either entrance is repositioned.</p>
            `)}
          </div>
        </section>

        <section class="tab-pane" data-tab-panel="water" hidden>
          ${card('Water surface', 'Visual presets remain editable after selection', `<div class="water-style-presets"><button type="button" data-water-preset="calm"><span class="water-swatch water-calm"></span><strong>Calm</strong><small>Broad and quiet</small></button><button type="button" data-water-preset="realistic"><span class="water-swatch water-realistic"></span><strong>Realistic</strong><small>Fine ripples</small></button><button type="button" data-water-preset="balanced"><span class="water-swatch water-balanced"></span><strong>Balanced</strong><small>Readable game water</small></button><button type="button" data-water-preset="cartoon"><span class="water-swatch water-cartoon"></span><strong>Cartoon</strong><small>Graphic highlights</small></button><button type="button" data-water-preset="pixel"><span class="water-swatch water-pixel"></span><strong>Pixel</strong><small>Stepped block waves</small></button></div>${colorMarkup('waterColor', 'Water color')}${rangeMarkup('waterTint')}${rangeMarkup('waterSurfaceStyle')}${rangeMarkup('waveStrength')}${rangeMarkup('waterWaveScale')}`)}
          ${card('Cheap animation', 'Two scrolling texture layers and subtle surface motion; no fluid simulation', `<div class="toggle-row"><div><strong>Animate surface</strong><span>Viewport preview and export metadata</span></div><button class="switch" id="water-animation" type="button" role="switch"><span></span></button></div>${rangeMarkup('waterAnimationSpeed')}${rangeMarkup('waterAnimationAmount')}`)}
          ${card('Water placement', 'Touch-pool depth is controlled in Height', `<div id="standard-water-level">${rangeMarkup('waterLevel')}</div>`)}
        </section>

        <section class="tab-pane" data-tab-panel="ground" hidden>
          ${card('Ground material', 'Choose a substrate, then tune its procedural texture', `<div class="ground-presets"><button type="button" data-ground-preset="sand"><strong>Sand</strong><small>Warm and soft</small></button><button type="button" data-ground-preset="dirt"><strong>Dirt</strong><small>Dark organic soil</small></button><button type="button" data-ground-preset="algae"><strong>Algae</strong><small>Muted green growth</small></button><button type="button" data-ground-preset="gravel"><strong>Gravel</strong><small>Coarse mixed stones</small></button></div>${colorMarkup('sandColor', 'Ground color')}${rangeMarkup('sandVariation')}${rangeMarkup('sandGrain')}`)}
          ${card('Floor shape', 'Actual mesh deformation produces low hills, banks, and irregular forms', `${rangeMarkup('groundIrregularity')}${rangeMarkup('groundMoundHeight')}${rangeMarkup('groundMoundSize')}${rangeMarkup('groundMoundCount')}${rangeMarkup('groundWallFalloff')}${rangeMarkup('groundTerrainDetail')}<div class="action-row"><button class="button button-quiet" id="randomize-ground" type="button">New terrain seed</button></div>`)}
        </section>
      </div>`;
  }

  private bind(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => button.addEventListener('click', () => { this.activeTab = button.dataset.tab as PanelTab; this.refreshTabs(); }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-footprint]').forEach((button) => button.addEventListener('click', () => {
      this.settings.footprint = button.dataset.footprint as FootprintType;
      this.selectedLayoutElement = this.settings.footprint === 'lShape' ? 'lVertical' : this.settings.footprint === 'uShape' ? 'uLeft' : 'bounds';
      normalizeSettings(this.settings); this.ensureSelectedCorner(); this.refresh(); this.callbacks.onChange(this.settings, true);
    }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-profile]').forEach((button) => button.addEventListener('click', () => {
      this.settings.profile = button.dataset.profile as AquariumProfile;
      normalizeSettings(this.settings); this.refresh(); this.callbacks.onChange(this.settings, true);
    }));
    this.root.querySelectorAll<HTMLInputElement>('[data-range-key]').forEach((input) => input.addEventListener('input', () => this.applyNumeric(input.dataset.rangeKey as keyof AquariumSettings, input.value)));
    this.root.querySelectorAll<HTMLInputElement>('[data-number-key]').forEach((input) => input.addEventListener('change', () => this.applyNumeric(input.dataset.numberKey as keyof AquariumSettings, input.value)));
    this.root.querySelectorAll<HTMLInputElement>('[data-color-key]').forEach((input) => input.addEventListener('input', () => this.applyColor(input.dataset.colorKey as 'waterColor' | 'sandColor' | 'subFloorBodyColor' | 'solidWallColor', input.value)));
    this.root.querySelectorAll<HTMLInputElement>('[data-color-text-key]').forEach((input) => input.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(input.value)) this.applyColor(input.dataset.colorTextKey as 'waterColor' | 'sandColor' | 'subFloorBodyColor' | 'solidWallColor', input.value); else this.refresh(); }));

    this.root.querySelector<HTMLButtonElement>('#rotate-layout')!.addEventListener('click', () => {
      const oldRotation = this.settings.footprintRotation;
      const nextRotation = ((oldRotation + 90) % 360) as 0 | 90 | 180 | 270;
      this.reprojectPassages(oldRotation, this.settings.footprintMirrored, nextRotation, this.settings.footprintMirrored);
      this.settings.footprintRotation = nextRotation;
      this.refresh(); this.callbacks.onChange(this.settings, true);
    });
    this.root.querySelector<HTMLButtonElement>('#mirror-layout')!.addEventListener('click', () => {
      const oldMirrored = this.settings.footprintMirrored;
      this.reprojectPassages(this.settings.footprintRotation, oldMirrored, this.settings.footprintRotation, !oldMirrored);
      this.settings.footprintMirrored = !oldMirrored;
      this.refresh(); this.callbacks.onChange(this.settings, true);
    });
    this.root.querySelector<HTMLButtonElement>('#equalize-layout')!.addEventListener('click', () => {
      if (this.settings.footprint === 'lShape') {
        const width = (this.settings.lVerticalArmWidth + this.settings.lHorizontalArmWidth) * 0.5;
        this.settings.lVerticalArmWidth = width; this.settings.lHorizontalArmWidth = width;
      } else if (this.settings.footprint === 'uShape') {
        const width = (this.settings.uLeftArmWidth + this.settings.uRightArmWidth) * 0.5;
        const length = (this.settings.uLeftArmLength + this.settings.uRightArmLength) * 0.5;
        this.settings.uLeftArmWidth = width; this.settings.uRightArmWidth = width; this.settings.uLeftArmLength = length; this.settings.uRightArmLength = length;
      }
      normalizeSettings(this.settings); this.refresh(); this.callbacks.onChange(this.settings, true);
    });

    this.root.querySelector<HTMLInputElement>('#corner-range')!.addEventListener('input', (event) => this.applyCornerRadius((event.target as HTMLInputElement).value));
    this.root.querySelector<HTMLInputElement>('#corner-number')!.addEventListener('change', (event) => this.applyCornerRadius((event.target as HTMLInputElement).value));
    this.root.querySelectorAll<HTMLButtonElement>('[data-corner-mode]').forEach((button) => button.addEventListener('click', () => {
      const targets = this.linkCorners ? this.activeCornerKeys() : [this.selectedCorner];
      for (const key of targets) this.setCornerMode(key, button.dataset.cornerMode as CornerMode);
      normalizeSettings(this.settings); this.refreshCornerEditor(); this.callbacks.onChange(this.settings, true);
    }));
    this.root.querySelector<HTMLButtonElement>('#link-corners')!.addEventListener('click', () => { this.linkCorners = !this.linkCorners; this.refreshCornerEditor(); });
    this.root.querySelectorAll<HTMLButtonElement>('[data-corner-preset]').forEach((button) => button.addEventListener('click', () => {
      const preset = button.dataset.cornerPreset;
      for (const key of this.activeCornerKeys()) {
        const inside = String(key).includes('Inner') || key === 'lInnerElbow';
        this.setCornerMode(key, preset === 'square' ? 'square' : 'rounded');
        this.setCornerRadius(key, preset === 'soft' ? (inside ? 0.72 : 0.48) : preset === 'balanced' ? (inside ? 0.48 : 0.3) : 0.002);
      }
      normalizeSettings(this.settings); this.refreshCornerEditor(); this.callbacks.onChange(this.settings, true);
    }));
    this.root.querySelector<HTMLButtonElement>('#navigation-json')!.addEventListener('click', () => { this.settings.exportNavigationJson = !this.settings.exportNavigationJson; this.refresh(); this.callbacks.onChange(this.settings, false); });
    this.root.querySelectorAll<HTMLButtonElement>('[data-wall-side]').forEach((button) => button.addEventListener('click', () => { const side = button.dataset.wallSide as PassageSide; this.settings.wallModes[side] = this.settings.wallModes[side] === 'solid' ? 'glass' : 'solid'; this.refresh(); this.callbacks.onChange(this.settings, true); }));
    this.root.querySelector<HTMLButtonElement>('#water-animation')!.addEventListener('click', () => { this.settings.waterAnimationEnabled = !this.settings.waterAnimationEnabled; this.refresh(); this.callbacks.onChange(this.settings, false); });

    this.root.querySelectorAll<HTMLButtonElement>('[data-add-passage]').forEach((button) => button.addEventListener('click', () => {
      if (!tunnelAllowed(this.settings)) return;
      const type = button.dataset.addPassage;
      const passage = type === 'alcove' ? createPassage(this.settings, 'alcove', 'straight') : createPassage(this.settings, 'tunnel', type === 'elbow' ? 'elbow' : 'straight');
      this.positionNewPassage(passage);
      this.settings.passages.push(passage); this.selectedPassageId = passage.id; this.activeTab = 'passages'; normalizeSettings(this.settings); this.refresh(); this.callbacks.onChange(this.settings, true);
    }));
    this.root.querySelector<HTMLInputElement>('#passage-name')!.addEventListener('change', (event) => { const passage = this.selectedPassage(); if (!passage) return; passage.name = (event.target as HTMLInputElement).value.trim() || passage.name; this.refreshPassages(); this.callbacks.onChange(this.settings, false); });
    this.root.querySelector<HTMLButtonElement>('#delete-passage')!.addEventListener('click', () => { const index = this.settings.passages.findIndex((passage) => passage.id === this.selectedPassageId); if (index < 0) return; this.settings.passages.splice(index, 1); this.selectedPassageId = this.settings.passages[Math.min(index, this.settings.passages.length - 1)]?.id ?? null; this.refresh(); this.callbacks.onChange(this.settings, true); });
    this.root.querySelector<HTMLButtonElement>('#duplicate-passage')!.addEventListener('click', () => { const source = this.selectedPassage(); if (!source) return; const clone = { ...source, id: `passage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: `${source.name} copy`, entryOffset: source.entryOffset + 0.35, exitOffset: source.exitOffset + 0.35 }; this.settings.passages.push(clone); this.selectedPassageId = clone.id; normalizeSettings(this.settings); this.refresh(); this.callbacks.onChange(this.settings, true); });
    this.root.querySelectorAll<HTMLButtonElement>('[data-entry-side]').forEach((button) => button.addEventListener('click', () => this.setPassageSide('entrySide', button.dataset.entrySide as PassageSide)));
    this.root.querySelectorAll<HTMLButtonElement>('[data-exit-side]').forEach((button) => button.addEventListener('click', () => this.setPassageSide('exitSide', button.dataset.exitSide as PassageSide)));
    this.root.querySelectorAll<HTMLInputElement>('[data-passage-range]').forEach((input) => input.addEventListener('input', () => this.applyPassageNumeric(input.dataset.passageRange as keyof PassageSettings, input.value)));
    this.root.querySelectorAll<HTMLInputElement>('[data-passage-number]').forEach((input) => input.addEventListener('change', () => this.applyPassageNumeric(input.dataset.passageNumber as keyof PassageSettings, input.value)));
    this.root.querySelectorAll<HTMLButtonElement>('[data-passage-shape]').forEach((button) => button.addEventListener('click', () => { const passage = this.selectedPassage(); if (!passage) return; passage.roundness = button.dataset.passageShape === 'square' ? 0 : button.dataset.passageShape === 'soft' ? 0.48 : 0.88; this.refreshPassageEditor(); this.callbacks.onChange(this.settings, true); }));
    this.root.querySelector<HTMLButtonElement>('#passage-glass-floor')!.addEventListener('click', () => { const passage = this.selectedPassage(); if (!passage) return; passage.glassFloor = !passage.glassFloor; this.refreshPassageEditor(); this.callbacks.onChange(this.settings, true); });

    this.root.querySelectorAll<HTMLButtonElement>('[data-ground-preset]').forEach((button) => button.addEventListener('click', () => {
      const preset = button.dataset.groundPreset as GroundPreset; const values = GROUND_PRESETS[preset];
      Object.assign(this.settings, { groundPreset: preset, sandColor: values.color, sandVariation: values.variation, sandGrain: values.grain, groundIrregularity: values.irregularity, groundMoundSize: values.moundSize });
      this.refresh(); this.callbacks.onChange(this.settings, true);
    }));
    this.root.querySelector<HTMLButtonElement>('#randomize-ground')!.addEventListener('click', () => { this.settings.sandSeed = Math.floor(Math.random() * 1_000_000); this.callbacks.onChange(this.settings, true); });
    this.root.querySelectorAll<HTMLButtonElement>('[data-water-preset]').forEach((button) => button.addEventListener('click', () => {
      const preset = button.dataset.waterPreset as WaterSurfacePreset; this.settings.waterSurfacePreset = preset;
      if (preset === 'calm') Object.assign(this.settings, { waterSurfaceStyle: 0.08, waveStrength: 0.12, waterWaveScale: 0.18 });
      else if (preset === 'realistic') Object.assign(this.settings, { waterSurfaceStyle: 0.18, waveStrength: 0.32, waterWaveScale: 0.74 });
      else if (preset === 'balanced') Object.assign(this.settings, { waterSurfaceStyle: 0.5, waveStrength: 0.55, waterWaveScale: 0.48 });
      else if (preset === 'cartoon') Object.assign(this.settings, { waterSurfaceStyle: 0.9, waveStrength: 0.82, waterWaveScale: 0.24 });
      else Object.assign(this.settings, { waterSurfaceStyle: 0.96, waveStrength: 0.72, waterWaveScale: 0.58 });
      this.refresh(); this.callbacks.onChange(this.settings, false);
    }));

    document.querySelector<HTMLInputElement>('#export-scale-number')!.addEventListener('change', (event) => { const value = Number.parseFloat((event.target as HTMLInputElement).value); if (Number.isFinite(value) && value > 0) this.settings.exportScale = value; normalizeSettings(this.settings); this.refresh(); this.callbacks.onChange(this.settings, false); });
    document.querySelector<HTMLButtonElement>('#reset-button')!.addEventListener('click', () => { const defaults = cloneSettings(DEFAULT_SETTINGS); this.settings = defaults; this.selectedPassageId = null; this.callbacks.onReset(defaults); this.ensureSelectedCorner(); this.refresh(); });
    document.querySelector<HTMLButtonElement>('#share-button')!.addEventListener('click', this.callbacks.onShare);
    document.querySelector<HTMLButtonElement>('#download-button')!.addEventListener('click', this.callbacks.onDownload);
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.addEventListener('click', () => { const view = button.dataset.view as 'iso' | 'front' | 'side' | 'top' | 'fit'; this.callbacks.onView(view); if (view !== 'fit') { document.querySelectorAll('[data-view]').forEach((item) => item.classList.remove('is-active')); button.classList.add('is-active'); } }));
  }

  private portalBetweenLayoutStates(
    side: PassageSide,
    offset: number,
    oldRotation: 0 | 90 | 180 | 270,
    oldMirrored: boolean,
    nextRotation: 0 | 90 | 180 | 270,
    nextMirrored: boolean,
  ): { side: PassageSide; offset: number } {
    const oldRotated = oldRotation === 90 || oldRotation === 270;
    const halfW = (oldRotated ? this.settings.depth : this.settings.width) * 0.5;
    const halfD = (oldRotated ? this.settings.width : this.settings.depth) * 0.5;
    const worldPoint = side === 'front' ? new THREE.Vector2(offset, halfD)
      : side === 'back' ? new THREE.Vector2(offset, -halfD)
        : side === 'left' ? new THREE.Vector2(-halfW, offset)
          : new THREE.Vector2(halfW, offset);
    const worldDirection = side === 'front' ? new THREE.Vector2(0, 1)
      : side === 'back' ? new THREE.Vector2(0, -1)
        : side === 'left' ? new THREE.Vector2(-1, 0)
          : new THREE.Vector2(1, 0);

    const inverse = (vector: THREE.Vector2): THREE.Vector2 => {
      const local = vector.clone().rotateAround(new THREE.Vector2(), THREE.MathUtils.degToRad(oldRotation));
      if (oldMirrored) local.x *= -1;
      return local;
    };
    const forward = (vector: THREE.Vector2): THREE.Vector2 => {
      const transformed = vector.clone();
      if (nextMirrored) transformed.x *= -1;
      return transformed.rotateAround(new THREE.Vector2(), -THREE.MathUtils.degToRad(nextRotation));
    };
    const point = forward(inverse(worldPoint));
    const direction = forward(inverse(worldDirection));
    const nextSide: PassageSide = Math.abs(direction.x) > Math.abs(direction.y)
      ? direction.x > 0 ? 'right' : 'left'
      : direction.y > 0 ? 'front' : 'back';
    return { side: nextSide, offset: nextSide === 'front' || nextSide === 'back' ? point.x : point.y };
  }

  private reprojectPassages(
    oldRotation: 0 | 90 | 180 | 270,
    oldMirrored: boolean,
    nextRotation: 0 | 90 | 180 | 270,
    nextMirrored: boolean,
  ): void {
    for (const passage of this.settings.passages) {
      const originalEntrySide = passage.entrySide;
      const originalExitSide = passage.exitSide;
      const originalEntryOffset = passage.entryOffset;
      const originalExitOffset = passage.exitOffset;
      const entry = this.portalBetweenLayoutStates(originalEntrySide, originalEntryOffset, oldRotation, oldMirrored, nextRotation, nextMirrored);
      passage.entrySide = entry.side;
      passage.entryOffset = entry.offset;
      if (passage.kind === 'tunnel') {
        const exit = this.portalBetweenLayoutStates(originalExitSide, passage.route === 'straight' ? originalEntryOffset : originalExitOffset, oldRotation, oldMirrored, nextRotation, nextMirrored);
        passage.exitSide = exit.side;
        passage.exitOffset = exit.offset;
      }
    }
  }

  private transformedSide(side: PassageSide): PassageSide {
    const direction = side === 'front' ? new THREE.Vector2(0, 1)
      : side === 'back' ? new THREE.Vector2(0, -1)
        : side === 'left' ? new THREE.Vector2(-1, 0)
          : new THREE.Vector2(1, 0);
    if (this.settings.footprintMirrored) direction.x *= -1;
    direction.rotateAround(new THREE.Vector2(), -THREE.MathUtils.degToRad(this.settings.footprintRotation));
    if (Math.abs(direction.x) > Math.abs(direction.y)) return direction.x > 0 ? 'right' : 'left';
    return direction.y > 0 ? 'front' : 'back';
  }

  private transformedPortal(side: PassageSide, offset: number): { side: PassageSide; offset: number } {
    const halfW = this.settings.width * 0.5;
    const halfD = this.settings.depth * 0.5;
    const point = side === 'front' ? new THREE.Vector2(offset, halfD)
      : side === 'back' ? new THREE.Vector2(offset, -halfD)
        : side === 'left' ? new THREE.Vector2(-halfW, offset)
          : new THREE.Vector2(halfW, offset);
    const transformed = this.transformPoint(point);
    const worldSide = this.transformedSide(side);
    return { side: worldSide, offset: worldSide === 'front' || worldSide === 'back' ? transformed.x : transformed.y };
  }

  private positionNewPassage(passage: PassageSettings): void {
    let entrySide: PassageSide = 'front';
    let exitSide: PassageSide = passage.route === 'elbow' ? 'right' : 'back';
    let entryOffset = 0;
    let exitOffset = 0;

    if (this.settings.footprint === 'lShape') {
      entryOffset = -this.settings.lHorizontalArmLength * 0.5 + this.settings.lVerticalArmWidth * 0.5;
      if (passage.route === 'elbow') {
        exitSide = 'right';
        exitOffset = -this.settings.lVerticalArmLength * 0.5 + this.settings.lHorizontalArmWidth * 0.5;
      }
    } else if (this.settings.footprint === 'uShape') {
      entryOffset = -this.settings.uBridgeLength * 0.5 + this.settings.uLeftArmWidth * 0.5;
      if (passage.route === 'elbow') {
        exitSide = 'left';
        exitOffset = -Math.max(this.settings.uLeftArmLength, this.settings.uRightArmLength) * 0.5 + this.settings.uBridgeDepth * 0.5;
      }
    }

    const entry = this.transformedPortal(entrySide, entryOffset);
    passage.entrySide = entry.side;
    passage.entryOffset = entry.offset;
    if (passage.kind === 'tunnel') {
      const exit = this.transformedPortal(exitSide, passage.route === 'straight' ? entryOffset : exitOffset);
      passage.exitSide = exit.side;
      passage.exitOffset = exit.offset;
    }
  }

  private applyCornerRadius(raw: string): void {
    const value = Number.parseFloat(raw); if (!Number.isFinite(value) || value <= 0) { this.refreshCornerEditor(); return; }
    for (const key of this.linkCorners ? this.activeCornerKeys() : [this.selectedCorner]) this.setCornerRadius(key, value);
    normalizeSettings(this.settings); this.refreshCornerEditor(); this.callbacks.onChange(this.settings, true);
  }

  private applyNumeric(key: keyof AquariumSettings, raw: string): void {
    const definition = RANGE_DEFINITIONS.find((item) => item.key === key); if (!definition) return;
    const value = Number.parseFloat(raw); if (!Number.isFinite(value)) return;
    (this.settings as unknown as Record<string, unknown>)[key] = value;
    normalizeSettings(this.settings); this.refresh(); this.callbacks.onChange(this.settings, definition.structural ?? false);
  }

  private applyPassageNumeric(key: keyof PassageSettings, raw: string): void {
    const passage = this.selectedPassage(); if (!passage) return;
    const value = Number.parseFloat(raw); if (!Number.isFinite(value)) return;
    (passage as unknown as Record<string, unknown>)[key] = value;
    normalizeSettings(this.settings); this.refreshPassageEditor(); this.refreshLayoutPreview(); this.callbacks.onChange(this.settings, true);
  }

  private setPassageSide(key: 'entrySide' | 'exitSide', side: PassageSide): void {
    const passage = this.selectedPassage(); if (!passage) return;
    if (key === 'entrySide') {
      passage.entrySide = side;
      if (passage.route === 'straight') passage.exitSide = oppositeSide(side);
      else if (!sidesAreAdjacent(side, passage.exitSide)) passage.exitSide = side === 'front' || side === 'back' ? 'right' : 'front';
    } else if (passage.route === 'elbow' && sidesAreAdjacent(passage.entrySide, side)) passage.exitSide = side;
    else if (passage.route === 'straight') passage.exitSide = oppositeSide(passage.entrySide);
    normalizeSettings(this.settings); this.refreshPassageEditor(); this.refreshLayoutPreview(); this.callbacks.onChange(this.settings, true);
  }

  private applyColor(key: 'waterColor' | 'sandColor' | 'subFloorBodyColor' | 'solidWallColor', value: string): void {
    this.settings[key] = value; this.refresh(); this.callbacks.onChange(this.settings, key === 'subFloorBodyColor');
  }

  private refresh(): void {
    this.refreshTabs();
    this.root.querySelectorAll<HTMLButtonElement>('[data-footprint]').forEach((button) => button.classList.toggle('is-active', button.dataset.footprint === this.settings.footprint));
    this.root.querySelectorAll<HTMLButtonElement>('[data-profile]').forEach((button) => button.classList.toggle('is-active', button.dataset.profile === this.settings.profile));
    this.root.querySelectorAll<HTMLButtonElement>('[data-ground-preset]').forEach((button) => button.classList.toggle('is-active', button.dataset.groundPreset === this.settings.groundPreset));
    this.root.querySelectorAll<HTMLButtonElement>('[data-water-preset]').forEach((button) => button.classList.toggle('is-active', button.dataset.waterPreset === this.settings.waterSurfacePreset));
    this.refreshTopLevelRanges();
    this.refreshHeight();
    this.refreshLayoutInspector();
    this.refreshLayoutPreview();
    this.refreshCornerEditor();
    this.refreshPassages();
    this.refreshColors();
    const nav = this.root.querySelector<HTMLButtonElement>('#navigation-json')!; nav.classList.toggle('is-on', this.settings.exportNavigationJson); nav.setAttribute('aria-checked', String(this.settings.exportNavigationJson));
    const exportScale = document.querySelector<HTMLInputElement>('#export-scale-number')!; exportScale.value = String(Number(this.settings.exportScale.toFixed(4)));
    const physicalHeight = this.settings.profile === 'belowFloor' ? this.settings.heightAboveFloor + this.settings.depthBelowFloor : this.settings.profile === 'touchPool' ? this.settings.touchPoolHeight : this.settings.height;
    const rotated = this.settings.footprintRotation === 90 || this.settings.footprintRotation === 270;
    const exportWidth = (rotated ? this.settings.depth : this.settings.width) * this.settings.exportScale;
    const exportDepth = (rotated ? this.settings.width : this.settings.depth) * this.settings.exportScale;
    document.querySelector<HTMLElement>('#footer-export-dimensions')!.textContent = `${exportWidth.toFixed(0)} × ${exportDepth.toFixed(0)} × ${(physicalHeight * this.settings.exportScale).toFixed(0)} units`;
  }

  private refreshTabs(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === this.activeTab));
    this.root.querySelectorAll<HTMLElement>('[data-tab-panel]').forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== this.activeTab; });
  }

  private refreshTopLevelRanges(): void {
    for (const definition of RANGE_DEFINITIONS) {
      const value = this.settings[definition.key]; if (typeof value !== 'number') continue;
      const range = this.root.querySelector<HTMLInputElement>(`[data-range-key="${definition.key}"]`);
      const number = this.root.querySelector<HTMLInputElement>(`[data-number-key="${definition.key}"]`);
      const output = this.root.querySelector<HTMLOutputElement>(`#${definition.key}-output`);
      if (range) { range.value = String(Math.min(definition.max, Math.max(definition.min, value))); range.classList.toggle('is-overridden', value < definition.min || value > definition.max); }
      if (number) number.value = String(Number(value.toFixed(definition.step < 0.01 ? 3 : 2)));
      if (output) output.textContent = definition.format ? definition.format(value) : definition.unit ? `${value.toFixed(value < 1 ? 3 : 2)} ${definition.unit}` : value.toFixed(2);
    }
  }

  private refreshHeight(): void {
    this.root.querySelector<HTMLElement>('#standard-height-section')!.hidden = this.settings.profile !== 'standard';
    this.root.querySelector<HTMLElement>('#below-height-section')!.hidden = this.settings.profile !== 'belowFloor';
    this.root.querySelector<HTMLElement>('#touch-height-section')!.hidden = this.settings.profile !== 'touchPool';
    this.root.querySelector<HTMLElement>('#standard-water-level')!.hidden = this.settings.profile === 'touchPool';
    this.root.querySelector<HTMLElement>('#profile-note')!.textContent = this.settings.profile === 'touchPool' ? 'Touch pools use opaque basin walls and disable passages.' : this.settings.profile === 'belowFloor' ? 'The opaque body continues below Y = 0. Bridge passages preserve water underneath.' : 'Standard display profile with clear acrylic walls.';
  }

  private refreshLayoutInspector(): void {
    const rectangle = this.settings.footprint === 'rectangle';
    this.root.querySelector<HTMLElement>('#rectangle-layout-controls')!.hidden = !rectangle;
    this.root.querySelector<HTMLElement>('#selected-layout-card')!.hidden = rectangle;
    const ids: Array<[string, LayoutElement]> = [['l-vertical-controls', 'lVertical'], ['l-horizontal-controls', 'lHorizontal'], ['u-left-controls', 'uLeft'], ['u-right-controls', 'uRight'], ['u-bridge-controls', 'uBridge']];
    for (const [id, element] of ids) this.root.querySelector<HTMLElement>(`#${id}`)!.hidden = rectangle || element !== this.selectedLayoutElement;
    if (!rectangle) {
      const allowed: LayoutElement[] = this.settings.footprint === 'lShape' ? ['lVertical', 'lHorizontal'] : ['uLeft', 'uRight', 'uBridge'];
      if (!allowed.includes(this.selectedLayoutElement)) this.selectedLayoutElement = allowed[0]!;
      const names: Record<LayoutElement, string> = { bounds: 'Overall layout', lVertical: 'L vertical arm', lHorizontal: 'L horizontal arm', uLeft: 'U left arm', uRight: 'U right arm', uBridge: 'U rear connector' };
      this.root.querySelector<HTMLElement>('#selected-layout-name')!.textContent = names[this.selectedLayoutElement];
      for (const [id, element] of ids) this.root.querySelector<HTMLElement>(`#${id}`)!.hidden = element !== this.selectedLayoutElement;
    }
  }

  private transformPoint(point: THREE.Vector2): THREE.Vector2 {
    const transformed = point.clone();
    if (this.settings.footprintMirrored) transformed.x *= -1;
    transformed.rotateAround(new THREE.Vector2(), -THREE.MathUtils.degToRad(this.settings.footprintRotation));
    return transformed;
  }

  private worldSidePoint(side: PassageSide, offset: number, extra = 0): THREE.Vector2 {
    const halfW = this.settings.width * 0.5 + extra; const halfD = this.settings.depth * 0.5 + extra;
    if (side === 'front') return new THREE.Vector2(offset, halfD);
    if (side === 'back') return new THREE.Vector2(offset, -halfD);
    if (side === 'left') return new THREE.Vector2(-halfW, offset);
    return new THREE.Vector2(halfW, offset);
  }

  private passagePolyline(passage: PassageSettings): THREE.Vector2[] {
    const entry = this.worldSidePoint(passage.entrySide, passage.entryOffset, 0.3);
    if (passage.kind === 'alcove') {
      const direction = passage.entrySide === 'front' ? new THREE.Vector2(0, -1) : passage.entrySide === 'back' ? new THREE.Vector2(0, 1) : passage.entrySide === 'left' ? new THREE.Vector2(1, 0) : new THREE.Vector2(-1, 0);
      return [entry, entry.clone().addScaledVector(direction, passage.alcoveDepth)];
    }
    const exit = this.worldSidePoint(passage.exitSide, passage.route === 'straight' ? passage.entryOffset : passage.exitOffset, 0.3);
    if (passage.route === 'straight') return [entry, exit];
    const bend = passage.entrySide === 'front' || passage.entrySide === 'back' ? new THREE.Vector2(passage.entryOffset, passage.exitOffset) : new THREE.Vector2(passage.exitOffset, passage.entryOffset);
    return [entry, bend, exit];
  }

  private refreshLayoutPreview(): void {
    const loop = createFootprintShapeLoop(this.settings, 0);
    const water = createFootprintShapeLoop(this.settings, -(this.settings.glassThickness + this.settings.waterWallGap));
    const box = new THREE.Box2().setFromPoints(loop); const size = box.getSize(new THREE.Vector2()); const center = box.getCenter(new THREE.Vector2());
    const scale = Math.min(210 / Math.max(size.x, 0.1), 116 / Math.max(size.y, 0.1));
    const toScreen = (point: THREE.Vector2) => new THREE.Vector2(130 + (point.x - center.x) * scale, 77 + (point.y - center.y) * scale);
    const path = (points: THREE.Vector2[]) => `${points.map((point, index) => { const p = toScreen(point); return `${index === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`; }).join(' ')} Z`;
    this.root.querySelector<SVGPathElement>('#layout-outline')!.setAttribute('d', path(loop));
    this.root.querySelector<SVGPathElement>('#layout-water')!.setAttribute('d', path(water));

    const hotspots = this.root.querySelector<SVGGElement>('#layout-element-hotspots')!;
    const polygons: Array<{ id: LayoutElement; label: string; points: THREE.Vector2[] }> = [];
    if (this.settings.footprint === 'lShape') {
      const w = this.settings.lHorizontalArmLength; const d = this.settings.lVerticalArmLength; const left = -w / 2; const back = -d / 2;
      polygons.push({ id: 'lVertical', label: 'Vertical arm', points: [new THREE.Vector2(left, back), new THREE.Vector2(left + this.settings.lVerticalArmWidth, back), new THREE.Vector2(left + this.settings.lVerticalArmWidth, back + d), new THREE.Vector2(left, back + d)].map((p) => this.transformPoint(p)) });
      polygons.push({ id: 'lHorizontal', label: 'Horizontal arm', points: [new THREE.Vector2(left, back), new THREE.Vector2(left + w, back), new THREE.Vector2(left + w, back + this.settings.lHorizontalArmWidth), new THREE.Vector2(left, back + this.settings.lHorizontalArmWidth)].map((p) => this.transformPoint(p)) });
    } else if (this.settings.footprint === 'uShape') {
      const w = this.settings.uBridgeLength; const d = Math.max(this.settings.uLeftArmLength, this.settings.uRightArmLength); const left = -w / 2; const right = w / 2; const back = -d / 2;
      polygons.push({ id: 'uLeft', label: 'Left arm', points: [new THREE.Vector2(left, back), new THREE.Vector2(left + this.settings.uLeftArmWidth, back), new THREE.Vector2(left + this.settings.uLeftArmWidth, back + this.settings.uLeftArmLength), new THREE.Vector2(left, back + this.settings.uLeftArmLength)].map((p) => this.transformPoint(p)) });
      polygons.push({ id: 'uRight', label: 'Right arm', points: [new THREE.Vector2(right - this.settings.uRightArmWidth, back), new THREE.Vector2(right, back), new THREE.Vector2(right, back + this.settings.uRightArmLength), new THREE.Vector2(right - this.settings.uRightArmWidth, back + this.settings.uRightArmLength)].map((p) => this.transformPoint(p)) });
      polygons.push({ id: 'uBridge', label: 'Rear connector', points: [new THREE.Vector2(left, back), new THREE.Vector2(right, back), new THREE.Vector2(right, back + this.settings.uBridgeDepth), new THREE.Vector2(left, back + this.settings.uBridgeDepth)].map((p) => this.transformPoint(p)) });
    }
    hotspots.innerHTML = polygons.map((polygon) => `<polygon data-layout-element="${polygon.id}" class="layout-element ${polygon.id === this.selectedLayoutElement ? 'is-selected' : ''}" points="${polygon.points.map((point) => { const p = toScreen(point); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ')}"><title>${polygon.label}</title></polygon>`).join('');
    hotspots.querySelectorAll<SVGPolygonElement>('[data-layout-element]').forEach((element) => element.addEventListener('click', () => { this.selectedLayoutElement = element.dataset.layoutElement as LayoutElement; this.refreshLayoutInspector(); this.refreshLayoutPreview(); }));

    const routes = this.root.querySelector<SVGGElement>('#layout-passage-lines')!;
    routes.innerHTML = this.settings.passages.map((passage) => { const points = this.passagePolyline(passage).map(toScreen); return `<polyline class="layout-passage ${passage.id === this.selectedPassageId ? 'is-selected' : ''}" points="${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"></polyline>`; }).join('');
  }

  private rawCornerAnchors(): Array<{ key: SelectedCorner; point: THREE.Vector2 }> {
    const w = this.settings.width; const d = this.settings.depth; const left = -w / 2; const right = w / 2; const back = -d / 2; const front = d / 2;
    if (this.settings.footprint === 'rectangle') return [{ key: 'backLeft', point: new THREE.Vector2(left, back) }, { key: 'backRight', point: new THREE.Vector2(right, back) }, { key: 'frontRight', point: new THREE.Vector2(right, front) }, { key: 'frontLeft', point: new THREE.Vector2(left, front) }];
    if (this.settings.footprint === 'lShape') return [
      { key: 'lBackLeft', point: this.transformPoint(new THREE.Vector2(left, back)) }, { key: 'lBackRight', point: this.transformPoint(new THREE.Vector2(right, back)) },
      { key: 'lOuterRight', point: this.transformPoint(new THREE.Vector2(right, back + this.settings.lHorizontalArmWidth)) }, { key: 'lInnerElbow', point: this.transformPoint(new THREE.Vector2(left + this.settings.lVerticalArmWidth, back + this.settings.lHorizontalArmWidth)) },
      { key: 'lFrontRight', point: this.transformPoint(new THREE.Vector2(left + this.settings.lVerticalArmWidth, front)) }, { key: 'lFrontLeft', point: this.transformPoint(new THREE.Vector2(left, front)) },
    ];
    const uBack = -Math.max(this.settings.uLeftArmLength, this.settings.uRightArmLength) / 2;
    return [
      { key: 'uBackLeft', point: this.transformPoint(new THREE.Vector2(left, uBack)) }, { key: 'uBackRight', point: this.transformPoint(new THREE.Vector2(right, uBack)) },
      { key: 'uFrontRight', point: this.transformPoint(new THREE.Vector2(right, uBack + this.settings.uRightArmLength)) }, { key: 'uMouthRight', point: this.transformPoint(new THREE.Vector2(right - this.settings.uRightArmWidth, uBack + this.settings.uRightArmLength)) },
      { key: 'uInnerRight', point: this.transformPoint(new THREE.Vector2(right - this.settings.uRightArmWidth, uBack + this.settings.uBridgeDepth)) }, { key: 'uInnerLeft', point: this.transformPoint(new THREE.Vector2(left + this.settings.uLeftArmWidth, uBack + this.settings.uBridgeDepth)) },
      { key: 'uMouthLeft', point: this.transformPoint(new THREE.Vector2(left + this.settings.uLeftArmWidth, uBack + this.settings.uLeftArmLength)) }, { key: 'uFrontLeft', point: this.transformPoint(new THREE.Vector2(left, uBack + this.settings.uLeftArmLength)) },
    ];
  }

  private refreshCornerEditor(): void {
    this.ensureSelectedCorner(); const maxRadius = Math.max(0.02, Math.min(this.settings.width, this.settings.depth) * 0.49); const mode = this.getCornerMode(this.selectedCorner);
    const range = this.root.querySelector<HTMLInputElement>('#corner-range')!; range.max = String(maxRadius); range.value = String(Math.min(maxRadius, this.getCornerRadius(this.selectedCorner))); range.disabled = mode === 'square';
    const number = this.root.querySelector<HTMLInputElement>('#corner-number')!; number.value = String(Number(this.getCornerRadius(this.selectedCorner).toFixed(3))); number.disabled = mode === 'square';
    this.root.querySelector<HTMLElement>('#corner-radius-control')!.classList.toggle('is-disabled', mode === 'square');
    this.root.querySelector<HTMLOutputElement>('#corner-output')!.textContent = mode === 'square' ? 'Sharp' : `${this.getCornerRadius(this.selectedCorner).toFixed(2)} m`;
    this.root.querySelector<HTMLElement>('#selected-corner-name')!.textContent = this.cornerName(this.selectedCorner);
    this.root.querySelectorAll<HTMLButtonElement>('[data-corner-mode]').forEach((button) => button.classList.toggle('is-active', button.dataset.cornerMode === mode));
    const linked = this.root.querySelector<HTMLButtonElement>('#link-corners')!; linked.setAttribute('aria-checked', String(this.linkCorners)); linked.classList.toggle('is-on', this.linkCorners);

    const body = createFootprintShapeLoop(this.settings, 0); const frame = createFootprintShapeLoop(this.settings, this.settings.frameOverhang); const water = createFootprintShapeLoop(this.settings, -(this.settings.glassThickness + this.settings.waterWallGap));
    const box = new THREE.Box2().setFromPoints(frame); const size = box.getSize(new THREE.Vector2()); const center = box.getCenter(new THREE.Vector2()); const scale = Math.min(190 / Math.max(size.x, .1), 100 / Math.max(size.y, .1));
    const screen = (p: THREE.Vector2) => new THREE.Vector2(120 + (p.x - center.x) * scale, 70 + (p.y - center.y) * scale); const path = (points: THREE.Vector2[]) => `${points.map((point, index) => { const p = screen(point); return `${index === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`; }).join(' ')} Z`;
    this.root.querySelector<SVGPathElement>('#corner-preview-frame')!.setAttribute('d', path(frame)); this.root.querySelector<SVGPathElement>('#corner-preview-path')!.setAttribute('d', path(body)); this.root.querySelector<SVGPathElement>('#corner-preview-water')!.setAttribute('d', path(water));
    const tunnel = this.root.querySelector<SVGPathElement>('#corner-preview-tunnel')!; const selected = this.selectedPassage();
    if (selected) { const points = this.passagePolyline(selected).map(screen); tunnel.setAttribute('d', points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')); tunnel.style.display = ''; } else tunnel.style.display = 'none';
    const hotspots = this.root.querySelector<SVGGElement>('#corner-hotspots')!; hotspots.innerHTML = this.rawCornerAnchors().map(({ key, point }) => { const p = screen(point); return `<g class="corner-hotspot ${key === this.selectedCorner ? 'is-selected' : ''}" data-corner="${key}" transform="translate(${p.x} ${p.y})"><circle r="11"></circle><text>${cornerShortLabel(key)}</text></g>`; }).join('');
    hotspots.querySelectorAll<SVGGElement>('[data-corner]').forEach((element) => element.addEventListener('click', () => { this.selectedCorner = element.dataset.corner as SelectedCorner; this.refreshCornerEditor(); }));
    const values = this.root.querySelector<HTMLElement>('#corner-values')!; values.innerHTML = this.activeCornerKeys().map((key) => `<button type="button" data-corner-value="${key}" class="${key === this.selectedCorner ? 'is-selected' : ''}"><span>${cornerShortLabel(key)}</span><strong>${this.getCornerMode(key) === 'square' ? 'SQ' : this.getCornerRadius(key).toFixed(2)}</strong></button>`).join('');
    values.querySelectorAll<HTMLButtonElement>('[data-corner-value]').forEach((button) => button.addEventListener('click', () => { this.selectedCorner = button.dataset.cornerValue as SelectedCorner; this.refreshCornerEditor(); }));
  }

  private refreshPassages(): void {
    const allowed = tunnelAllowed(this.settings); this.root.querySelector<HTMLElement>('#passage-incompatible')!.hidden = allowed;
    this.root.querySelectorAll<HTMLButtonElement>('[data-add-passage]').forEach((button) => { button.disabled = !allowed; });
    const list = this.root.querySelector<HTMLElement>('#passage-list')!;
    list.innerHTML = this.settings.passages.map((passage, index) => `<button type="button" data-passage-id="${passage.id}" class="${passage.id === this.selectedPassageId ? 'is-active' : ''}"><span class="passage-index">${index + 1}</span><span><strong>${passage.name}</strong><small>${passage.kind === 'alcove' ? 'Viewing alcove' : passage.route === 'elbow' ? 'L tunnel' : 'Straight tunnel'} · ${SIDE_LABELS[passage.entrySide]}</small></span></button>`).join('');
    list.querySelectorAll<HTMLButtonElement>('[data-passage-id]').forEach((button) => button.addEventListener('click', () => { this.selectedPassageId = button.dataset.passageId!; this.refreshPassages(); this.refreshLayoutPreview(); this.refreshCornerEditor(); }));
    this.root.querySelector<HTMLElement>('#empty-passage-state')!.hidden = this.settings.passages.length > 0;
    this.root.querySelector<HTMLElement>('#passage-editor-wrap')!.hidden = !this.selectedPassage();
    this.refreshPassageEditor();
  }

  private refreshPassageEditor(): void {
    const passage = this.selectedPassage(); if (!passage) return;
    this.root.querySelector<HTMLInputElement>('#passage-name')!.value = passage.name;
    this.root.querySelector<HTMLElement>('#passage-kind-label')!.textContent = passage.kind === 'alcove' ? 'Viewing alcove' : 'Through tunnel';
    this.root.querySelector<HTMLElement>('#passage-route-label')!.textContent = passage.kind === 'alcove' ? 'One entrance · closed glass end' : passage.route === 'elbow' ? 'One 90° bend' : 'Straight route';
    this.root.querySelector<HTMLElement>('#exit-side-block')!.hidden = passage.kind === 'alcove';
    this.root.querySelector<HTMLElement>('#passage-exit-offset')!.hidden = passage.kind === 'alcove' || passage.route === 'straight';
    const bendControl = this.root.querySelector<HTMLElement>('#passage-bend-radius'); if (bendControl) bendControl.hidden = passage.route !== 'elbow';
    this.root.querySelector<HTMLElement>('#passage-alcove-depth')!.hidden = passage.kind !== 'alcove';
    this.root.querySelector<HTMLElement>('#passage-bridge-options')!.hidden = this.settings.profile !== 'belowFloor';
    this.root.querySelectorAll<HTMLButtonElement>('[data-entry-side]').forEach((button) => button.classList.toggle('is-active', button.dataset.entrySide === passage.entrySide));
    this.root.querySelectorAll<HTMLButtonElement>('[data-exit-side]').forEach((button) => { const side = button.dataset.exitSide as PassageSide; button.classList.toggle('is-active', side === passage.exitSide); button.disabled = passage.route === 'straight' ? side !== oppositeSide(passage.entrySide) : !sidesAreAdjacent(passage.entrySide, side); });
    for (const definition of PASSAGE_RANGES) {
      const value = passage[definition.key]; if (typeof value !== 'number') continue;
      const range = this.root.querySelector<HTMLInputElement>(`[data-passage-range="${definition.key}"]`)!; const number = this.root.querySelector<HTMLInputElement>(`[data-passage-number="${definition.key}"]`)!; const output = this.root.querySelector<HTMLOutputElement>(`[data-passage-output="${definition.key}"]`)!;
      range.value = String(Math.min(definition.max, Math.max(definition.min, value))); range.classList.toggle('is-overridden', value < definition.min || value > definition.max); number.value = String(Number(value.toFixed(definition.step < .01 ? 3 : 2))); output.textContent = definition.format ? definition.format(value) : definition.unit ? `${value.toFixed(value < 1 ? 3 : 2)} ${definition.unit}` : value.toFixed(2);
    }
    const glassFloor = this.root.querySelector<HTMLButtonElement>('#passage-glass-floor')!; glassFloor.classList.toggle('is-on', passage.glassFloor); glassFloor.setAttribute('aria-checked', String(passage.glassFloor));
    const shape = passage.roundness <= .015 ? 'square' : passage.roundness < .7 ? 'soft' : 'arch'; this.root.querySelectorAll<HTMLButtonElement>('[data-passage-shape]').forEach((button) => button.classList.toggle('is-active', button.dataset.passageShape === shape));
    this.refreshPassageMap();
  }

  private refreshPassageMap(): void {
    const loop = createFootprintShapeLoop(this.settings, 0); const box = new THREE.Box2().setFromPoints(loop); const size = box.getSize(new THREE.Vector2()); const center = box.getCenter(new THREE.Vector2()); const scale = Math.min(210 / Math.max(size.x,.1), 116 / Math.max(size.y,.1));
    const screen = (p: THREE.Vector2) => new THREE.Vector2(130 + (p.x-center.x)*scale,77+(p.y-center.y)*scale); const path = `${loop.map((point,index)=>{const p=screen(point);return `${index===0?'M':'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;}).join(' ')} Z`;
    this.root.querySelector<SVGPathElement>('#passage-map-outline')!.setAttribute('d', path);
    const routes = this.root.querySelector<SVGGElement>('#passage-map-routes')!; routes.innerHTML = this.settings.passages.map((passage) => { const points=this.passagePolyline(passage).map(screen); const half=Math.max(3,passage.width*scale*.5); return `<polyline class="passage-route-halo ${passage.id===this.selectedPassageId?'is-selected':''}" style="stroke-width:${(half*2).toFixed(1)}" points="${points.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"></polyline><polyline class="passage-route-line ${passage.id===this.selectedPassageId?'is-selected':''}" points="${points.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"></polyline>`; }).join('');
  }

  private refreshColors(): void {
    for (const key of ['waterColor', 'sandColor', 'subFloorBodyColor'] as const) { this.root.querySelector<HTMLInputElement>(`#${key}-color`)!.value = this.settings[key]; this.root.querySelector<HTMLInputElement>(`#${key}-text`)!.value = this.settings[key].toUpperCase(); }
  }
}
