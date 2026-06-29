/**
 * Offline canonical interjection dictionary — the "local model for now" backend.
 *
 * A small, fixed set of short, GUILT-BLIND interjections with hand-authored
 * translations per cultural language. Persona `culture.phrasebook` entries are
 * drawn from these English keys, so `LocalTranslator` always has a real
 * translation (no network, fully deterministic). Swapping to Gemini/GT later
 * (behind the same `Translator` interface) lifts this fixed-set limitation.
 *
 * Languages: it = Italian, ga = Irish, la = Latin.
 */
export const LOCAL_DICTIONARY: Record<string, Record<string, string>> = {
  it: {
    "You understand?": "Capisci?",
    "Of course.": "Certo.",
    "My friend.": "Amico mio.",
    "God forgive me.": "Che Dio mi perdoni.",
    "I swear it.": "Lo giuro.",
    "Listen to me.": "Ascoltami.",
    "Nothing at all.": "Niente di niente.",
    "Enough.": "Basta.",
    "Believe me.": "Credimi.",
    "What can I say?": "Che posso dire?",
  },
  ga: {
    "You understand?": "An dtuigeann tú?",
    "Of course.": "Ar ndóigh.",
    "My friend.": "A chara.",
    "God forgive me.": "Go maithe Dia dom.",
    "I swear it.": "Mionnaím é.",
    "Listen to me.": "Éist liom.",
    "Nothing at all.": "Faic na fríde.",
    "Enough.": "Go leor.",
    "Believe me.": "Creid mé.",
    "What can I say?": "Cad is féidir liom a rá?",
  },
  la: {
    "You understand?": "Intellegisne?",
    "Of course.": "Certe.",
    "My friend.": "Amice.",
    "God forgive me.": "Di mihi ignoscant.",
    "I swear it.": "Iuro.",
    "Listen to me.": "Audi me.",
    "Nothing at all.": "Nihil omnino.",
    "Enough.": "Satis.",
    "Believe me.": "Crede mihi.",
    "What can I say?": "Quid dicam?",
  },
};

/** Every English interjection key the dictionary can translate (any language). */
export const CANONICAL_PHRASES: readonly string[] = Object.keys(LOCAL_DICTIONARY.it ?? {});
