# Aquarium Maker

Aquarium Maker is a polished, frontend-only public-aquarium generator. It builds the model, procedural textures, live Three.js preview, and downloadable GLB entirely in the browser—no server, login, upload, API key, or database required.

Version 1.4 expands the tunnel into a positionable, two-axis system with square or arched profiles, and adds finished ground presets for sand, dirt, algae, and gravel.

## Editor layout

The settings panel is split into focused tabs:

- **Tank** — width, depth, height, and ground presets with procedural fine tuning.
- **Corners** — visual top-down editor with independent radius and construction mode for every corner.
- **Water** — realistic-to-cartoon surface presets plus wave character, definition, size, tint, and color.
- **Tunnel** — optional positionable acrylic tunnel with direction, square/arched shape, frame, and clearance controls.
- **Details** — frame, glass, quality, and export settings.

The tunnel is disabled by default, so normal aquarium work stays uncluttered.

## Tunnel system

The tunnel can run on either tank axis:

- **Front ↔ Back** — entrance at the front and exit at the back.
- **Left ↔ Right** — entrance at the left and exit at the right.

A lateral-position control moves the passage across the tank while automatically respecting the available wall space. On the depth axis this means left/right placement; on the width axis it means front/back placement.

The tunnel is still exported in a clear order:

1. `TUNNEL_01_EntranceFrame`
2. `TUNNEL_AcrylicShell`
3. `TUNNEL_02_ExitFrame`

It has no generated floor. The base, lower rim, and ground substrate are cut away beneath the passage so a game-world floor can continue through it.

Tunnel controls include:

- direction axis
- lateral position
- passage width
- vertical wall height
- square, soft, or rounded roof profile
- continuously adjustable roof roundness
- acrylic thickness
- curve quality
- entrance and exit extension
- portal frame width and depth
- water-to-glass clearance

A roundness of zero produces a genuinely square tunnel with a flat ceiling. Rounded values generate the curved acrylic arch. The water remains one continuous volume with a matching dry void around either profile.

## Ground presets

The **Tank** tab includes four starting materials:

- **Sand** — warm, restrained fine grain.
- **Dirt** — darker clumps and natural mottling.
- **Algae** — organic green patches and subtle filaments.
- **Gravel** — coarse procedural pebble cells.

Each preset updates the base color, variation, and grain scale, while all three remain editable. The randomize button changes the procedural seed without adding external texture files.

## Water art direction

The **Water** tab offers three starting points:

- **Realistic** — fine, organic normal detail and restrained color variation.
- **Balanced** — readable game water while remaining physically plausible.
- **Cartoon** — broader waves, simplified highlights, and more graphic tonal bands.

The preset is only a starting point. Surface character, wave definition, wave size, strength, color, side tint, and seed remain independently adjustable.

## Corner construction

Each corner can independently use:

- **Rounded** — a segmented curved acrylic corner.
- **Flat pane** — a single diagonal pane across the corner.
- **Square** — a sharp rectangular corner.

The same footprint definition drives the glass, upper and lower rims, base, sand, water volume, water surface, and tunnel end walls. Changing a corner no longer leaves the interior or frame behind.

## Geometry and export

The standard default aquarium retains parity with the Python generator:

- 7 named meshes
- 1,014 vertices
- 1,008 triangles

The default rounded depth-axis tunnel validates as:

- 12 named meshes
- 2,829 vertices
- 1,656 triangles

The GLB is Y-up and imports upright in Blender. Export scale is baked into the vertices; the default is 10 output units per authored meter.

Standard mesh names:

- `STRUCTURE_BasePlinth`
- `STRUCTURE_BottomRim`
- `STRUCTURE_TopRim`
- `GLASS_AcrylicShell`
- `INTERIOR_SandFloor`
- `WATER_Volume`
- `WATER_Surface`

Tunnel builds replace the single glass shell with entrance, exit, side-shell, and tunnel meshes while retaining the named structure, sand, and water parts.

## Ready-to-use builds

This repository supports all common GitHub Pages setups:

1. **GitHub Actions** — the included workflow publishes `dist/`.
2. **Deploy from branch → `/ (root)`** — production files are committed at repository root.
3. **Deploy from branch → `/docs`** — a complete production copy is committed in `docs/`.

`standalone.html` contains the complete app in one file and can be opened directly from disk.

## Recommended deployment

1. Push the repository to `main`.
2. Open **Settings → Pages**.
3. Choose **GitHub Actions** under Build and deployment.
4. Push a commit or run the included workflow.

## Local development

Node.js 22 or newer is recommended.

```bash
npm install
npm run dev
```

Validate the procedural model variants:

```bash
npm run validate:model
```

Create every production target:

```bash
npm run build
```

Preview the Vite build:

```bash
npm run preview
```

## Project structure

```text
app/
  index.html
  public/
  src/
    main.ts
    style.css
    model/
      aquarium.ts
      settings.ts
      textures.ts
    ui/
      panel.ts
scripts/
  validate-model.ts
  sync-build.mjs
  make-standalone.mjs
dist/                 GitHub Actions build
docs/                 Branch-deploy build
index.html             Root-deploy build
standalone.html        Single-file build
```

Edit source files under `app/`, then run `npm run build`. Do not manually edit generated root, `docs/`, `dist/`, or standalone files.

## Troubleshooting

- **Controls appear but the model does not:** enable browser hardware acceleration and reload.
- **Opening locally:** open `standalone.html`; do not open `app/index.html` directly.
- **A deployed page shows broken source paths:** publish the repository root, `/docs`, or use the included GitHub Actions workflow—not the `app/` directory.
- **An older configuration behaves strangely:** press **Reset**. Version 1.4 uses a new settings-storage key so older tunnel settings do not conflict with axis and offset controls.
- **Transparent water differs between engines:** the GLB preserves named `WATER_Volume` and `WATER_Surface` meshes so an engine-native water shader can replace the portable material cleanly.

## Browser support

Current Chrome, Edge, Firefox, and Safari releases with WebGL 2 and Canvas 2D support.

## License

MIT
