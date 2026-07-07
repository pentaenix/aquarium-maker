import type { AquariumSettings, CornerRadii } from '../model/settings';
import { cloneSettings, DEFAULT_SETTINGS, normalizeSettings } from '../model/settings';

export type SelectedCorner = keyof CornerRadii;

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

const RANGE_DEFINITIONS: RangeDefinition[] = [
  { key: 'width', label: 'Width', min: 2, max: 30, step: 0.1, unit: 'm', structural: true },
  { key: 'depth', label: 'Depth', min: 1, max: 15, step: 0.1, unit: 'm', structural: true },
  { key: 'height', label: 'Height', min: 1, max: 12, step: 0.1, unit: 'm', structural: true },
  { key: 'waterLevel', label: 'Water level', min: 0.2, max: 0.97, step: 0.01, structural: true, format: (value) => `${Math.round(value * 100)}%` },
  { key: 'waterTint', label: 'Side tint', min: 0, max: 1, step: 0.01, format: (value) => `${Math.round(value * 100)}%` },
  { key: 'waveStrength', label: 'Wave detail', min: 0, max: 1, step: 0.01, format: (value) => `${Math.round(value * 100)}%` },
  { key: 'sandVariation', label: 'Color variation', min: 0, max: 1, step: 0.01, format: (value) => `${Math.round(value * 100)}%` },
  { key: 'sandGrain', label: 'Grain scale', min: 0.1, max: 2.5, step: 0.05, format: (value) => value.toFixed(2) },
  { key: 'baseHeight', label: 'Base thickness', min: 0.02, max: 0.5, step: 0.005, unit: 'm', structural: true },
  { key: 'bottomRimHeight', label: 'Lower rim', min: 0.02, max: 0.5, step: 0.005, unit: 'm', structural: true },
  { key: 'topRimHeight', label: 'Upper rim', min: 0.02, max: 0.6, step: 0.005, unit: 'm', structural: true },
  { key: 'glassThickness', label: 'Acrylic thickness', min: 0.01, max: 0.25, step: 0.005, unit: 'm', structural: true },
  { key: 'baseOverhang', label: 'Base overhang', min: 0, max: 0.5, step: 0.005, unit: 'm', structural: true },
  { key: 'frameOverhang', label: 'Rim overhang', min: 0, max: 0.3, step: 0.005, unit: 'm', structural: true },
  { key: 'frameOverlap', label: 'Rim overlap', min: 0.01, max: 0.3, step: 0.005, unit: 'm', structural: true },
  { key: 'curveSegments', label: 'Curve quality', min: 2, max: 12, step: 1, structural: true, format: (value) => `${Math.round(value)} segments` },
  { key: 'rimRoundness', label: 'Rim roundness', min: 0.05, max: 1, step: 0.01, structural: true, format: (value) => `${Math.round(value * 100)}%` },
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

export class ControlPanel {
  private settings: AquariumSettings;
  private readonly root: HTMLElement;
  private readonly callbacks: PanelCallbacks;
  private selectedCorner: SelectedCorner = 'frontLeft';
  private linkCorners = false;

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
    this.root.innerHTML = `
      <details class="control-section" open>
        <summary><span><strong>Size</strong><small>Overall authored dimensions</small></span><svg viewBox="0 0 24 24"><path d="m8 10 4 4 4-4" /></svg></summary>
        <div class="section-body">
          ${rangeMarkup('width')}
          ${rangeMarkup('depth')}
          ${rangeMarkup('height')}
          <p class="section-note">Dimensions are shown in meters. Export scaling is applied only when downloading.</p>
        </div>
      </details>

      <details class="control-section" open>
        <summary><span><strong>Corner shape</strong><small>Click a corner to tune it</small></span><svg viewBox="0 0 24 24"><path d="m8 10 4 4 4-4" /></svg></summary>
        <div class="section-body">
          <div class="corner-editor">
            <div class="corner-canvas-wrap">
              <svg id="corner-preview" viewBox="0 0 240 150" role="img" aria-label="Interactive top view of aquarium corner rounding">
                <path id="corner-preview-path"></path>
                <g class="corner-hotspot" data-corner="backLeft"><circle r="12"></circle><text>BL</text></g>
                <g class="corner-hotspot" data-corner="backRight"><circle r="12"></circle><text>BR</text></g>
                <g class="corner-hotspot" data-corner="frontLeft"><circle r="12"></circle><text>FL</text></g>
                <g class="corner-hotspot" data-corner="frontRight"><circle r="12"></circle><text>FR</text></g>
                <text class="front-label" x="120" y="142">FRONT</text>
              </svg>
            </div>
            <div class="corner-preset-row" aria-label="Corner presets">
              <button type="button" data-corner-preset="panoramic" class="is-active">Panoramic</button>
              <button type="button" data-corner-preset="balanced">Balanced</button>
              <button type="button" data-corner-preset="square">Square</button>
            </div>
            <div class="toggle-row">
              <div><strong>Edit all corners</strong><span>Apply the selected value everywhere</span></div>
              <button class="switch" id="link-corners" type="button" role="switch" aria-checked="false"><span></span></button>
            </div>
            <div class="selected-corner-row">
              <div><span>Selected corner</span><strong id="selected-corner-name">Front left</strong></div>
              <output id="corner-output">0.58 m</output>
            </div>
            <input class="corner-range" id="corner-range" type="range" min="0.01" max="2" step="0.01" />
            <div class="corner-values" id="corner-values"></div>
          </div>
          ${rangeMarkup('curveSegments')}
        </div>
      </details>

      <details class="control-section" open>
        <summary><span><strong>Water</strong><small>Color, depth tint, and surface</small></span><svg viewBox="0 0 24 24"><path d="m8 10 4 4 4-4" /></svg></summary>
        <div class="section-body">
          ${colorMarkup('waterColor', 'Water color')}
          ${rangeMarkup('waterLevel')}
          ${rangeMarkup('waterTint')}
          ${rangeMarkup('waveStrength')}
          <p class="section-note">Side tint controls how quickly the blue builds up through the depth of the tank.</p>
        </div>
      </details>

      <details class="control-section" open>
        <summary><span><strong>Sand</strong><small>A warm procedural substrate</small></span><svg viewBox="0 0 24 24"><path d="m8 10 4 4 4-4" /></svg></summary>
        <div class="section-body">
          ${colorMarkup('sandColor', 'Sand color')}
          ${rangeMarkup('sandVariation')}
          ${rangeMarkup('sandGrain')}
          <button class="secondary-action" id="randomize-sand" type="button">
            <svg viewBox="0 0 24 24"><path d="M4 7h3l10 10h3M4 17h3l3-3m4-4 3-3h3m0 0-2-2m2 2-2 2m2 8-2-2m2 2-2 2" /></svg>
            Randomize sand pattern
          </button>
        </div>
      </details>

      <details class="control-section">
        <summary><span><strong>Structure</strong><small>Frame and acrylic details</small></span><svg viewBox="0 0 24 24"><path d="m8 10 4 4 4-4" /></svg></summary>
        <div class="section-body">
          ${rangeMarkup('baseHeight')}
          ${rangeMarkup('bottomRimHeight')}
          ${rangeMarkup('topRimHeight')}
          ${rangeMarkup('glassThickness')}
          ${rangeMarkup('rimRoundness')}
          <details class="advanced-details">
            <summary>Advanced fit</summary>
            <div>
              ${rangeMarkup('baseOverhang')}
              ${rangeMarkup('frameOverhang')}
              ${rangeMarkup('frameOverlap')}
            </div>
          </details>
        </div>
      </details>

      <details class="control-section">
        <summary><span><strong>Export</strong><small>GLB size and game units</small></span><svg viewBox="0 0 24 24"><path d="m8 10 4 4 4-4" /></svg></summary>
        <div class="section-body">
          ${rangeMarkup('exportScale')}
          <div class="export-summary">
            <svg viewBox="0 0 24 24"><path d="M5 19V5h14v14H5Zm0-8h14M12 5v14" /></svg>
            <div><strong id="export-dimensions">—</strong><span>Downloaded model dimensions</span></div>
          </div>
          <p class="section-note">The GLB is exported Y-up, so it imports upright in Blender and standard glTF tools.</p>
        </div>
      </details>
    `;
  }

  private bind(): void {
    for (const definition of RANGE_DEFINITIONS) {
      const range = this.root.querySelector<HTMLInputElement>(`[data-range-key="${definition.key}"]`);
      const number = this.root.querySelector<HTMLInputElement>(`[data-number-key="${definition.key}"]`);
      if (!range || !number) continue;

      const update = (raw: string) => {
        const value = Number.parseFloat(raw);
        if (!Number.isFinite(value)) return;
        const record = this.settings as unknown as Record<string, number>;
        record[definition.key] = value;
        normalizeSettings(this.settings);
        this.refresh();
        this.callbacks.onChange(this.settings, definition.structural ?? false);
      };
      range.addEventListener('input', () => update(range.value));
      number.addEventListener('change', () => update(number.value));
    }

    for (const key of ['waterColor', 'sandColor'] as const) {
      const picker = this.root.querySelector<HTMLInputElement>(`[data-color-key="${key}"]`)!;
      const text = this.root.querySelector<HTMLInputElement>(`[data-color-text-key="${key}"]`)!;
      picker.addEventListener('input', () => {
        this.settings[key] = picker.value;
        text.value = picker.value.toUpperCase();
        this.callbacks.onChange(this.settings, false);
      });
      text.addEventListener('change', () => {
        const value = text.value.trim();
        if (/^#[0-9a-f]{6}$/i.test(value)) {
          this.settings[key] = value;
          picker.value = value;
          this.callbacks.onChange(this.settings, false);
        }
        this.refresh();
      });
    }

    this.root.querySelectorAll<SVGGElement>('[data-corner]').forEach((element) => {
      element.addEventListener('click', () => {
        this.selectedCorner = element.dataset.corner as SelectedCorner;
        this.refreshCornerEditor();
      });
    });

    const cornerRange = this.root.querySelector<HTMLInputElement>('#corner-range')!;
    cornerRange.addEventListener('input', () => {
      const value = Number.parseFloat(cornerRange.value);
      if (this.linkCorners) {
        for (const key of Object.keys(this.settings.radii) as SelectedCorner[]) this.settings.radii[key] = value;
      } else {
        this.settings.radii[this.selectedCorner] = value;
      }
      normalizeSettings(this.settings);
      this.refreshCornerEditor();
      this.callbacks.onChange(this.settings, true);
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
        } else if (preset === 'balanced') {
          this.settings.radii = { frontLeft: unit * 0.085, frontRight: unit * 0.085, backRight: unit * 0.085, backLeft: unit * 0.085 };
        } else {
          this.settings.radii = { frontLeft: 0.02, frontRight: 0.02, backRight: 0.02, backLeft: 0.02 };
        }
        normalizeSettings(this.settings);
        this.root.querySelectorAll('[data-corner-preset]').forEach((item) => item.classList.remove('is-active'));
        button.classList.add('is-active');
        this.refreshCornerEditor();
        this.callbacks.onChange(this.settings, true);
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

  private formatValue(definition: RangeDefinition, value: number): string {
    if (definition.format) return definition.format(value);
    const decimals = definition.step < 0.01 ? 3 : definition.step < 0.1 ? 2 : 1;
    return `${value.toFixed(decimals)}${definition.unit ? ` ${definition.unit}` : ''}`;
  }

  private refresh(): void {
    for (const definition of RANGE_DEFINITIONS) {
      const value = Number((this.settings as unknown as Record<string, number>)[definition.key]);
      const range = this.root.querySelector<HTMLInputElement>(`[data-range-key="${definition.key}"]`);
      const number = this.root.querySelector<HTMLInputElement>(`[data-number-key="${definition.key}"]`);
      const output = this.root.querySelector<HTMLOutputElement>(`#${definition.key}-output`);
      if (range) range.value = String(value);
      if (number) number.value = String(Number(value.toFixed(3)));
      if (output) output.textContent = this.formatValue(definition, value);
    }

    for (const key of ['waterColor', 'sandColor'] as const) {
      this.root.querySelector<HTMLInputElement>(`[data-color-key="${key}"]`)!.value = this.settings[key];
      this.root.querySelector<HTMLInputElement>(`[data-color-text-key="${key}"]`)!.value = this.settings[key].toUpperCase();
    }

    this.refreshCornerEditor();
    const exportDimensions = this.root.querySelector<HTMLElement>('#export-dimensions')!;
    exportDimensions.textContent = `${(this.settings.width * this.settings.exportScale).toFixed(1)} × ${(this.settings.depth * this.settings.exportScale).toFixed(1)} × ${(this.settings.height * this.settings.exportScale).toFixed(1)} units`;
  }

  private refreshCornerEditor(): void {
    const maxRadius = Math.max(0.02, Math.min(this.settings.width, this.settings.depth) * 0.49);
    const range = this.root.querySelector<HTMLInputElement>('#corner-range')!;
    range.max = String(maxRadius);
    range.value = String(this.settings.radii[this.selectedCorner]);
    this.root.querySelector<HTMLOutputElement>('#corner-output')!.textContent = `${this.settings.radii[this.selectedCorner].toFixed(2)} m`;
    this.root.querySelector<HTMLElement>('#selected-corner-name')!.textContent = {
      frontLeft: 'Front left',
      frontRight: 'Front right',
      backRight: 'Back right',
      backLeft: 'Back left',
    }[this.selectedCorner];

    const preview = this.root.querySelector<SVGSVGElement>('#corner-preview')!;
    const path = this.root.querySelector<SVGPathElement>('#corner-preview-path')!;
    const availableWidth = 188;
    const availableHeight = 98;
    const ratio = this.settings.width / this.settings.depth;
    const width = ratio > availableWidth / availableHeight ? availableWidth : availableHeight * ratio;
    const height = ratio > availableWidth / availableHeight ? availableWidth / ratio : availableHeight;
    const left = (240 - width) * 0.5;
    const top = 18 + (availableHeight - height) * 0.5;
    const scale = width / this.settings.width;
    const radius = {
      frontLeft: Math.min(width * 0.48, this.settings.radii.frontLeft * scale),
      frontRight: Math.min(width * 0.48, this.settings.radii.frontRight * scale),
      backRight: Math.min(width * 0.48, this.settings.radii.backRight * scale),
      backLeft: Math.min(width * 0.48, this.settings.radii.backLeft * scale),
    };
    const right = left + width;
    const bottom = top + height;
    path.setAttribute('d', [
      `M ${left + radius.backLeft} ${top}`,
      `L ${right - radius.backRight} ${top}`,
      `Q ${right} ${top} ${right} ${top + radius.backRight}`,
      `L ${right} ${bottom - radius.frontRight}`,
      `Q ${right} ${bottom} ${right - radius.frontRight} ${bottom}`,
      `L ${left + radius.frontLeft} ${bottom}`,
      `Q ${left} ${bottom} ${left} ${bottom - radius.frontLeft}`,
      `L ${left} ${top + radius.backLeft}`,
      `Q ${left} ${top} ${left + radius.backLeft} ${top}`,
      'Z',
    ].join(' '));

    const positions: Record<SelectedCorner, [number, number]> = {
      backLeft: [left + 8, top + 8],
      backRight: [right - 8, top + 8],
      frontLeft: [left + 8, bottom - 8],
      frontRight: [right - 8, bottom - 8],
    };
    preview.querySelectorAll<SVGGElement>('[data-corner]').forEach((element) => {
      const corner = element.dataset.corner as SelectedCorner;
      const [x, y] = positions[corner];
      element.setAttribute('transform', `translate(${x} ${y})`);
      element.classList.toggle('is-selected', corner === this.selectedCorner);
    });

    const cornerValues = this.root.querySelector<HTMLElement>('#corner-values')!;
    cornerValues.innerHTML = (Object.keys(this.settings.radii) as SelectedCorner[]).map((corner) => {
      const labels: Record<SelectedCorner, string> = { frontLeft: 'FL', frontRight: 'FR', backRight: 'BR', backLeft: 'BL' };
      return `<button type="button" data-corner-value="${corner}" class="${corner === this.selectedCorner ? 'is-selected' : ''}"><span>${labels[corner]}</span><strong>${this.settings.radii[corner].toFixed(2)}</strong></button>`;
    }).join('');
    cornerValues.querySelectorAll<HTMLButtonElement>('[data-corner-value]').forEach((button) => {
      button.addEventListener('click', () => {
        this.selectedCorner = button.dataset.cornerValue as SelectedCorner;
        this.refreshCornerEditor();
      });
    });
  }
}
