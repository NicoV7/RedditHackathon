/**
 * src/client/phaser/interact.ts — PURE proximity selector for the side-scroll overworld.
 *
 * Given the avatar's float position and the room's interactable candidates (NPCs, doors,
 * items at their ground spawn points), return the nearest one within `range`, or null.
 * Drives the "Talk / Enter / Examine" prompt and the interact key/button. No Phaser, no
 * DOM, no clocks, no Math.random — a deterministic f(args), unit-testable in Node.
 *
 * DETERMINISM BOUNDARY (CLAUDE.md hard rule): proximity is a UI AFFORDANCE, not game
 * logic. The avatar's float (x,y) feeding this is COSMETIC; the returned hit only decides
 * which prompt to show / which handler the player MAY trigger — it never changes logical
 * state by itself (a door still changes the zone only when the player acts on it). Ties
 * break by input order (candidates come from roomLayout.placements, a stable order), so
 * the selection is reproducible.
 */
export type InteractKind = "npc" | "door" | "item";

/** One interactable's selection point in world pixels (its ground spawn). */
export interface InteractCandidate {
  id: string;
  kind: InteractKind;
  x: number;
  y: number;
  toZone?: string; // doors only — the room this door leads to
}

/** The nearest in-range interactable, with its distance for prompt/debug use. */
export interface InteractHit {
  id: string;
  kind: InteractKind;
  dist: number;
  toZone?: string;
}

/**
 * The nearest candidate within `range` of (avatarX, avatarY), or null when none qualify.
 * Distance is Euclidean; the boundary is inclusive (`dist === range` counts). Ties resolve
 * to the lowest input index (deterministic). Pure.
 */
export function nearestInteractable(
  avatarX: number,
  avatarY: number,
  candidates: readonly InteractCandidate[],
  range: number,
): InteractHit | null {
  let best: InteractHit | null = null;
  for (const c of candidates) {
    const dist = Math.hypot(c.x - avatarX, c.y - avatarY);
    if (dist > range) continue;
    if (best === null || dist < best.dist) {
      best = c.toZone !== undefined
        ? { id: c.id, kind: c.kind, dist, toZone: c.toZone }
        : { id: c.id, kind: c.kind, dist };
    }
  }
  return best;
}
