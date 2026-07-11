# Aquarium Maker 1.8

Aquarium Maker is a browser-only editor for designing public-aquarium architecture and exporting game-ready binary GLB models. Geometry, procedural textures, navigation metadata, previews, and exports are generated locally in the browser.

## What is new in 1.8

### Editable arm-based layouts

L and U footprints are now assembled from independently editable architectural pieces instead of a single fixed cutout.

For an L tank, select either arm directly in the top-view editor and edit its own width and length. For a U tank, select the left arm, right arm, or rear connector and edit each independently. This supports unequal arm widths, unequal arm lengths, shallow or deep connectors, long asymmetrical layouts, mirroring, and 90-degree rotation.

The corner designer still controls every outer and inner corner separately after the arm dimensions change.

### Multiple passages

A tank can contain up to twelve independently configured passages. The Passages tab contains a compact list instead of exposing every passage control simultaneously.

Available passage types:

- straight through tunnel;
- one-bend L tunnel;
- one-ended viewing alcove or aquarium overhang.

Each passage has its own name, entrance wall, exit wall, wall offsets, width, height, roof shape, frame dimensions, glass thickness, and water clearance. Passages may run in both directions at once, and U layouts can place separate tunnels in either arm and through the rear connector.

New passages are placed in a sensible solid arm by default for rectangle, L, and U layouts. Invalid routes preserve the last valid model and explain what must be moved or narrowed.

Touch pools remain intentionally passage-free.

### Viewing alcoves

A viewing alcove uses the tunnel construction system but has only one entrance and a closed acrylic end. It creates the half-tunnel or overhang arrangement where visitors step beneath water without walking through the entire tank.

Its depth, width, roof profile, entrance position, glass, and frame remain independently adjustable.

### Below-floor passage bridges

Below-floor passages retain the continuous underground aquarium volume beneath them. Each can independently use:

- an acrylic walking floor;
- raised side rims;
- repeated floor separators;
- adjustable separator spacing and thickness.

Water and substrate continue below the bridge. Open-bottom passages remain available by disabling the acrylic floor for that passage.

### Continuous entrance glass

The glass above tunnel and alcove entrances is now generated as part of `GLASS_AcrylicShell` and uses the exact same physical material as the rest of the aquarium. Passage shells and bridge floors also share that material, removing the previous visual mismatch around portal openings.

### Fish AI navigation data

Every GLB contains navigation data in glTF `extras`, even when the companion JSON export is disabled.

The embedded `aquarium-maker-navigation` schema includes:

- authored meter units and coordinate conventions;
- exact water bounds and height range;
- water-boundary polygon;
- water-surface area and approximate volume;
- recommended maximum fish radius;
- rectangle, L-arm, U-arm, and connector regions;
- portals linking regions;
- suggested spawn positions;
- all dry tunnel and alcove centerlines, widths, floor levels, and crown heights.

The GLB also contains named metadata nodes:

- `NAV_Aquarium`
- `NAV_Region_*`
- `NAV_Portal_*`

When **Companion navigation JSON** is enabled in Layout, downloading the model also downloads `<name>.navigation.json`. The JSON adds export scale and exported-unit dimensions for engines that do not expose glTF extras conveniently.

A simple fish controller can keep a fish inside at least one region polygon and the water height range, avoid the listed dry passage volumes, and use the region portals for high-level movement around L and U layouts.

## Editor organization

The interface remains five focused sections:

`Layout · Height · Passages · Water · Ground`

- **Layout** selects the footprint, edits arms/connectors, rotates or mirrors the plan, controls corners, and enables companion navigation JSON.
- **Height** selects Standard, Below floor, or Touch pool and shows only the controls relevant to that profile.
- **Passages** manages the passage list and the selected tunnel or alcove.
- **Water** provides Calm, Realistic, Balanced, Cartoon, and Pixel surface presets.
- **Ground** controls substrate texture and real mesh irregularity, mounds, scale, detail, and seed.

Export scale, filename, dimensions, and download remain in the permanent footer.

## Supported combinations

| Footprint | Standard | Below floor | Touch pool | Multiple passages |
| --- | --- | --- | --- | --- |
| Rectangle | Yes | Yes | Yes | Standard and below floor |
| L shape | Yes | Yes | Yes | Straight, L, alcove |
| U shape | Yes | Yes | Yes | Straight, L, alcove |

## Important geometry behavior

- Sliders are comfortable editing ranges, not hard limits. Positive values beyond a slider maximum can be typed manually.
- A passage must stay within a continuous solid part of the footprint with enough clearance for its width and glass.
- Separate passages may run in both axes. Crossing passage shells are allowed geometrically but are not automatically converted into a joined visitor intersection.
- Touch pools use opaque basin construction, default to 0.5 meters high, and do not generate acrylic side walls.
- Below-floor tanks export no room-floor polygon. The game floor is expected to cover Y = 0 around the normal floor rim.

## Development

```bash
npm install
npm run dev
```

Production build, synchronized root/docs deployment files, and standalone HTML:

```bash
npm run build
```

Geometry and navigation validation:

```bash
npm run validate:model
```

The validation suite covers standard, touch-pool, below-floor, L, U, irregular terrain, independent corners, multiple tunnels, tunnels in both directions, one-bend tunnels, viewing alcoves, and below-floor multi-bridge layouts.

## GitHub Pages

The repository supports:

- GitHub Actions deployment;
- deployment from the repository root;
- deployment from `/docs`;
- opening `standalone.html` directly.

For the recommended setup, choose **GitHub Actions** under **Settings → Pages** and push to `main`.

## Export conventions

- Preview units: authored meters
- Default export scale: 10 units per meter
- glTF up axis: Y-up
- Front axis: +Z
- Floor level: Y = 0
- Format: binary GLB
- Open aquarium top
- Named structure, glass, water, ground, passage, bridge, and navigation objects

## Privacy

Nothing is uploaded. The application does not require an API, account, or backend.
