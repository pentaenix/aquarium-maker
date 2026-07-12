# Aquarium Maker v1.9

Aquarium Maker is a browser-only Three.js editor for public-aquarium layouts, passages, water, terrain, and GLB export.

## v1.9 highlights

- Tunnel portal cuts now match the acrylic shell instead of removing an oversized rectangular area around the entrance.
- Straight tunnels, one-bend L tunnels, multiple simultaneous directions, and viewing alcoves remain available for rectangle, L, and U footprints.
- L tunnels expose a separate corner-radius control in addition to roof roundness.
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

The production build is synchronized to the repository root, `dist/`, and `docs/`. `standalone.html` is generated during the build.

## Notes

Viewport fish and green navigation overlays are preview diagnostics and are not included as visible meshes in the exported aquarium. Water animation parameters are stored in project settings and metadata; custom engine shaders should reproduce the animation when importing the GLB.
