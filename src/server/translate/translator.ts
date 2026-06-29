/**
 * Translator (Workstream C) — an injected, model-agnostic translation service,
 * mirroring the `LlmProvider` philosophy. The backend is swappable: a `LocalTranslator`
 * (offline dictionary) ships now; a cloud Gemini/General-Translation backend swaps in
 * later behind this exact interface, with no harness change.
 *
 * Compliance: the translator is given ONLY pre-authored NPC interjection phrases —
 * never player free-text. (Enforced at the call site + asserted in tests.)
 */
import { LOCAL_DICTIONARY } from "./dictionary.js";

export interface TranslateRequest {
  /** the short ENGLISH source phrase (an NPC interjection — never player text) */
  text: string;
  /** target language code, e.g. "it" | "ga" | "la" */
  targetLang: string;
}

export interface Translator {
  readonly name: string;
  translate(req: TranslateRequest): Promise<string>;
}

/** Deterministic, offline translator for tests + local fallback. Records calls so
 *  tests can assert it only ever sees NPC phrases. */
export class MockTranslator implements Translator {
  readonly name = "mock";
  public readonly calls: TranslateRequest[] = [];
  constructor(private readonly fn: (r: TranslateRequest) => string = (r) => `[${r.targetLang}] ${r.text}`) {}

  async translate(req: TranslateRequest): Promise<string> {
    this.calls.push(req);
    return this.fn(req);
  }
}

/** The "local model for now": an offline dictionary lookup. Unknown (lang, text)
 *  pairs fall back to the English source (graceful, never throws). */
export class LocalTranslator implements Translator {
  readonly name = "local";
  constructor(private readonly dict: Record<string, Record<string, string>> = LOCAL_DICTIONARY) {}

  async translate(req: TranslateRequest): Promise<string> {
    return this.dict[req.targetLang]?.[req.text] ?? req.text;
  }
}

/**
 * Factory for a runtime translator. Default = offline `local`. Cloud backends
 * (`gemini` via the already-allowlisted endpoint, or `gt` = General Translation)
 * are wired in the Devvit server runtime later — they throw here so a misconfigured
 * deploy fails loudly, exactly like `createProvider`.
 */
export function createTranslator(env: Record<string, string | undefined> = {}): Translator {
  const backend = env.PARLOR_TRANSLATE_BACKEND ?? "local";
  if (backend === "local") return new LocalTranslator();
  throw new Error(`createTranslator: live "${backend}" backend wired in the Devvit server runtime`);
}
