/**
 * LLM provider + moderation gateway (C4). Single-call interface behind which
 * Gemini (free-tier default) or OpenAI sit. Free-first: real providers read a
 * Devvit secret; tests use the deterministic MockProvider (no network, no keys).
 *
 * Architecture invariant: the provider receives ONLY an assembled system+user
 * prompt. It never sees `killerId`/`solution` — that's enforced by the harness
 * (C5), which assembles prompts from an NPC's slice, never the case solution.
 */

export interface CompletionRequest {
  system: string;
  user: string;
  /** soft cap; the harness also hard-truncates the reply */
  maxSentences?: number;
}

export interface ModerationResult {
  flagged: boolean;
  categories?: string[];
}

export interface LlmProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<string>;
  moderate(text: string): Promise<ModerationResult>;
}

/** Deterministic, offline provider for tests + local fallback. */
export class MockProvider implements LlmProvider {
  readonly name = "mock";
  public readonly calls: CompletionRequest[] = [];
  constructor(private readonly reply: (r: CompletionRequest) => string = () => "I have nothing to add.") {}

  async complete(req: CompletionRequest): Promise<string> {
    this.calls.push(req);
    return this.reply(req);
  }

  async moderate(text: string): Promise<ModerationResult> {
    // Stand-in for OpenAI's free moderation endpoint.
    const flagged = /\b(kill yourself|slur-token)\b/i.test(text);
    return flagged ? { flagged, categories: ["harassment"] } : { flagged: false };
  }
}

/**
 * Factory for a runtime provider. Free-first: default Gemini Flash; OpenAI is the
 * swap. Real network calls go through the approved Devvit fetch domains. Throws
 * if no key is configured (so a misconfigured deploy fails loudly, not silently).
 */
export function createProvider(env: Record<string, string | undefined> = {}): LlmProvider {
  const provider = env.PARLOR_LLM_PROVIDER ?? "gemini";
  const key = env.PARLOR_LLM_KEY;
  if (!key) {
    // No key in this environment (e.g. sandbox / CI) — callers should inject a
    // MockProvider for tests; runtime must supply a Devvit secret.
    throw new Error(`createProvider: no PARLOR_LLM_KEY set for provider "${provider}"`);
  }
  // Real Gemini/OpenAI HTTP implementations are wired in the Devvit server
  // (needs the runtime fetch + secret). Interface above is the contract they
  // satisfy; see PLAN C4. Intentionally not network-called from unit tests.
  throw new Error(`createProvider: live "${provider}" client wired in the Devvit server runtime`);
}
