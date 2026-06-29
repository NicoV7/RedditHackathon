# Phaser 4 cheat-sheet (for the "Best Use of Phaser" showcase, Part 4)

The repo uses **Phaser `^4.2.0`**. Phaser 4 renamed/rebuilt a lot vs Phaser 3 — code written from
Phaser-3 muscle memory WILL break. **Rule #1: read the installed type defs in
`node_modules/phaser/types/` (or `node_modules/phaser/dist/phaser.d.ts`) for exact signatures before
using any API, and feature-detect + degrade gracefully so the build stays green** (the plan's low-FX
fallback, Part 4.4). Sources: [Phaser 3 vs 4](https://phaser.io/news/2026/05/phaser-3-vs-phaser-4),
[Filter system](https://phaser.io/news/2026/05/phaser-4-filter-system),
[Dynamic lighting](https://phaser.io/news/2026/05/phaser-4-dynamic-lighting),
[Migration guide](https://phaser.io/news/2026/04/migrating-from-phaser-3-to-phaser-4-what-you-need-to-know).

## Lighting (Pillar 2 — Lighting-as-Perception)
- Opt an object in with **`obj.setLighting(true)`** (NOT Phaser 3's `setPipeline('Light2D')`). Works on
  virtually everything: sprites, images, **text, tilemaps, particles, shapes**.
- Lights have an explicit **`light.z`** (height above the scene). Self-shadows are per-object or global.
- Scene light manager: confirm exact `scene.lights.enable()` / `addLight(...)` signature against the
  installed types (v3-like, but verify). Normal maps via the **NormalTools** filter.
- Use: cold ambient + per-zone gaslight point lights + a **player-follow light** whose radius scales with
  the Perception faculty. Cosmetic guidance only — examinability stays server-authoritative.

## Filters / FX (Pillar 1 — lie-tell; Pillar 4 — board glow)
- FX + masks unified into **filters** applicable to any GameObject **or camera**, stackable in any order.
- Built-ins include: **Blend, GradientMap, ImageLight, Quantize, Blocky, Vignette, Wipe, Threshold,
  NormalTools, CombineColorMatrix, Mask**. Verify the exact attach API (filter list property/method) in
  the installed types.
- Some Phaser 3 FX are now **Actions**, e.g. **`Actions.AddEffectBloom()`** (Bloom/Shine/Circle).
  Gradient is now a dedicated **Gradient game object**. BitmapMask → **Mask filter**.
- Lie-tell stack: **Glow/Bloom (Action) + Quantize/GradientMap (cold posterize) + a crimson tint pulse +
  a non-color edge-pulse**. Fire deterministically from the server `tell` (TellSignal); never RNG.

## Migration gotchas (will silently break v3 code)
- Custom WebGL pipelines → **render nodes** (avoid custom pipelines; prefer built-in filters/Actions).
- **`setTintFill()` removed** → use `setTint()` + `setTintMode()`.
- **`Geom.Point` → `Vector2`**; `Phaser.Struct.Set/Map` → native `Set`/`Map`.
- **`Math.TAU`** corrected to `PI*2`; new `Math.PI_OVER_2`.
- **Mesh, Plane, Camera3D, Layer3D, bundled Spine** removed.
- **`roundPixels` defaults to `false`** now (set explicitly if pixel-snapping is wanted for crisp pixel art).
- Tilemaps: prefer **`TilemapGPULayer`** (single-quad GPU render) for the zone tilesets; verify the
  loader/creator API against installed types.

## Non-negotiable guard (Part 4.2)
Every filter/light/particle is **cosmetic** — it renders a deterministic, server-authoritative signal and
is **never read back by game logic**. Logical state stays integer/tick-based (mulberry32). Provide a
`setQuality('low')` path that disables filters/lights/particles for weak devices.
