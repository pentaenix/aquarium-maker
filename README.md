# Aquarium Maker v2.0

Aquarium Maker is a browser-only Three.js editor for public-aquarium layouts, passages, water, terrain, and GLB export.

## v2.0 passage and navigation architecture

Passages are defined once as an exact 2D portal profile plus an authoritative centreline. The same profile drives the acrylic shell, the portal wall opening, decorative frames, water subtraction, dry-volume navigation data, and fish collision checks. Frame width never expands the wall cutout.

Straight passages sweep that profile along one line. L passages use two straight plan-view legs meeting at one square 90-degree corner. The selected square, soft, or arched shape applies only to the vertical tunnel cross-section; L routes never introduce a curved horizontal elbow.

Navigation is exported as `swimVolumeLayers`: translucent-prism-ready 3D slabs whose polygons are the water footprint minus each dry passage at that height. Arched profiles narrow naturally near the roof, so water and swim space continue above a curved tunnel rather than being removed by a bounding rectangle. The viewport `Nav area` overlay extrudes these same layers in emerald green with edges; it is never added to the exported aquarium mesh.

Fish consume the exported-equivalent dry profiles and centreline data with body-radius clearance. The school template uses a uniform-grid boid pass (separation, alignment, cohesion, persistence, predictive boundary avoidance, and bounded turns) while retaining instanced rendering.

## v1.9 highlights

- Tunnel portal cuts now match the acrylic shell instead of removing an oversized rectangular area around the entrance.
- Straight tunnels, one-bend L tunnels, multiple simultaneous directions, and viewing alcoves remain available for rectangle, L, and U footprints.
- L tunnels expose entrance and exit positions for their two straight legs. Their corner is always square; roof roundness only changes the vertical cross-section.
- Cardinal aquarium faces can be toggled between glass and opaque structural wall panels, with a configurable solid-wall color.
- The viewport includes a green navigation-area overlay generated from the same navigation metadata exported in the GLB.
- Seven lightweight viewport-only animal simulation templates are included: small school, reef fish, large creature, ray, dolphin, sea otter, and bottom dwellers.
- Water surfaces animate cheaply through scrolling color/normal textures plus very small vertical motion. Calm, realistic, balanced, cartoon, and pixel presets all use the same inexpensive system.
- Terrain now separates mound height from mound radius. A large radius creates a broad hill; mound height controls the visible elevation. Fine irregularity and wall falloff are independent controls.
- Manual positive numeric values may exceed slider ranges wherever the resulting model remains geometrically valid.

## Navigation data

The exported GLB contains `NAV_Aquarium`, `NAV_Region_*`, and `NAV_Portal_*` nodes plus glTF extras describing water bounds, polygons, height ranges, connected regions, portals, spawn suggestions, and dry-passage paths. The viewport overlay and preview agents use this same data.

## Development

```bash
npm install
npm run build
npm run validate:model
```

For day-to-day local development, use the one-command launcher instead:

```bash
./run
```

It verifies Node/npm and the locked local dependencies, runs `npm ci` from the
public npm registry only when they are missing or invalid, then starts Vite. Leave that terminal running:
Vite hot-reloads changes to the app without killing or relaunching `./run`.
Additional Vite options can be passed through, for example
`./run --host 0.0.0.0`.

The production build is synchronized to the repository root, `dist/`, and `docs/`. These generated bundles (including `standalone.html`) are ignored by Git and should be recreated with `npm run build` rather than committed.

## Notes

Viewport fish and green navigation overlays are preview diagnostics and are not included as visible meshes in the exported aquarium. Water animation parameters are stored in project settings and metadata; custom engine shaders should reproduce the animation when importing the GLB.
