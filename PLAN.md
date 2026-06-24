# Design + Build Plan: "Parlor" — a Daily AI Murder Mystery on Reddit (Devvit Web)

> Generated via `/office-hours` (Builder mode) on 2026-06-23. Branch: `main`. Repo: `RedditHackathon` (greenfield).
> Status: DRAFT — pending approval. Working codename **"Parlor"** (final name TBD; must be original, no Reddit/3rd-party IP).
> Hackathon: Reddit Devvit "games that bring people back" — submission window June 17 → July 15. ~20 working days.

---

## Context — why this plan exists

We're entering the Reddit Devvit hackathon ($40k, judged primarily on **day-over-day retention**). The idea: a murder-mystery where the killer is hidden among **LLM-driven NPCs** with distinct personalities and relationships; the player explores a map, interrogates suspects, accumulates a knowledge graph, and names the killer.

The user's explicit priorities: **maintainability, reliability, and limiting technical debt from day one** — *not* raw speed. The session's job was to choose a tech stack/engine that fits Reddit's platform and to scope so we don't overrun the 20-day clock.

We grounded every platform claim in Reddit's official docs (`reddit/devvit-docs`), which overturned several default assumptions. The findings below are load-bearing — they are why the architecture looks the way it does.

---

## Platform constraints that shaped the design (verified in Devvit docs)

| Constraint | Source | Consequence |
|---|---|---|
| **Approved LLMs are ONLY OpenAI + Google Gemini.** Anthropic/Claude, Llama, self-hosted = denied. | `devvit_rules.md` §Generative AI; `http-fetch-policy.md` | In-game NPCs run on **Gemini** or **OpenAI** (both globally allow-listed). Claude is used only to *build* the app, never at runtime. |
| **LLM + HTTP fetch are "premium" → require app review (~1 week); re-submit on every publish (streamlined after first).** | `devvit_rules.md` §App review, §19 | **Schedule risk #1.** Submit a working build for review by ~**day 7**. Plan all work around review latency. |
| **Storage = Redis only, siloed per-subreddit installation.** No Postgres/pgvector. 2KB/setting. | `redis.mdx`, `settings-and-secrets.mdx` | Knowledge graph, clues, leaderboard, streaks all live in **Redis** (sorted sets, bitfields, hashes). pgvector RAG from the Berkeley project does **not** port. A *cross-subreddit global* leaderboard would need an external approved service (Supabase/Firebase) — optional, post-MVP. |
| **Realtime IS supported** (`connectRealtime` client + `realtime.send` server; pub/sub; "no observable lag") but **server-authoritative**. | `realtime/overview.md` | Synchronous co-op is *feasible* but is lobby+matchmaking+netcode. **Stretch, not v1.** |
| **Scheduler**: cron via `devvit.json`, max **10 recurring jobs/install**, 60 `runJob`/min. | `scheduler.mdx` | Daily "Case of the Day" post creation is trivial and reliable. |
| **Content rule: "avoid free-form text inputs" for user content**; constrain to safe dictionaries; moderate UGC; honor deletions; expire Redis ≤30 days. | `devvit_rules.md` §Content, §Deletions | Player interrogation text is the flagged pattern → **question-chips + bounded free-text run through OpenAI's free moderation endpoint**. Triggers wired for Post/Comment/Account deletion. |
| **Serverless: 30s/request, 4MB payload, 10MB response; dev pays per token; localStorage wipes on update.** | `devvit_web_overview` | **Generate the whole case once/day** (scheduler job), not per-player-per-message. Per-player calls become cheap retrieval + light voice rendering. All state in Redis. |
| **Engines: React, Three.js, Phaser are all first-class** (templates + auto-configured agent rules). Unity = WebGL export, not first-class (bundle/mobile risk). | `guides/ai/ai.md`, `/new` templates | **Phaser** for the explorable map: 2D, mobile-friendly, reuses Berkeley Phaser patterns, and targets the **"Best Use of Phaser"** sub-prize. |
| **No Reddit IP** (no Snoo/karma theming), must be original (no clones), no off-platform linking. | `devvit_rules.md` §Brand/IP | Original art + name; "Reddit-y" via community play, not Reddit-the-topic. |

