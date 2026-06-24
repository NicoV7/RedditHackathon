# Parlor — Phaser asset pipeline (PLAN Part 4.4, job J-ASSETS)

Build-time art + audio for the "Best Use of Phaser" pillars. **One typed manifest +
one safe loader** live in [`../phaser/assets.ts`](../phaser/assets.ts); world.ts,
board.ts, and portrait.ts import that — never these files directly.

## How it works (and why the game runs with zero real art)

- Vite (root = `src/client`) turns every `import x from "./tilesets/foo.png"` into a
  served **URL string at build time** — no runtime fetch cost, inside the **4 MB
  payload budget (R4)**.
- The manifest gives every slot a **stable key** and an optional `src`. A slot whose
  `src` is `undefined` is a **documented, not-yet-authored** entry.
- `loadAssets(scene)` / `loadZoneAssets(scene, zoneId)` queue **only** entries that
  have a `src`, and are a **safe no-op** for everything else. So the world boots today
  on the low-FX **Graphics fallback** (world.ts draws rectangles, board.ts draws the
  corkboard with Graphics) and **silently upgrades** the moment a real file lands at
  the documented path — **no code change required**.
- **Cosmetic-only invariant (CLAUDE.md / PLAN 4.2):** no asset key, source, or load
  result is ever read by game logic. Missing art changes only how the scene *looks*.

## To add real art — drop the file, then (only if a new slot) add one import

1. **Existing slot (most art):** replace/author the file at the path the manifest's
   `note` names (e.g. `tilesets/parlor.png`) and add the matching `import` +
   `src:` in `../phaser/assets.ts`. Tiles already have placeholder bytes; just
   overwrite or re-point.
2. **Audio + sprite sheets** ship no placeholder bytes (payload thrift) — author the
   file and wire its `import`/`src` in the manifest.

## Directory layout

```
src/client/assets/
├── README.md            ← this file
├── assets.d.ts          ← *.mp3 / *.ogg / *.m4a / *.webp module decls (*.png is in ../images.d.ts)
├── placeholder.png      ← 1×1 transparent universal stand-in (68 B)
├── portraits/           ← existing PixelLab cast portraits (240×320, owned by ui/portraits.ts)
├── tilesets/
│   ├── placeholder-tile.png   ← 16×16 teal-charcoal floor (90 B) — wired as every zone's tileset
│   ├── parlor.png  kitchen.png  garden.png  study.png  cellar.png  default.png   ← TODO real 16px, 256×256
│   └── corkboard.png          ← TODO board cork/baize, tileable 512×512
├── sprites/
│   ├── avatar.png             ← TODO 4 dirs × idle+walk(4) = 20 frames, 32×48
│   └── npc.png                ← TODO generic NPC sheet, same layout/dims
├── normals/
│   ├── placeholder-light.png  ← 16×16 radial light cookie (234 B) — wired as lightCookie
│   ├── light-cookie.png       ← TODO 128×128 radial glow (Perception radius + gaslight)
│   └── <zone>-normal.png      ← TODO optional per-zone normal maps (self-shadows, Pillar 2)
└── audio/
    ├── ambience-<zone>.mp3     ← TODO per-zone loops (parlor/kitchen/garden/study/cellar/default)
    ├── music-noir.mp3          ← TODO noir-jazz bed (largest single asset, ≤400 KB)
    └── sfx-*.mp3               ← TODO footstep / lie-sting / string-snap / gotcha / accuse / door
```

Zone ids (`parlor`, `kitchen`, `garden`, `study`, `cellar`) mirror
`src/server/case/procedural.ts` `ZONE_DEFS` exactly; any unmapped zone falls back to
the `default` bundle, so the loader is total.

## Locked palette — Cold Lovecraftian-Noir, grounded 1920s (PLAN 1.6 / 4.3)

All real PixelLab / CC0 art must sit inside this palette so world, portraits, and
board read as one piece:

| Hex        | Role |
|------------|------|
| `#121C1F`  | deep backdrop behind rooms |
| `#1B2A2E`  | teal-charcoal room floor |
| `#2C444A`  | cold room stroke / outline |
| `#E8B86D`  | amber lamplight / NPC key-light |
| `#7EA8B0`  | cool slate — interactable items |
| `#D4322A`  | crimson — the lie-tell **only** (always paired with a non-color edge-pulse for colorblind safety) |

Gaslight = warm-amber **point lights** over a **cold ambient** key-light; crimson is
reserved for the lie-tell. These mirror the constants already in `phaser/world.ts`.

## Sourcing real art

- **Tilesets / avatar / NPC sheets:** PixelLab (top-down tileset + character tools)
  or CC0 packs, recolored into the palette above. Keep tiles at **16px** to match
  `navGrid.cellSize`.
- **Audio:** CC0 jazz + foley (e.g. freesound CC0). Encode mono `.mp3` for loops;
  keep each clip within the size budget noted in the manifest. Provide an `.ogg`
  alongside only if a target browser needs it (the `assets.d.ts` decl is ready).
- **Compliance:** original or CC0 only — no Reddit IP, no Snoo/karma theming
  (CLAUDE.md). Document the source/license of any added file in this README.
