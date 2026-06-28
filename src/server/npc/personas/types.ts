/**
 * PersonaSkill — the SERVER-ONLY, GUILT-BLIND "fat skill" for a principal NPC.
 *
 * One generic harness consumes these generically (no per-character code). A skill
 * encodes personality + cultural background + voice + boundaries + in-character
 * tell prose. It contains NOTHING about who the killer is: it does not import
 * `killerId`/`solution`/`SliceEntry`/`Fact`, and the same skill is used whether or
 * not the character is the killer this run — deception lives ONLY in the structural
 * `statedLie` slice entries. (Enforced by the guilt-blind static scan in the eval
 * battery.)
 */
import type { NpcId, Predicate } from "../../../shared/case.js";

/** In-character tell prose keyed by the lie's predicate shape. REPLACES the generic
 *  facultyForLie() line but stays COSMETIC + STRUCTURAL: selected by predicate only,
 *  never by guilt. The faculty mapping + statedLie gate stay in the harness. */
export type TellShapeLines = Partial<Record<Predicate, string>>;

export interface PersonaSkill {
  /** MUST equal the roster id the generator mints (= persona.name). */
  npcId: NpcId;

  /** Voice + cultural register, with an anachronism denylist. */
  speech: {
    register: string;
    tics: string[];
    forbidden: string[];
  };

  /** Cultural background grounding the character in the 1920s noir setting. */
  background: {
    origin: string;
    occupationColor: string;
    era: string;
  };

  /** HOW they answer under questioning — never WHAT they hide (guilt-blind). */
  disposition: {
    cooperation: "forthcoming" | "guarded" | "evasive" | "hostile";
    underPressure: string;
    deflectStyle: string;
  };

  /** The ONLY other cast members this NPC may name unprompted (guardrail allowlist).
   *  Social graph, not the case solution. */
  relationships: Array<{
    npcId: NpcId;
    stance: "ally" | "rival" | "wary" | "kin" | "knows";
  }>;

  /** Per-NPC boundaries + ready in-character deflections for guardrail substitution. */
  boundaries: {
    refusalStyle: string;
    offLimits: string[];
    /** ≥2 in-character lines the guardrail can swap in when an output trips a rule. */
    deflectionTemplates: string[];
  };

  /** Per-RUN overlay pool (≥3). Guilt-blind; applied to every principal symmetrically,
   *  seeded by (instanceSeed, npcId) only, so it can never single out the killer. */
  dailyMoods: string[];

  /** Per-predicate in-character tell prose (replaces the generic line). */
  tellLines: TellShapeLines;

  /**
   * Optional cultural-translation profile (Workstream C). `phrasebook` holds short
   * ENGLISH interjections (guilt-blind) that get translated into `language` and
   * injected at runtime. OMITTED for English-native characters (no injection).
   */
  culture?: {
    /** target language code, e.g. "it" | "ga" | "la" */
    language: string;
    /** human label, e.g. "Italian" */
    languageName: string;
    /** short English source interjections (drawn from the canonical dictionary) */
    phrasebook: string[];
  };

  /** Eval-only anchors. NEVER enter a prompt. */
  evalAnchors: {
    voiceExemplars: string[];
    mustNotSay: string[];
    inCharacterTopics: string[];
  };
}