---

## The core concept (and the reframe that makes it win)

A murder mystery is **inherently one-and-done** — solve once, no reason to return. That directly opposes the #1 judging criterion. Reddit's own community-games guide says winners run a **content flywheel** (daily scheduled content *or* user-generated content). So:

**Parlor = "Wordle for whodunnits," hosted in its own subreddit that doubles as a community case-library.**
- **The subreddit IS the case library.** Cases come from two sources, both passing the *same* validator + PII/moderation gate: (a) AI-generated (procedural skeleton + LLM voice), and (b) **community-authored** (Case Forge + MCP stretch). Mod-approved cases enter the pool; upvotes/quality rank them.
- **Case of the Day** = the scheduler **rotates one case from the curated pool** each day (the whole subreddit plays the *same* case) → **fair daily leaderboard** (accuracy + speed + fewest questions), **streaks**, theory-comparison in comments. *This single mechanic targets three prizes at once — Hook + Retention + User Contributions.*
- **Endless mode** (per-run seed): a fresh randomized killer/cast on demand → infinite replayability, personal stats. *This is "randomized each run."* (Stretch; procedural-only to avoid per-run LLM cost.)

Retention levers (straight from Reddit's playbook, all Redis-backed): daily fresh case, daily leaderboard, streaks (+ streak-freeze grace), flair/badges for ranks, explicit "share your verdict" comment, subscribe button.

## Award strategy — stay live for the entire $40k board
[Games with a Hook Hackathon](https://redditgameswithahook.devpost.com/). Of 7 prize buckets only **one is engine-locked** (Best Use of Phaser → requires Phaser); the rest are engine-agnostic. So **Phaser is strictly dominant for award coverage** — a non-Phaser engine forfeits $5k and gains nothing (no Three.js/Unity prize exists here). **Engine decision: Phaser + React. Locked.**

| Prize | $ | Plan hook |
|---|---|---|
| Best App with a Hook | 15,000 | Daily-case retention loop = the hook (primary target) |
| Best Use of Phaser | 5,000 | Deduction Board (hero) + animated NPC tells + spatial clue discovery |
| Best Use of Retention | 3,000 | Daily case, streaks (+freeze), leaderboard, flair/badges, comments |
| Best Use of User Contributions | 3,000 | **Subreddit case-library**: in-app Case Forge (broad) + MCP authoring (stretch) → curated pool → daily rotation showcases community cases; theory comments |
| Honorable Mentions ×10 | 1,000 | Polish, unique identity, mobile feel |
| Devvit Helper ×6 | 500 | **Non-code task:** be active/helpful in r/Devvit + Discord during the event |
| Feedback Award | 200 | **Non-code task:** complete the developer satisfaction survey |

---

## Architecture

### Single source of truth: the `Case` fact-graph
A validated JSON object is the spine of everything:
```
Case {
  seed, setting, victim,
  suspects: [{ id, persona, knowledgeSlice, alibi, secret, truthfulness }],
  killerId,
  timeline: [events],
  clues: [{ id, fact, location, unlockedBy }],
  relationships: graph(who knows/trusts/distrusts whom),
  solution: { killerId, supportingClueIds }   // what the validator proves
}
```
Typed schema (shared `src/shared/case.ts`) is the contract between generator, validator, NPC harness, and client. **This single typed contract is the main defense against technical debt.**

### Case generation — typed-structure + structural validator + procedural spine (decision: C, refined after adversarial review)
**Key refinement (from review): solvability must be *structural*, not *semantic*.** A validator cannot reliably prove that free-form LLM prose implies exactly one killer. So the case's **logical skeleton is always typed data over a fixed clue vocabulary**, and the validator runs on that structure — cheap and provable. The LLM's free text is confined to *flavor/voice*, which the validator never needs to verify.

One `generateCase(seed)` interface, two fill strategies:
1. **Procedural constraint generator = solvability source of truth (v1 spine + always-available fallback).** Seeded logic assembles a typed skeleton (cast, relationships, killer, motive/means/opportunity, alibi-clue graph) **solvable & contradiction-free by construction.**
2. **LLM as themer/voicer (v1).** LLM names/themes the *pre-validated* skeleton and writes persona dialogue — it never invents the logic, so it can't break solvability.
3. **LLM-drafts-the-typed-structure (stretch = the original "C").** LLM proposes the skeleton *as typed JSON constrained to the clue vocabulary*; the **structural validator proves uniqueness** (killer deducible AND every other suspect eliminated) + reachability; on failure → repair, then procedural fallback.
- **"Who validates the validator":** a Phase-1 **test corpus** of hand-authored solvable AND deliberately-unsolvable typed cases with known verdicts; the solver must score 100% on it before the LLM path is trusted.
- Difficulty is a **computed function** (clues-required, #red-herrings, deduction depth) used to keep cases in a target band.

### Runtime NPC harness — "fat persona / thin harness"
- **One generic function** `NPCHarness(persona, knowledgeSlice, transcript, playerMessage) → { reply, revealedClueIds }`. Builds a templated system prompt (persona voice + knowledge slice + behavioral rules: "not omniscient; answer only from your slice; killer deflects/lies but stays consistent with prior statements in `transcript`"). Calls the LLM. Personality is **pure JSON data slotted in** — adding a character never touches the harness.
- **NPCs connect via the shared `Case`, not by calling each other** for 1:1 talk — A's knowledge slice already contains facts about B, so answers are consistent *for free*. The validator is what makes cross-NPC corroboration trustworthy.
- **Multi-NPC confrontation scenes** = small server-side orchestrator (reuses Berkeley's debate-orchestrator pattern): NPCs take turns over a shared transcript so B can rebut A; a suspect caught contradicting their own earlier lie = a "gotcha" clue. Capped at 2–3 NPC turns/message to fit 30s + cost. **Harness supports it from day 1; the multi-NPC UI is a Phase 3 reveal.**
- **Cost/latency control**: case facts pre-generated daily; per-message LLM call only renders *voice* over retrieved facts; Redis-cache aggressive; question-chips reduce call volume; moderation endpoint guards inputs.

### Phaser showcase — three mechanics that make Phaser *central to deduction* (target: Best Use of Phaser)
1. **🎯 Deduction Board (hero, = the knowledge graph made tactile).** Interactive conspiracy cork-board: clue cards / suspect portraits / motives the player **drags and links with red string** to build hypotheses; contradictions spark; the correct chain unlocks the accusation. Phaser-native: drag physics, spring/string rendering, particle juice; visually iconic + feed-shareable. *This replaces a plain "knowledge graph UI" — same data, far stronger.*
2. **Animated NPC tells.** Suspect sprites with an emotion state-machine driven by the LLM's `truthfulness`/pressure (fidget, sweat, averted gaze when lying; composure when honest). Body language = a second clue channel beyond words.
3. **Spatial clue discovery.** The explorable scene: pan/zoom + magnifying-glass/light reveal (Phaser masks/lighting) to surface hidden clues on-theme.
Together: Phaser is pervasive and mechanically essential, not decorative.

### Build-time agents (dev workflow — thin harness, fat skills)
- **`compliance-reviewer`** — audits each build against the distilled Devvit rules before every (re)submission.
- **`playtester` ×N** — parallel auto-play over many seeds: verifies end-to-end solvability, balance/difficulty, and NPC-turn sanity. Fan-out via the Workflow tool.
- Both grounded by the **Devvit MCP** (`devvit_search`, `devvit_logs`).

### User-contributions pipeline & guardrails (the subreddit case-library)
Every authored case — Case Forge (in-app, broad) **or** MCP (power-user, stretch) — passes one **ingestion gate** before it can be played or rotated:
1. **PII scrub** — strip names/emails/phones/addresses/handles from user text (regex + LLM pass); reject if residual PII.
2. **Content moderation** — OpenAI moderation endpoint (free, allow-listed) + policy checks; reject harmful/hateful/sexual/violent.
3. **Structural validation** — must pass the solvability validator (typed clue graph, unique killer, reachable clues) to be playable.
4. **Mod-approval queue** — a human/mod approves before a community case enters the daily-rotation pool (Devvit menu action; reuse scheduler/Reddit API).
5. **Deletion + retention compliance** — Post/Comment/Account delete triggers purge related case data; Redis user-content keys expire ≤30 days; attribution to author per user-action rules.
- **Architecture for MCP path (stretch):** external MCP client → **your MCP server → Supabase** (approved external store) → **Devvit server fetches** approved cases (allow-listed) → ingestion gate → Redis/post. (Reuses Prisma/Supabase; core play never requires MCP.)

### Evals, prompt-optimization & fine-tuning (offline tracks)
> ⚠️ **Hard compliance rule (verbatim):** apps must *not* "use Reddit data to create, improve, modify, train, fine-tune … any Generative AI/LLM/ML/NLP models." And only **OpenAI + Gemini** models are servable at runtime — **self-hosted/fine-tuned Llama-style models cannot be called from the Devvit app.** This bounds what "RL/fine-tuning" can mean here.

- **Eval corpus — IN SCOPE, high value.** Generate a **large synthetic corpus** (cases + adversarial jailbreaks + PII-laden samples + moderation edge-cases) — synthetic only, **never Reddit data.** The offline eval harness (extends playtester agents; reuses Berkeley's LLM-judge) scores: PII-scrub recall, moderation precision/recall, case solvability (vs. test corpus), killer-ID-leak / prompt-injection resistance, persona consistency, dialogue quality, latency, cost. **Release-gating:** no build ships/resubmits unless evals are green. Run in chunks for throughput. Backbone of "maintainability/reliability."
- **Prompt-optimization — IN SCOPE, the shipping optimizer (decision A).** Use eval scores as the reward to optimize *prompts* (persona templates, generation/moderation prompts) — GEPA/DSPy-style loop (reuse Berkeley `TrainingArtifact`). Ships as better prompts that run on Gemini/OpenAI: **no model training, no Reddit data, no compliance issue, fully servable.** This is the deployable "RL-flavored" loop.
- **GRPO — RESEARCH TRACK, OFF the critical path (decision A).** Self-hosted weight-RL (Berkeley GRPO genomes) is great for learning/a process story but produces a model we **cannot serve on Devvit** (only OpenAI/Gemini servable) and must never train on Reddit data → **not in the shipped app, does not block the build.**
- **Hosted RFT/SFT — late stretch only.** The only *deployable* fine-tune path: OpenAI/Gemini **hosted** tuning (incl. OpenAI reinforcement fine-tuning) on the **synthetic** corpus → servable via the allow-list. Real scope; pursue only if far ahead.

### Stack summary
- **Client:** Devvit Web (React + Vite) shell for dialogue/menus; **Phaser** for the three showcase mechanics (Deduction Board, NPC tells, spatial discovery); Zustand + React Query (reuse Berkeley client patterns).
- **Art:** AI-generated against a **locked palette + style guide** (decision A), with a human art-direction pass — answers the judges' "no AI slop" note while keeping a unique identity. Asset-generation agent works to the style spec, not free-for-all.
- **Server:** Devvit Node serverless (Hono), `@devvit/web/server` (Redis, Reddit API, scheduler, realtime, settings/secrets).
- **LLM:** **Gemini 2.x Flash by default** (generous free tier → lowest hackathon cost) behind a provider interface so OpenAI `gpt-4o-mini` is a one-line swap; key stored as a Devvit **secret**.
- **Storage:** Redis (sorted sets = leaderboards, bitfields = streaks, hashes/JSON = case + player knowledge graph). Optional external **Supabase** (Prisma) only if a cross-subreddit global leaderboard is pursued.

---

## Reused vs. new (vs. Berkeley `/BerkeleyAIHackathon2026`)
- **Reuse the patterns, not the Python:** persona schema (`party/persona.py`), turn orchestrator (`debate/orchestrator.py`), dialogue UI (`NPCDialogue.tsx`), Phaser scene/NPC behavior (`OverworldScene.ts`, `NPCBehavior.ts`), provider-gateway abstraction.
- **Drop entirely:** FastAPI, Postgres/SQLModel, pgvector RAG, WebSocket streaming (replaced by Redis + Devvit realtime + request/response).

---

## Phased scope (20 days, review-latency-aware)

*Sequencing principle (from review): start the review clock with the thinnest LLM-touching build, then build the rest IN PARALLEL during review latency. Budget for **two** review cycles (assume one rejection). Always keep a **procedural-only, no-premium-fetch fallback build** that is submittable even if the LLM path stalls in review.*

- **Phase 0 — Foundation + guardrails-as-code (Days 1–2).** Scaffold from Phaser template at `developers.reddit.com/new`. Add Devvit MCP (`claude mcp add devvit -- npx -y @devvit/mcp`). Write in-repo **`CLAUDE.md` constitution** + **`docs/devvit-constraints.md`**. Define `src/shared/case.ts` (with field-level semantics for `knowledgeSlice`/`truthfulness`/`unlockedBy`), `devvit.json` (permissions: redis, http domains for `generativelanguage.googleapis.com`/`api.openai.com`, scheduler task, post entrypoint — **no realtime permission yet**), LLM secret. Build the **validator + its test corpus** here (it's the hidden long pole — front-load it).
- **Phase 1 — Thinnest reviewable loop (Days 3–6) → SUBMIT ~Day 6–7.** Procedural case → **chip + bounded-text interrogation (1:1) on real LLM** → accuse → win/lose → Redis. Minimal UI (no Phaser yet). Per-user rate-limit + input moderation + killer-leak guard from the start. **Submit to start the review clock.**
- **Phase 1b — Parallel during review (Days 6–10).** Phaser map + clue discovery + knowledge-graph UI + first-run onboarding (guided first case). Wire as updates → streamlined re-review.
- **Phase 2 — The hook: daily + social + reliability (Days 9–13).** Scheduler **rotates the daily Case of the Day from an AI-seeded pool** (pre-generate a small library). Daily leaderboard (sorted set) + streaks (bitfield, +freeze grace) + bounded "share your verdict" comment + flair/badges. **First-run onboarding** finalized. **Retention analytics** (Redis counters: started/completed/accused/returned-next-day). **Public-reliability workstream:** paid Gemini key + billing cap, graceful degradation on rate-limit, aggressive Redis caching of chip-question answers (most interrogations become zero-LLM retrieval).
- **Phase 3 — UGC + differentiation (Days 13–16).** **Case Forge** (in-app, constrained authoring) + **ingestion gate** (PII scrub → moderation → solvability validator → mod-approval queue) → community cases join the rotation pool. **Large synthetic eval corpus + harness gating + prompt-optimization** pass. Persona variety, sound/feel, mobile viewport. Playtester-agent seed sweeps; compliance-agent pass.
- **Phase 4 — Hardening + submission (Days 17–20).** Mobile QA, error/empty states, ToS/Privacy pages + README "Fetch Domains" section, demo subreddit + seeded demo post, final resubmission (cycle 2 buffer).
- **Stretch (only if ahead of schedule):** **MCP case-authoring** + Supabase relay; multi-NPC **confrontation orchestrator** (incremental turns, *not* one blocking 30s request) + contradiction "gotchas"; **endless mode** (procedural-only generation); realtime co-op rooms (feature-flagged; request realtime permission only then); **LLM-drafts-typed-structure** generation; hosted RFT/SFT on synthetic data. *(GRPO weight-RL = parallel research, never on the shipping path.)*

---

## Implementation orchestration (multi-agent fleet — I act as orchestrator)
Once approved and out of plan mode, I orchestrate the build as deterministic **waves** (Workflow tool / AIDE fleet; worktree isolation for agents that mutate files in parallel). The `Case` contract + `CLAUDE.md` are written first so every agent shares one ground truth.

- **Wave 0 — Foundation (sequential, gating):** scaffold + `devvit.json` + `src/shared/case.ts` + `CLAUDE.md`/`docs` + **validator & test corpus** + Devvit MCP. Nothing else starts until this is green.
- **Wave 1 — Build (parallel, after Wave 0):**
  - *UI/UX agent* — React shell, dialogue UI, onboarding/first-run, mobile-viewport + feed-first screen.
  - *Game-systems (Phaser) agent* — Deduction Board, NPC tells, spatial discovery, scene/input.
  - *Asset-generation agent* — art to the locked style guide (sprites, board, UI), anti-slop pass.
  - *Storage/data agent* — Redis layer (sorted-set leaderboards, bitfield streaks, knowledge hashes) with **explicit N+1 / round-trip discipline** (pipelines, `MGET`, no per-clue round-trips).
  - *LLM/NPC agent* — provider interface, `NPCHarness`, moderation, chip-answer caching.
  - *Case-generation agent* — procedural generator (+ stretch LLM-typed-structure path).
  - *UGC/compliance agent* — Case Forge authoring + ingestion gate (PII scrub → moderation → validator → mod-approval); deletion triggers + retention expiry.
  - *Evals agent* — synthetic corpus generation + harness (PII/moderation/solvability/leak/persona) + prompt-optimization loop.
- **Wave 2 — Verify & harden (parallel, after Wave 1):**
  - *Adversarial code-review agents* — correctness bugs, security (prompt-injection / killer-ID leak), **edge cases beyond the happy path** (empty/error states, malformed LLM JSON, timeouts, rate-limit).
  - *Latency/perf agent* — Redis fan-out / N+1, 30s request budget, bundle size, Phaser mobile frame perf.
  - *Maintainability agent* — contract adherence, complexity, dead code, test coverage.
  - *Playtester agents* — solvability sweeps over seeds, balance, jailbreak/leak.
  - *Compliance agent* — Devvit rules (LLM allowlist, free-form-text, deletions, IP, ToS/privacy, README fetch domains).
- **Wave 3 — Synthesis:** I triage all findings into prioritized fix waves and re-run verification until green; gate each submission on the eval harness.

## Key files (to be created)
- `CLAUDE.md` — agent constitution (hard constraints + compliance + decisions). *In-repo, per user request.*
- `docs/devvit-constraints.md` — distilled rules/limits table.
- `devvit.json` — permissions, scheduler, post, settings/secrets.
- `src/shared/case.ts` — the `Case` typed contract.
- `src/server/case/{generate.ts, validate.ts, procedural.ts}` — generation pipeline.
- `src/server/npc/{harness.ts, orchestrator.ts}` — NPC dialogue + confrontation.
- `src/server/llm/provider.ts` — Gemini/OpenAI interface + moderation.
- `src/server/redis/{leaderboard.ts, streaks.ts, knowledge.ts}`.
- `src/client/` — React shell + `phaser/MapScene.ts` + interrogation/knowledge-graph UI.
- `.cursor`/agent defs + project skill (below).

---

## Skill Audit / project RAG (per user request: "skills set with rag for this project")
- **Adopt Reddit's Devvit MCP** as the project's doc-RAG (`devvit_search`) — authoritative, hybrid search; avoids re-deriving constraints.
- **Propose new project skill `devvit-parlor`** (gstack/AIDE): encodes the constraint table, the LLM-allowlist gotcha, the `Case` schema, NPC-harness conventions, and the compliance checklist — so every future agent session is grounded. This is the "fat skill" the build-time agents consult.
- Skills consulted this session: `office-hours` (workflow), `plan-mode-skill-audit` (this section).

---

## Premises (confirm before build)
1. **The game lives in its own subreddit = a curated case-library;** the daily "Case of the Day" **rotates from the pool** (AI-seeded + community-authored). v1 = daily case + async-social (leaderboard/streaks/comments). **Endless mode, multi-NPC confrontations, realtime co-op are stretch.** — agree?
2. **Generation: procedural skeleton = solvability truth, LLM = voice in v1;** LLM-drafts-typed-structure is stretch. — agree?
3. **Engine = Phaser + React**, with the **Deduction Board as the hero Phaser mechanic** (targets the $5k). — agree?
4. **LLM = Gemini Flash default** (swappable to OpenAI); **paid key + billing cap for the public demo** (not free tier). — agree?
5. **UGC = in-app Case Forge (broad), MCP authoring as a stretch differentiator**, every case through the PII + moderation + solvability + mod-approval gate. — agree?
6. **Evals (large synthetic corpus) release-gate every build; prompt-optimization is the shipping optimizer; GRPO is off-critical-path research** (never on Reddit data). — agree?
7. **Submit the thin loop by ~Day 6–7, budget two review cycles**, keep a procedural-only fallback build always submittable. — agree?

---

## Risks & mitigations
- **App-review latency + rejection** → submit thin loop ~Day 6–7; budget **two** cycles; always keep a procedural-only, no-premium-fetch fallback build that's submittable.
- **Validator/solver is the hidden long pole** → front-load it in Phase 0 with a known-answer test corpus; solvability is structural (typed vocabulary), never semantic over free text.
- **Case incoherence** → procedural skeleton solvable by construction; LLM never invents logic in v1.
- **Public-judging reliability (rate limits, not $)** → paid key + cap, per-user rate-limit, Redis-cache chip answers (zero-LLM retrieval), graceful degradation so the demo never hard-fails for judges.
- **Killer-ID leak / prompt-injection** → never place `killerId` in any NPC prompt except via deflection rules; adversarial leak tests in the playtester sweep.
- **Content-rule rejection (free-form text)** → chips + bounded text + moderation endpoint + deletion triggers (Post/Comment/Account) + ToS/Privacy + Redis ≤30-day expiry.
- **UGC abuse / PII in community cases** → every authored case (Case Forge + MCP) passes the ingestion gate (PII scrub → moderation → solvability validator → mod-approval) before it can rotate; empty pool risk mitigated by an AI-seeded library so daily rotation never starves.
- **Compliance: no training on Reddit data** → GRPO/RFT/prompt-opt and the eval corpus use synthetic, self-generated data only; never player content.
- **Overscope (confrontations / endless / realtime / UGC / fine-tuning)** → all explicitly behind "only if ahead" flags; the daily loop is the spine.

---

## Verification / "done" criteria
- **Solvability:** playtester agents solve N random seeds end-to-end; validator rejects 100% of unsolvable drafts (unit tests over seeds).
- **Loop:** local `npm run dev` playtest — generate case → interrogate → discover clues → accuse → win/lose → leaderboard + streak update.
- **Daily flywheel:** scheduler creates a fresh post; leaderboard resets per case; streak increments across days (UTC post-date logic).
- **Compliance:** compliance-agent + manual pass on rules (LLM allowlist, deletions, IP, ToS/privacy, README fetch domains) green before each submission.
- **Onboarding:** a first-timer completes a guided first case without external help (watch someone play, don't coach).
- **Reliability:** under simulated concurrent load, rate-limited requests degrade gracefully (cached/canned answer), never a hard error; `killerId` never leaks under adversarial prompts (eval test passes).
- **Eval gate:** no build is submitted/resubmitted unless the eval harness is green (solvability, persona consistency, leak resistance, latency, cost).
- **Mobile:** fits viewport, immediate CTA on first screen, touch-friendly.
- **Demo:** public post in a demo subreddit is self-explanatory and playable by a first-timer.

---

## The assignment (next concrete action)
Before writing app code: **scaffold the Phaser template, add the Devvit MCP, and commit `CLAUDE.md` + `docs/devvit-constraints.md`** so the constraints are encoded in the repo from commit #1 — then front-load the **validator + test corpus** and build the Phase-1 thin reviewable loop on top.

---

## Adversarial review (this session)
Plan was reviewed by an independent fresh-context agent (5 dimensions). Initial score **6.5/10**; the three top fixes were incorporated: (1) inverted the generation trust model to *structural* solvability (procedural spine, LLM voice; LLM-drafts-structure → stretch); (2) de-loaded Phase 1 and decoupled it from the review submission, budgeting two review cycles + a procedural-only fallback build; (3) added a first-class public-reliability workstream (paid key+cap, rate-limit, chip-answer caching, graceful degradation, killer-leak/jailbreak tests) plus onboarding, retention analytics, and a validator test corpus.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |

**VERDICT:** NO FORMAL REVIEWS YET — one inline adversarial review run (6.5→fixes applied). Run `/autoplan` for the full review pipeline, or `/plan-eng-review` to harden the validator/generator architecture before building.
