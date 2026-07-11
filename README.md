# Aquarium Maker 1.7

Aquarium Maker is a browser-only public-aquarium model generator. It previews the model live and exports a game-ready binary GLB without uploading anything or requiring a server.

## What is new in 1.7

### Below-floor tunnel bridges

Below-floor tunnels can now behave as acrylic bridges rather than cutting a dry trench through the entire aquarium.

When **Profile → Below floor** and **Tunnel → Acrylic bridge floor** are enabled:

- the opaque underground tank body continues beneath the tunnel;
- substrate and water continue under the glass walking floor;
- the bridge receives independent side-rim width and height controls;
- narrow floor separators divide the acrylic into readable panels;
- separator spacing and thickness are adjustable;
- the bridge pieces are exported with clear names such as `TUNNEL_GlassFloor`, `TUNNEL_LeftSideRim`, and `TUNNEL_FloorSeparator_01`.

Turning the acrylic floor off restores the open-bottom tunnel behavior.

### Manual values beyond slider ranges

Sliders remain intentionally compact and useful for everyday editing. Their adjacent number fields are no longer limited to the slider maximum. Larger positive typed values are accepted whenever the resulting geometry is physically valid.

Semantic and physical constraints still apply. For example, a tunnel cannot be wider than the arm it crosses, and a corner radius cannot exceed the surrounding wall lengths.

### Expanded water presets

The Water tab now contains restored visual preset cards with clear surface illustrations:

- Calm
- Realistic
- Balanced
- Cartoon
- Pixel

Pixel water uses quantized procedural bands, block-like normals, and nearest texture filtering. Every preset can still be refined with color, side tint, surface character, wave definition, and wave size.

### Cleaner export controls

The Export tab was removed. **Units per meter** now lives beside the download controls in the permanent footer, along with the current exported bounds. This keeps the editor to five focused tabs:

`Shape · Profile · Tunnel · Water · Ground`

### More direct L and U controls

L-shaped tanks expose both their solid arm dimensions and the width/depth of the missing section.

U-shaped tanks expose:

- left arm width;
- right arm width;
- rear bridge depth;
- opening width;
- opening depth;
- opening lateral position.

The arm and opening fields are synchronized, so either representation can be edited.

## Supported combinations

| Footprint | Standard | Below floor | Touch pool | Tunnel |
| --- | --- | --- | --- | --- |
| Rectangle | Yes | Yes | Yes | Standard and below floor |
| L shape | Yes | Yes | Yes | Standard and below floor |
| U shape | Yes | Yes | Yes | Standard and below floor |

Touch pools intentionally do not support tunnels.

## Development

```bash
npm install
npm run dev
```

Production build and synchronized GitHub Pages files:

```bash
npm run build
```

Geometry validation:

```bash
npm run validate:model
```

## GitHub Pages

The repository supports:

- GitHub Actions deployment;
- deployment from the repository root;
- deployment from `/docs`;
- opening the generated `standalone.html` directly.

For the recommended setup, choose **GitHub Actions** under **Settings → Pages** and push to `main`.

## Export conventions

- Preview units: authored meters
- Default export scale: 10 units per meter
- glTF up axis: Y-up
- Format: binary GLB
- Open aquarium top
- Named structural, glass, water, ground, and tunnel meshes

## Privacy

All geometry, procedural textures, preview rendering, and GLB export happen locally in the browser.
