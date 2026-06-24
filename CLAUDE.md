# CLAUDE.md — Parlor agent constitution

> Every agent (implementation, verification, maintenance) reads this first, then `PLAN.md` (the full north-star design), then its component contract. **`PLAN.md` is the single source of truth**; this file is the distilled, non-negotiable subset.

## What we're building
**Parlor** — a daily AI murder-mystery on **Reddit Devvit Web**. Players explore a coordinate map of LLM-driven NPCs, interrogate them, examine interactable items, assemble clues on a Phaser **Deduction Board**, and name the killer. Each player gets a **per-player randomized but validator-proven-unique** instance of the day's case (anti-spoiler). Single-player v1; async leaderboard + "wrapped" summary card carry the social layer. Judged primarily on **day-over-day retention**.

## Guardrails — HARD RULES (never violate)

### Compliance (submission-gating)
- **Runtime LLM = OpenAI or Google Gemini ONLY.** No Claude/Llama/self-hosted at runtime. (Claude builds the app, never serves it.)
- **Never train/tune any model on Reddit data.** Any eval/tuning uses synthetic, self-generated data only.
- **User text input** = question-chips + bounded free-text run through the OpenAI moderation endpoint. No unbounded free-form input.
- **Honor deletions** (Post/Comment/Account triggers purge related data).
- **≤30-day TTL on EVERY Redis key class** (leaderboards, streaks, knowledge graphs, event logs — not just "user content").
- **No Reddit IP** (no Snoo/karma theming); original art + name; no off-platform linking.

### Architecture invariants
- **Solvability is STRUCTURAL, never semantic.** The deduction skeleton is typed data over a closed clue vocabulary; the validator runs on structure. LLM free text is flavor only.
- **Server is authoritative; the LLM is untrusted prose.** Control data (`revealedClueIds`, clue unlocks, win/lose) is computed server-side from the retrieved slice — never parsed out of an LLM reply.
- **`killerId` NEVER appears in any prompt.** The killer's lies are pre-baked as `statedLie` slice-entries; the harness never knows who the killer is.
- **One generic harness; NPCs/items are pure data.** Adding a character or item is a data row, never code.
- **Knowledge slices are projections** (`{factId, statedAs}` references), never copies — redundancy = 0 on fact value.
- **Determinism is integer-pure.** All seeded generation/motion uses the named PRNG (mulberry32) over discrete ticks. Never `Math.random`/`Date.now`/float accumulation in logical state. Smooth tweens are cosmetic and never read by game logic.
- **Only runtime LLM call = principal-tier free-text rephrase.** All chips, supporting/ambient NPCs, item examine/present text are pre-rendered at generation time or templated.
- **Free-first.** Free tiers + free/open tools by default (Gemini free tier, OpenAI moderation, Devvit MCP, open image models); escalate to paid only when a free option demonstrably fails, bounded by a billing cap.

### Process
- **Ground via the Devvit MCP, not memory.** No inventing/hallucinating Devvit APIs — verify against docs (`devvit_search`) and logs (`devvit_logs`).
- **Verify before "done":** `npm run typecheck` + the fast deterministic CI (validator/blind-solver/fakeredis) + the e2e `generate→interrogate→accuse` integration test must be green. Green output is the proof, not your own assertion. No partial/uncompiled edits.
- **Worktree isolation** for parallel file-mutating agents. The `Case` contract (`src/shared/case.ts`) is **frozen before parallel work begins** — do not change it without orchestrator sign-off.
- **Structured handoff:** report `{ filesChanged, testsRun+results, contractDeltas, openQuestions, assumptions }`. Surface assumptions; don't silently guess.

## The contract is the keystone
`src/shared/case.ts` is the single typed contract between generator, validator, NPC harness, and client. Pinned invariants: named PRNG; `seed = (dailyTemplateSeed, playerInstanceSeed)`; `navGrid` cell-size/origin/units; `tick` semantics; **`suspectIds ⊆ principal` tier** (the killer always gets the full harness); `presentReactions` keyed by `(itemId, npcId)`; `zone` authoritative over `coords` for reachability; typed `gating` marker on relationship edges; `truthfulness` lives on the slice-entry, not the shared fact.

## Tiers
`[SPINE]` = v1 critical path · `[STRETCH]` = only if ahead · `[RESEARCH]` = off the shipping path, never gates a build.

## Build order (waves)
- **Wave 0 (sequential, gating):** scaffold + freeze `src/shared/case.ts` + validator/blind-solver + test corpus + Devvit MCP. Nothing parallel starts until this is green.
- **Wave 1 (parallel):** the SPINE component owners (see `PLAN.md` L3, C1–C19).
- **Wave 2 (parallel):** adversarial review, perf, compliance, deterministic solvability sweep.
- **Wave 3:** synthesis — triage to green; gate each submission on the safety script + compliance.

See `docs/devvit-constraints.md` for the platform limits table.
