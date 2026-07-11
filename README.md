# Aquarium Maker

Aquarium Maker is a frontend-only GLB generator for game-ready public aquarium models. It runs locally in the browser, previews the model in real time, and exports a `.glb` without uploading anything.

## v1.5 highlights

This version reorganizes the app around composable aquarium decisions instead of one giant list of tank types.

### Shape

Choose the top-down footprint:

- Rectangle
- L shape
- U shape

Rectangle keeps the polished rounded-corner system with per-corner modes: rounded, flat pane, or square. L and U footprints use clean concave layouts and are prepared for deeper future corner editing.

### Profile

Choose how the aquarium exists vertically:

- Standard aquarium
- Below-floor aquarium
- Touch pool

The below-floor profile matches the POC direction: the tank extends into negative Z, exports no floor polygon, has a normal floor-level rim, and uses an opaque structural body below the game floor. The touch-pool profile is shallow and disables tunnel controls by design.

### Tunnel

The Tunnel tab is now compatibility-aware. Tunnels are available for rectangle standard and below-floor tanks. Below-floor tunnel tanks add named glass-floor and side-rim meshes:

- `TUNNEL_GlassFloor`
- `TUNNEL_LeftSideRim`
- `TUNNEL_RightSideRim`

Touch pools and L/U footprints intentionally disable tunnels for now so the exported geometry stays valid and predictable.

### Water and ground

Water and ground are separated into their own tabs. Ground presets include sand, dirt, algae, and gravel. Water presets include realistic, balanced, and cartoon surface styles.

## Deploying to GitHub Pages

Use the complete repository ZIP, push it to your repository, then enable GitHub Pages. The project includes:

- `dist/` for Vite output
- `docs/` for GitHub Pages fallback deployments
- root `index.html` / `404.html` for direct static hosting
- `.github/workflows/deploy.yml` for GitHub Actions publishing

## Development

```bash
npm install
npm run build
npm run validate:model
```

## Export conventions

- Authoring units are meters.
- Default export scale is 10 game units per meter.
- No server, API key, account, or database is required.
- The downloaded GLB contains named meshes so materials can be replaced in-engine.

