# Aquarium Maker

A finished, frontend-only public-aquarium generator whose browser geometry mirrors the original Python asset generator. Users can tune the model in real time, inspect it in a physically lit Three.js preview, and download the current result as a game-ready binary GLB.

No server, account, API key, or uploaded data is required. Geometry, procedural textures, and GLB export all run in the browser.

## What is included

- Live low-poly aquarium preview with orbit, zoom, and camera presets
- Independent front-left, front-right, back-left, and back-right corner rounding
- Visual corner editor with approachable presets
- Configurable size, structure, acrylic thickness, water level, side tint, waves, and sand
- Non-repeating procedural water and sand textures
- Separate water-volume and water-surface meshes, with the volume cap safely buried inside the sand
- Physically based acrylic and water materials tuned to match the Python generator
- Python-parity geometry: 1,008 triangles and 1,014 vertices at the default curve quality
- One shared corner profile drives the acrylic, rims, sand, and water footprints
- Named meshes for easy engine-side material replacement
- Default export scale of 10 output units per authored meter
- Shareable configurations and optional local persistence
- Responsive desktop and mobile interface
- Direct browser-generated GLB downloads

## The three ready-to-use builds

This repository deliberately supports all common GitHub Pages setups:

1. **GitHub Actions** — the included workflow publishes `dist/`.
2. **Deploy from branch → `/ (root)`** — the production `index.html` and `assets/` are committed at repository root.
3. **Deploy from branch → `/docs`** — a complete production copy is committed in `docs/`.

There is also a fully self-contained `standalone.html`. It has the CSS and JavaScript embedded inside one file and can be opened directly from disk without running a server.

## Recommended GitHub Pages setup

1. Push the repository to the `main` branch.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, select **GitHub Actions**.
4. Run the workflow or push a commit.

The site also works if Pages is set to deploy from `main` and either `/ (root)` or `/docs`.

## Local development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Create all production builds:

```bash
npm run build
```

Preview the normal production build:

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
  sync-build.mjs
  make-standalone.mjs
dist/                 Generated GitHub Actions build
docs/                 Generated branch-deploy build
index.html             Generated root-deploy build
standalone.html        Generated single-file build
```

Do not edit the generated root, `docs/`, `dist/`, or standalone files manually. Edit files under `app/`, then run `npm run build`.

## Export structure

The downloaded GLB uses these mesh names:

- `STRUCTURE_BasePlinth`
- `STRUCTURE_BottomRim`
- `STRUCTURE_TopRim`
- `GLASS_AcrylicShell`
- `INTERIOR_SandFloor`
- `WATER_Volume`
- `WATER_Surface`

The model is authored Y-up, as required by glTF, and imports upright in Blender. The selected scale is baked into exported vertex positions. The default is 10 output units per authored meter.

## Troubleshooting

- **The page has controls but no 3D model:** enable browser hardware acceleration and reload. The app now shows a clear WebGL message instead of silently failing.
- **Opening files directly:** use `standalone.html`, not the source file under `app/`.
- **GitHub Pages shows raw or broken source:** deploy the repository root, `/docs`, or use the included GitHub Actions workflow. Do not publish `app/` directly.
- **Old settings behave strangely after updating:** press **Reset**. Settings are versioned, but a reset is the quickest way to discard a stale configuration.

## Browser support

Current Chrome, Edge, Firefox, and Safari versions with WebGL 2 and Canvas 2D support.

## License

MIT
