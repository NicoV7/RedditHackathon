/**
 * Reachability engine (C3) — the ONE traversal shared by the validator AND the
 * blind solver. Computes the player-reachable surface over the union graph of
 * {clues, items, zones, present-targets}. Eng-review H-2/C-2: validator and
 * solver MUST agree on "reachable", so both call this.
 */
import type {
  CaseInstance,
  ClueId,
  FactId,
  Precondition,
  PlayerSurface,
  ZoneId,
} from "../../shared/case.js";

function zoneLockedMap(instance: CaseInstance): Map<ZoneId, boolean> {
  // Zones live on the template's map; instance carries items referencing zones.
  // For reachability we only need lock state, derived from the items' zones via
  // the optional `lockedZones` set the generator stamps onto the instance.
  const m = new Map<ZoneId, boolean>();
  for (const z of instance.lockedZones ?? []) m.set(z, true);
  return m;
}

/** Is a precondition satisfied, given the clues reached so far? */
function satisfied(
  pre: Precondition,
  reachedClues: Set<ClueId>,
  instance: CaseInstance,
  locked: Map<ZoneId, boolean>,
): boolean {
  switch (pre.kind) {
    case "always":
      return true;
    case "clue":
      return reachedClues.has(pre.clueId);
    case "enterZone":
      return !locked.get(pre.zoneId);
    case "askTopic":
      // Wave 0: any NPC that exists is approachable.
      return instance.npcs.some((n) => n.id === pre.npcId);
    case "inspectItem": {
      const item = instance.items.find((i) => i.id === pre.itemId);
      return !!item && !locked.get(item.zone);
    }
    case "presentItemTo": {
      const item = instance.items.find((i) => i.id === pre.itemId);
      const npcExists = instance.npcs.some((n) => n.id === pre.npcId);
      return !!item && !locked.get(item.zone) && npcExists;
    }
  }
}

/**
 * Compute the player-reachable surface: the fixpoint of clues whose
 * preconditions are satisfied, plus facts revealed by reachable clues, reachable
 * items (examine), and reachable present-reactions.
 */
export function computeSurface(instance: CaseInstance): PlayerSurface {
  const locked = zoneLockedMap(instance);
  const reachedClues = new Set<ClueId>();
  const reachedFacts = new Set<FactId>();

  // Facts available from reachable items (examine) + present-reactions — these
  // are not part of the clue-chain fixpoint, so seed them first.
  for (const item of instance.items) {
    if (locked.get(item.zone)) continue;
    for (const f of item.revealsFactIds) reachedFacts.add(f);
    for (const pr of item.presentReactions) {
      if (instance.npcs.some((n) => n.id === pr.npcId)) {
        for (const f of pr.revealsFactIds) reachedFacts.add(f);
      }
    }
  }

  // Fixpoint over clue preconditions.
  let changed = true;
  while (changed) {
    changed = false;
    for (const clue of instance.clues) {
      if (reachedClues.has(clue.id)) continue;
      if (satisfied(clue.unlockedBy, reachedClues, instance, locked)) {
        reachedClues.add(clue.id);
        for (const f of clue.revealsFactIds) reachedFacts.add(f);
        changed = true;
      }
    }
  }

  return { reachableFactIds: reachedFacts, reachableClueIds: reachedClues };
}

/**
 * Detect a cycle in the clue→clue precondition graph. The contract requires the
 * reachability graph to be ACYCLIC; a cycle ships an unsolvable case.
 */
export function detectClueCycle(instance: CaseInstance): ClueId[] | null {
  const deps = new Map<ClueId, ClueId | null>();
  for (const c of instance.clues) {
    deps.set(c.id, c.unlockedBy.kind === "clue" ? c.unlockedBy.clueId : null);
  }
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<ClueId, number>();
  for (const id of deps.keys()) color.set(id, WHITE);

  const stack: ClueId[] = [];
  const visit = (id: ClueId): ClueId[] | null => {
    color.set(id, GRAY);
    stack.push(id);
    const dep = deps.get(id) ?? null;
    if (dep != null && deps.has(dep)) {
      const c = color.get(dep);
      if (c === GRAY) return [...stack.slice(stack.indexOf(dep)), dep];
      if (c === WHITE) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    color.set(id, BLACK);
    stack.pop();
    return null;
  };

  for (const id of deps.keys()) {
    if (color.get(id) === WHITE) {
      const cyc = visit(id);
      if (cyc) return cyc;
    }
  }
  return null;
}
