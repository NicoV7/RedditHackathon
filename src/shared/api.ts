/**
 * Client ↔ server API DTOs (shared). CRITICAL SECURITY BOUNDARY: the client view
 * is a SANITIZED projection of a CaseInstance — it NEVER carries killerId,
 * solution, facts, clues, or NPC slices. The client learns clue text only as the
 * server reveals it (server-authoritative). See toClientView() below.
 */
import type { CaseInstance, ItemKind, MapDef, NpcTier, RoutineStep } from "./case.js";

export type NominationRole = "suspect" | "bystander" | "killer" | "unknown";

export interface ClientNpcView {
  id: string;
  name: string;
  blurb: string;
  voice: string;
  tier: NpcTier;
  homeZone: string;
  routine: RoutineStep[]; // positions are not secret — drives movement
}
export interface ClientItemView {
  id: string;
  kind: ItemKind;
  zone: string;
  coords: { x: number; y: number };
  // examineText intentionally omitted — revealed only via the examine endpoint
}
export interface ClientCaseView {
  caseId: string;
  dailySeed: string;
  setting: string;
  victim: string;
  map: MapDef;
  suspectIds: string[];
  npcs: ClientNpcView[];
  items: ClientItemView[];
}

export interface RevealedClue {
  id: string;
  text: string;
}

// ── request/response shapes ──
export interface StartCaseRequest { dailySeed: string; }
export interface StartCaseResponse { view: ClientCaseView; }

export interface InterrogateRequest { caseId: string; dailySeed: string; npcId: string; message: string; }
export interface InterrogateResponse { reply: string; revealed: RevealedClue[]; moderated?: boolean; }

export interface ExamineRequest { caseId: string; dailySeed: string; itemId: string; }
export interface ExamineResponse { examineText: string; revealed: RevealedClue[]; }

export interface NominateRequest { caseId: string; npcId: string; role: NominationRole; }
export interface NominateResponse { ok: true; }

export interface AccuseRequest {
  caseId: string;
  dailySeed: string;
  nominatedKillerId: string;
  nominations: Record<string, NominationRole>;
  discoveredClueIds: string[];
  inventory: string[];
  questions: number;
  timeMs: number;
}
export interface AccuseResponse {
  solved: boolean;
  score: number;
  rank: number | null;
  streak: { count: number; freeze: number };
  /** spoiler-safe end-of-game reveal + summary card data */
  summary: {
    killerName: string;
    yourClueCount: number;
    crowd: { total: number; killerRightPct: number };
  };
}

/** Strip everything secret. The ONLY place an instance becomes a client payload. */
export function toClientView(instance: CaseInstance, dailySeed: string): ClientCaseView {
  return {
    caseId: instance.templateId,
    dailySeed,
    setting: "", // filled by the endpoint from the template
    victim: "",
    map: { zones: [], navGrid: { cellSize: 16, origin: { x: 0, y: 0 }, cols: 25, rows: 25 } },
    suspectIds: instance.suspectIds,
    npcs: instance.npcs.map((n) => ({
      id: n.id,
      name: n.persona.name,
      blurb: n.persona.blurb,
      voice: n.persona.voice,
      tier: n.tier,
      homeZone: n.homeZone,
      routine: n.routine,
    })),
    items: instance.items.map((i) => ({ id: i.id, kind: i.kind, zone: i.zone, coords: i.coords })),
  };
}
