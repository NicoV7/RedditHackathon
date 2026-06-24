/**
 * Blind solver (C3) — the "validator of the validator". Deduces the killer from
 * ONLY the player-reachable surface (never reads `solution`/`killerId`). A case
 * is solvable iff exactly one suspect survives the reachable evidence.
 */
import type { CaseInstance, Fact, PlayerSurface, SuspectId } from "../../shared/case.js";
import { computeSurface } from "./reachability.js";

export interface SolveResult {
  viable: SuspectId[]; // suspects consistent with all reachable evidence
  unique: SuspectId | null; // the single survivor, or null if 0 or >1
}

/** A suspect is a viable killer iff they have reachable means ∧ opportunity and
 *  NO reachable refuter. */
export function blindSolve(
  suspectIds: readonly SuspectId[],
  facts: readonly Fact[],
  surface: PlayerSurface,
): SolveResult {
  const reachable = (predicate: Fact["predicate"], subject: SuspectId): boolean =>
    facts.some(
      (f) =>
        f.subject === subject &&
        f.predicate === predicate &&
        surface.reachableFactIds.has(f.id),
    );

  const viable = suspectIds.filter((s) => {
    const hasMeans = reachable("means", s);
    const hasOpp = reachable("opportunity", s);
    const refuted = reachable("refutesMeans", s) || reachable("refutesOpportunity", s);
    return hasMeans && hasOpp && !refuted;
  });

  return { viable: [...viable], unique: viable.length === 1 ? viable[0]! : null };
}

/** Convenience: solve an instance from scratch (computes the surface). */
export function solveInstance(instance: CaseInstance): SolveResult {
  const surface = computeSurface(instance);
  return blindSolve(instance.suspectIds, instance.facts, surface);
}
