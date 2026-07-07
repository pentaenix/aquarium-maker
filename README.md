# Aquarium Studio

A polished, frontend-only public-aquarium generator. Users can tune the model in real time, inspect it in a physically lit Three.js preview, and download the current result as a game-ready binary GLB.

No server, account, API key, or uploaded data is required. Geometry, procedural textures, and GLB export all run in the browser.

## Highlights

- Live low-poly aquarium preview with orbit, zoom, and camera presets
- Independent front-left, front-right, back-left, and back-right corner rounding
- Visual corner editor with approachable presets
- Configurable size, structure, acrylic thickness, water level, water tint, waves, and sand
- Non-repeating procedural water and sand textures
- Physically based acrylic and water materials
- Clean named meshes for engine-side material replacement
- Configurable output units; default is 10 output units per authored meter
- URL sharing, local setting persistence, and client-side GLB downloads
- Responsive desktop and mobile UI
- One-click GitHub Pages deployment workflow

## Local development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## Deploy to GitHub Pages

1. Create a GitHub repository and copy this project into it.
2. Push it to the `main` branch.
3. Open **Settings → Pages** in the repository.
4. Under **Build and deployment**, select **GitHub Actions** as the source.
5. The included `.github/workflows/deploy.yml` workflow builds and deploys the app.

`vite.config.ts` uses relative asset paths, so the build works both at a root domain and under a repository subpath.

## Export structure

The downloaded GLB uses clear mesh and material names:

- `STRUCTURE_BasePlinth`
- `STRUCTURE_BottomRim`
- `STRUCTURE_TopRim`
- `GLASS_AcrylicShell`
- `INTERIOR_SandFloor`
- `WATER_VolumeAndSurface`

The water mesh has separate surface and side materials. Engines with a dedicated water shader can replace either material without editing the geometry.

The app authors the model in meters and bakes the selected unit scale into exported vertex positions. The default produces 10 output units per meter. Geometry is Y-up in accordance with glTF, so Blender and standard glTF tools import it upright.

## Project structure

```text
src/
  main.ts                 Renderer, camera, persistence, sharing, export
  style.css               Finished responsive interface
  model/
    aquarium.ts           Procedural geometry, materials, and GLB export
    settings.ts           Defaults, types, and validation
    textures.ts           Browser-generated sand and water textures
  ui/
    panel.ts              Controls and visual corner editor
```

## Browser support

The app targets modern desktop and mobile browsers with WebGL 2, ES2022 modules, Canvas 2D, and Blob downloads. Chrome, Edge, Firefox, and Safari are supported on current versions.

## License

MIT
