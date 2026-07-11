# Aquarium Maker

Aquarium Maker is a finished frontend-only editor for designing public-aquarium models, previewing them in real time, and downloading game-ready GLB files. Everything runs in the browser: no account, server, upload, API key, or database is required.

## v1.6 — composable tanks and terrain

This release is a structural repair and expansion of the aquarium generator.

### A cleaner editor

The controls are divided by the decision the user is making:

- **Shape** — footprint, size, vertical dimensions, arm dimensions, and corner treatment
- **Profile** — standard aquarium, below-floor aquarium, or touch pool
- **Tunnel** — direction, offset, arch/square profile, frames, glass, and below-floor tunnel floor
- **Water** — realistic through cartoon presets, tint, waves, and surface definition
- **Ground** — material preset, color/noise, and real floor deformation
- **Export** — file name and game-unit scale

Controls that do not apply to the current profile are hidden. For example, a below-floor tank shows **Above floor** and **Below floor** in Shape instead of the unused standard height slider.

### True touch pools

Touch pools no longer behave like short glass aquariums.

- Default total height: **0.5 m**
- Opaque basin walls and floor
- Broad touch rim
- Shallow configurable water depth
- Optional pedestal
- No acrylic wall mesh
- Rectangle, L, and U footprints supported
- Tunnels intentionally unavailable for touch pools

### Rebuilt L and U shapes

L- and U-shaped tanks now use shared polygon regions for the base, rims, acrylic, water, and substrate. This removes overlapping rim meshes and the associated z-fighting and normal glitches.

Every visible corner can be edited independently, including concave inner elbows. Each corner supports:

- Rounded
- Flat diagonal pane
- Square
- Independent radius

### Tunnels in rectangle, L, and U tanks

Straight tunnels can now be placed through all three footprints.

- Front-to-back or left-to-right direction
- Lateral offset control
- Square, soft, or arched roof
- Automatic selection of a continuous valid arm through concave footprints
- Standard and below-floor profiles
- Below-floor tunnels can include a named glass floor and side rims

Some offset/width combinations cannot physically cross a continuous part of an L or U shape. When that happens, the app keeps the last valid model, restores the prior controls, and explains the invalid placement instead of exporting mismatched geometry.

### Below-floor profile

- Tank body extends into negative Y in the browser’s Y-up model space
- No floor polygon is exported
- Normal floor-level rim
- Opaque structural body below the game floor
- Transparent viewing section above the floor
- Separate above-floor and below-floor heights
- Compatible with rectangle, L, U, and tunnels

### Deformed substrate

Ground is no longer limited to a flat textured plane.

The Ground tab includes:

- Floor irregularity
- Mound size
- Mound count
- Terrain detail
- Regeneratable terrain seed

The terrain is a shared indexed mesh with edge fading and smooth normals. Large tanks automatically receive enough subdivision to avoid the oversized isolated triangles seen in earlier builds. Sand, dirt, algae, and gravel presets remain available.

## Development

```bash
npm install
npm run check
npm run validate:model
npm run build
```

`npm run validate:model` exercises standard, touch-pool, below-floor, rectangle/L/U, mixed-corner, large-terrain, and tunnel combinations. It fails on invalid vertices, indices, normals, or degenerate triangles.

## GitHub Pages deployment

The complete repository includes several deployment options:

- `.github/workflows/deploy.yml` — recommended GitHub Actions deployment
- `docs/` — GitHub Pages branch-folder deployment
- root `index.html` and `assets/` — direct static hosting
- `standalone.html` — one-file local/offline version

Recommended setup:

1. Replace the repository contents with this package.
2. Push to `main`.
3. Open **Settings → Pages**.
4. Select **GitHub Actions** as the source.

## Export conventions

- Editor dimensions are authored in meters.
- Default export scale is 10 game units per meter.
- GLB uses Y-up coordinates and imports upright in Blender.
- Components have descriptive names for engine-side material replacement.
- Water volume and water surface remain separate meshes.
