/**
 * Structural validator (C3). Proves an instance is solvable & unique WITHOUT
 * trusting prose: structural checks + a cycle check + the blind solver must land
 * exactly on `killerId`. No build/daily-rotation ships a case this rejects.
 */
import type { CaseInstance } from "../../shared/case.js";
import { MAX_SUSPECTS } from "../../shared/case.js";
import { computeSurface, detectClueCycle } from "./reachability.js";
import { blindSolve } from "./solve.js";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateInstance(instance: CaseInstance): ValidationResult {
  const { suspectIds, killerId } = instance;

  // 1. Structural sanity.
  if (suspectIds.length === 0) return { ok: false, reason: "no suspects" };
  if (suspectIds.length > MAX_SUSPECTS)
    return { ok: false, reason: `>${MAX_SUSPECTS} suspects` };
  if (new Set(suspectIds).size !== suspectIds.length)
    return { ok: false, reason: "duplicate suspect ids" };
  if (!suspectIds.includes(killerId))
    return { ok: false, reason: "killerId not in suspectIds" };

  // 2. Referential integrity: clues reveal known facts.
  const factIds = new Set(instance.facts.map((f) => f.id));
  for (const c of instance.clues) {
    for (const fid of c.revealsFactIds) {
      if (!factIds.has(fid))
        return { ok: false, reason: `clue ${c.id} reveals unknown fact ${fid}` };
    }
  }

  // 3. Acyclic reachability (contract invariant).
  const cycle = detectClueCycle(instance);
  if (cycle) return { ok: false, reason: `clue cycle: ${cycle.join(" -> ")}` };

  // 4. The blind solver (independent of `solution`) must find a UNIQUE killer
  //    and it must be the intended one.
  const surface = computeSurface(instance);
  const { viable, unique } = blindSolve(suspectIds, instance.facts, surface);
  if (viable.length === 0) return { ok: false, reason: "unsolvable: no viable suspect" };
  if (unique == null)
    return { ok: false, reason: `ambiguous: ${viable.length} viable (${viable.join(",")})` };
  if (unique !== killerId)
    return { ok: false, reason: `blind solver found ${unique}, not killer ${killerId}` };

  return { ok: true };
}
