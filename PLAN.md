# Parlor — Living Design Document (north-star for agent reference)

> **Purpose.** This is the durable, long-running design doc for *Parlor* — a daily AI murder-mystery on Reddit (Devvit Web). It is the single ground truth that build-time agents refer to. It is layered on purpose: **(L1) general design overview → (L2) tech & system design constraints → (L3) component decomposition (the parallel work units) → (L4) orchestration**. Agents read L1–L2 for context, then their component in L3, then the shared contract.
> **Status:** living draft. Working codename **"Parlor"** (final, original name TBD — no Reddit/3rd-party IP).
> **Tiers used throughout:** `[SPINE]` = v1 critical path · `[STRETCH]` = only if ahead · `[RESEARCH]` = off the shipping path, never gates a build.
> **Reviewed this session** by 3 independent agents (Eng 6.5/10, Design 5.5/10, CEO 3.5→6.5/10). Their findings are folded into the relevant sections and summarized in Appendix A.

---

# L1 — General Design Overview (the vision)

## What Parlor is
A murder mystery where the killer hides among **LLM-driven NPCs** with distinct personalities, secrets, and relationships. The player explores a **populous map of 10–50 talkable NPCs**, interrogates them, assembles clues, and names the killer. Crucially, **most NPCs are witnesses/bystanders, not suspects** — the *deduction set* stays small (≤8 suspects) so the case is provably solvable, while the broader cast makes the world feel alive and supplies corroboration, misdirection, and flavor. It lives in **its own subreddit that doubles as a community case-library**.

## The core insight (why it can win)
A murder mystery is inherently **one-and-done** — which directly opposes the hackathon's #1 judged metric, **day-over-day retention**. Reddit's own community-games guidance says winners run a **content flywheel** (daily scheduled content *or* UGC). So Parlor is **"Wordle for whodunnits"**: a fresh **Case of the Day** the whole subreddit plays together, with a fair daily leaderboard, streaks, and theory comments.

**Anti-spoiler via per-player randomized instances (load-bearing).** Everyone plays the same daily **template** (shared setting, cast roster, victim, art, theme) — but each player gets a **uniquely-randomized, validator-proven-unique *instance*** seeded by `(daily, playerId)`: the **killer, means/opportunity, item placement, and story/relationship events are randomized**, all still resolving to **exactly one solvable killer among the NPCs**. So the subreddit becomes a place to **share method and devise hints to catch the killer** ("check the 9pm alibi gap", "the poisoned glass matters") — but **the answer can never be spoiled**, because your butler isn't my butler. The leaderboard therefore ranks **efficiency** (accuracy/speed/fewest-questions on *your* instance), which is comparable across instances and unspoilable.

## The core loop
`explore → interrogate → deduce (Deduction Board) → accuse → resolve → return tomorrow`

## The hook (the memorable, demoable moment)
Not "a daily mystery" (that's the *structure*). The **hook** is the 10-second moment a judge re-tells: **a suspect physically "tells" when they lie** (sweat, averted gaze) and the **Deduction Board** where you link clues with red string until the case snaps shut — capped by a **spoiler-free shareable verdict card** ("🕵️ Parlor #142 · solved in 6 questions · 🔥4"), Wordle's colored-grid equivalent. *Lead every surface — demo post, README, video — with this.*

## Retention thesis & the cold-start reality
- **Levers (all Redis-backed):** daily fresh case, daily leaderboard, streaks (+freeze grace), flair/badges, spoiler-safe "share your verdict", subscribe.
- **The hard truth (CEO review):** retention is measured on a *population you don't have on day 1*. Two non-negotiables follow: **(a) the game must be fully satisfying single-player** — every lever works at N=1 (personal stats, "yesterday's solution — *your* instance — revealed", tomorrow tease); **(b) seeding the first ~50 players is a real workstream** (r/Devvit + Discord; a single demo subreddit). The **judges are the guaranteed cohort** — design a reason for a Tuesday player to return Wednesday.

## Award strategy
Design *only* for the two prizes you can directly engineer; treat the rest as fallout. Of 7 buckets only **Best Use of Phaser** is engine-locked → **Phaser + React, locked.**

| Prize | $ | Hook | Priority |
|---|---|---|---|
| Best App with a Hook | 15,000 | Daily loop + the lying-tell/Deduction-Board moment | **Design for** |
| Best Use of Phaser | 5,000 | Deduction Board (hero) + NPC tells + spatial discovery | **Design for** |
| Best Use of Retention | 3,000 | Daily case, streaks, leaderboard, flair, comments | Fallout |
| Best Use of User Contributions | 3,000 | Theory comments + verdict cards (v1); Case Forge `[STRETCH]` | Fallout |
| Honorable Mentions ×10 | 1,000 | Polish, identity, mobile feel | Fallout |
| Devvit Helper ×6 / Feedback | 500 / 200 | Non-code: be active in r/Devvit + Discord; survey | Free |

---

# L2 — Tech & System Design (requirements + constraints)

## Platform constraints (load-bearing — verified in Devvit docs)
| Constraint | Consequence |
|---|---|
| **Approved runtime LLMs = ONLY OpenAI + Google Gemini.** Claude/Llama/self-hosted denied. | NPCs run on Gemini/OpenAI. Claude *builds* the app, never serves it. |
| **LLM + HTTP fetch are "premium" → ~1 wk app review; re-submit each publish.** | **Schedule risk #1.** Start the review clock with the thinnest possible build (see L4). |
| **Storage = Redis only**, siloed per-subreddit install. No Postgres/pgvector/external DB in-process. 2KB **per *setting*** (not per Redis value). | All game state in Redis. External stores reachable *only* via allow-listed HTTPS fetch (= the stretch external-service slot). |
| **Realtime supported** but server-authoritative (lobby+netcode). | Co-op = `[STRETCH]`. |
| **Scheduler:** cron via `devvit.json`, ≤10 jobs/install. | Daily Case-of-the-Day post is trivial/reliable. |
| **"Avoid free-form text inputs"**; moderate UGC; honor deletions; **expire ALL Redis keys ≤30 days**. | Interrogation = chips + bounded free-text through moderation; deletion triggers wired; TTLs on every key class. |
| **Serverless: 30s/request, 4MB/10MB payloads; per-token cost; localStorage wipes on update.** | Generate the case **once/day** (scheduler), not per-message. Every player-facing LLM path is **single-call**. |
| **Engines React/Three.js/Phaser first-class; Unity = WebGL risk.** | Phaser + React. |
| **No Reddit IP; original; no off-platform linking.** | Original art + name. |

## Architectural principles (the invariants every agent honors)
1. **Solvability is STRUCTURAL, never semantic.** The case's logical skeleton is typed data over a closed clue vocabulary; the validator runs on structure. LLM free text is confined to flavor/voice the validator never inspects.
2. **The server is authoritative; the LLM is untrusted prose.** All control data (`revealedClueIds`, clue unlocks, win/lose) is **computed server-side** from the retrieved slice — never parsed out of an LLM reply. Eliminates the malformed-JSON bug class and the killer-leak channel.
3. **Fat persona / thin harness.** Personality is pure JSON data slotted into one generic harness; adding a character never touches harness code. (A *maintainability* pattern — correctness comes from principle 2.)
4. **Free-first, buy-don't-build** (see tool table) — **prefer free tiers and free/open tools** for anything that isn't the differentiated core; reach for paid only when a free option *demonstrably* fails (e.g., judging-day rate limits), and even then bound it with a billing cap.
5. **Single source of truth = the `Case` contract.** Underspecify it and the parallel build generates the tech debt it's trying to avoid.

## Free-first tool decisions (buy-don't-build, but free wherever possible)
| Need | Decision | Cost | Rationale |
|---|---|---|---|
| In-game storage | **Devvit-managed Redis** | **Free** (included w/ Devvit) | Already managed; you operate nothing. Only in-platform option. |
| Runtime LLM (generation) | **Gemini Flash — free tier** (default); OpenAI = swap | **Free tier** (paid key + cap only as judging-day fallback) | Generous free tier → lowest cost. Pre-rendered chip answers (C5) keep most traffic *off* the LLM so the free tier is viable; escalate to paid only if rate-limited live. |
| Content moderation | **OpenAI moderation endpoint** (allow-listed) | **Free** | Don't build a classifier. *(OpenAI dependency even on the Gemini path → ship both keys; moderation stays free regardless.)* |
| Devvit docs grounding | **Devvit MCP** (`devvit_search`, `devvit_logs`) | **Free** | Don't build a docs-RAG. |
| PII scrub | Regex + LLM pass (reuse the free-tier LLM) | **Free** | Cheap; no infra; no extra paid API. |
| Art generation | **Free/open image models via MCP** (see Asset pipeline below) | **Free** | SDXL/FLUX-klein through open-source asset MCP servers; details below. |
| Offline eval vectors `[RESEARCH]` | **Embedded LanceDB / Chroma** + free/local embeddings | **Free** (open-source, zero server) | Beats hosted Qdrant/Pinecone on both cost and infra. Only if eval track is pursued. |
| External library `[STRETCH]` | **Supabase — free tier** (over self-hosted OpenSearch) | **Free tier** | Managed + free tier. Stretch only. |
| **NOT adopted** | Neo4j, Elasticsearch, hosted/paid vector DBs in v1 | — | The structural design engineered away semantic/graph retrieval; adopting them is net time *loss* (integration + allow-list review + maintenance) **and** unnecessary cost. |

## Asset generation pipeline (models + MCP — free-first)
Parlor is 2D Phaser, so the pipeline is **image-centric**, driven through MCP servers so the build-time art agent (C13) generates content in-workflow. **The hard requirement is character consistency across emotion states** — the same suspect must render calm vs. sweating/averted-gaze for the lying "tells" (C10). Solve with a **locked seed + per-character LoRA / IP-Adapter / ControlNet**, generating emotion variants from one base portrait.

**Models (named, free/open):**
- **SDXL 1.0** — *workhorse* for stylized suspect portraits, sprite sheets, clue cards, UI. Best LoRA/ControlNet ecosystem for style-locked, consistent characters; lowest VRAM (~6–8 GB). Free/open.
- **FLUX.2 [klein] 4B** (Apache-2.0, Jan 2026) or **Z-Image Turbo** — fast, higher-fidelity backgrounds/scene art when SDXL's realism falls short. Free/open.
- **Qwen-Image** — only if text-must-render-inside-an-image; prefer overlaying text in-engine instead.

**MCP servers (named, open-source preferred):**
- **`game-asset-mcp`** (MubarakHAlketbi) — open-source; 2D pixel/sprite art + (optional) 3D via Hugging Face models. Primary free pipeline.
- **AutoSprite MCP** — sprite-sheet generation + animation, works with Claude Code; use if its free tier covers the suspect emotion sheets.
- **`blender-mcp`** (ahujasid) — open-source; `[STRETCH]` for any 3D props/cork-board, with **Poly Haven** free HDRIs/textures/models built in.
- *Paid, noted-not-adopted:* Ludo.ai API/MCP (production sprites/animation) — only if free options can't hit the style bar.

**Decision to lock:** generation runs **via the open-source `game-asset-mcp` (+ AutoSprite for animation)** on **SDXL (style-locked) + FLUX.2-klein (backgrounds)**, to the locked **"Lamplight Noir" style guide** (see Visual identity below), with tells as IP-Adapter+ControlNet deltas off each NPC's base portrait and an anti-slop review pass. 3D (Blender MCP) stays stretch.

## Visual identity, legibility & first-run density (design-review criticals — palette-agnostic)
Three high-leverage design rules that hold under any art direction:
- **Lock ONE visual signature = the red string** (design-review). Make the red-string crimson the **only fully-saturated red in the entire game**, carried across app icon, board, **verdict card**, and feed card. The verdict card becomes a tiny spoiler-safe red-string *web* whose shape is the brag — **this is Parlor's "green grid."** Motion reinforces it: the string **snaps taut** on a valid link (haptic + dust puff), and a one-frame crimson **tell-pulse** marks a lie — both Phaser-trivial, both demoable in <10s.
- **Tell-legibility is a protected layer (design-review).** A lying tell is a 2–4px signal on a 64–96px face, one-handed, in-feed. Tells must render with **high local face contrast, clean un-textured skin fill, iconographic/exaggerated states, plus a non-color reinforcement** (edge-pulse/micro-icon) so they survive glare *and* color-blindness. The scene's key light points at the face in focus.
- **Density is peeled, not faced (progressive disclosure, design-review).** First 8s drop into **ONE lit NPC** (crowd dimmed); make the `principal/supporting/ambient` tiers **visually legible** (sharp+lit vs. soft-focus background) so the eye is told who matters; interactables glow only in-zone; the **board unlocks after the first clue** (never an empty corkboard); social overlay stays post-completion. 50 NPCs become a world you explore, not a wall you hit.

**Art direction (LOCKED): "Lamplight Noir" + bounded occult accent (hybrid).**
- **Palette (6+1, locked):** teal-charcoal `#1B2A2E` / slate `#24343A` rooms · lamp-amber `#E8B86D` / ember `#C97B43` key light · near-black ink `#0E1518` · aged-paper `#E9DEC9` UI · **reserved crimson `#D4322A` for the red string + lie-tell ONLY** (the reservation is what makes the screenshot ownable). Every load-bearing state also carries shape/icon/motion, not color alone.
- **Line/shading:** confident ink linework + flat painterly fills, one occlusion shadow + one warm rim; no photorealism (anti-slop + consistency in one). One warm key light per scene, aimed at the face/interactable in focus — **the lighting rule IS the legibility rule.**
- **Occult accent (the hybrid):** Lovecraftian lives in **story content, not the art system** — occasional "séance" cases use eldritch motifs as narrative + red herrings, rendered in the *same* locked palette/line. Earns unique-identity points without breaking tone, mobile legibility, or pipeline consistency.
- **Consistency technique (on the named free stack):** one base portrait per NPC at locked seed via SDXL + a single project-wide **style LoRA**; generate emotion/tell states as **IP-Adapter (face) + ControlNet (expression) deltas off the base** (not re-rolls — identity holds, only the tell changes); FLUX-klein backgrounds palette-graded to match; fast human line-cleanup pass + per-asset anti-slop checklist.

## The `Case` contract — the central interface (`src/shared/case.ts`)
> **Write this as a real deduction model FIRST, before the generator.** If you can't hand-author 3–4 solvable cases directly in the type, the type is wrong. This is the highest-leverage artifact in the project.

Deduction model = **boolean `means × opportunity` per suspect**. Killer = the unique suspect for whom both hold and stay unrefuted; **every innocent has at least one player-reachable refuter clue.**

```
Case {
  seed, setting, victim,
  map: { zones: [ Zone ], navGrid },        // coordinate world; zones carry semantic tags
  npcs: [{ id, persona, tier, homeZone, routine, knowledgeSlice }],  // 10–50 — the whole cast
  suspectIds: [ npcId ],     // ≤8 — the deduction set; killerId ∈ suspectIds
  killerId,
  facts: [ Fact ],          // typed, the deduction substrate (single source — slices REFERENCE these)
  items: [ Item ],          // interactable world objects (drinks/food/trash/effects) — a clue channel
  clues: [{ id, revealsFactIds, location, unlockedBy: Precondition }],
  relationships: graph,     // mark FLAVOR unless it gates reachability
  solution: { killerId, supportingClueIds }   // what validators prove against
}
tier = 'principal'   // suspects + key witnesses → full LLM harness, pre-rendered chips
     | 'supporting'  // minor witnesses → limited chips, fewer facts
     | 'ambient'     // flavor crowd → canned/templated barks, NO LLM at runtime
knowledgeSlice = [ { factId, statedAs:'true'|'statedLie' } ]  // projection; HOW each NPC states a shared fact is per-entry (killer lies here) → redundancy=0 on value
Zone = { id, name, bounds/coords, tags: ['kitchen','servants',...], mood }  // map FEEDS generation
routine = [ { zoneId, fromTick, toTick, activity } ]   // schedule → seeded ambient life
Item = { id, kind:'drink'|'food'|'trash'|'effect'|..., zone, coords,
         examineText,            // pre-rendered Disco-style description (zero runtime LLM)
         revealsFactIds,         // examining/collecting unlocks these facts
         presentReactions: [ { npcId, revealsFactIds } ] }  // show evidence → NPC reaction/contradiction
Precondition = clueId | enterZone | askTopic | inspectItem | presentItemTo(npcId)  // typed, ACYCLIC
Fact {                      // discriminated union over a CLOSED vocabulary
  subject: suspectId,
  predicate: 'means'|'opportunity'|'alibi'|'sawAt'|...,
  value,
  sourceClueId?
}   // the fact is the single source of VALUE; truthfulness lives on the slice entry (below)
```
*(`Precondition` — the reachability gate on each clue — is defined under the `Item` block above; the validator enforces it is acyclic.)*
Killer lies are **pre-baked as `statedLie` slice-entries in the killer's own slice**, so the harness renders the killer exactly like any innocent and **never knows who the killer is**.

**Contract invariants to PIN before C1 is frozen (eng-review H-4):** named portable PRNG (mulberry32) for all seeded generation/motion · **`seed = (dailyTemplateSeed, playerInstanceSeed)`** — template fixes shared prose/cast/art; instance randomizes killer/means/item-placement/events to **one** validator-proven-unique solution · `navGrid` cell-size + origin + units (so generation, pathfinding, and item/NPC coords agree) · `tick` semantics (rate, `tick 0` origin, boundary/overlap resolution) · **`suspectIds ⊆ principal` tier** (the killer must always get the full harness/tells) · `presentReactions` keyed by `(itemId, npcId)` with defined idempotency + null-reaction semantics · `zone` is authoritative over `coords` for reachability · a typed `gating: bool` marker on each `relationships` edge (flavor vs. deduction-gating).

## NPC population model (the maintainability/redundancy core)
> **v1 targets a lean cast (~10–15 NPCs), scaling toward 50** once onboarding + the generation-pool pipeline are proven — lowers first-run overwhelm and keeps daily generation comfortably in budget (both reviews' top risk). The architecture supports 10–50 unchanged; only the per-case count changes.

A populous map is only affordable if NPCs are **pure data over one shared substrate**, never duplicated logic or facts. Three rules:
1. **Suspects ≠ NPCs.** `suspectIds` (≤8) is the deduction set the validator/blind-solver enumerate over — *solvability cost is unchanged by map size*. The other 10–42 NPCs are witnesses/bystanders: they dispense corroboration, red herrings, and flavor, and **can never be the killer**.
2. **Fidelity tiers bound cost & code paths** (reliability under the free-tier LLM). The **only runtime LLM call is principal free-text rephrase** (eng-review H-1): `principal` (≤8) get the full harness, with **all chips pre-rendered**; `supporting` get a **fully pre-rendered** bounded chip set (**zero** runtime LLM); `ambient` get **templated barks** (zero LLM). Plus a **per-player + per-install runtime-LLM budget** (RPM/token counter in Redis) with deterministic canned degradation when exceeded — because cost is driven by *concurrent player messages*, not NPC count. So even a curious player hammering 50 NPCs adds ~zero live calls beyond their own free-text.
3. **Knowledge slices are projections, not copies.** A slice = a list of `factId` references into the single `facts[]` array. One fact ("Vane had no alibi at 9pm") is authored once and *viewed* by every NPC who knows it → cross-NPC consistency is automatic, and there is **no redundant fact storage to drift**. One harness (C5) serves all tiers; adding an NPC is adding a data row, never code.

## NPC memory & runtime reactivity (static story + dynamic memory)
NPCs have **two knowledge layers**: a pregenerated story spine *and* a live memory of what the player does — so the world reacts without breaking solvability or the free-tier budget.
- **Static (in `Case`, pregenerated):** the `relationships` graph + backstory `facts`/events structure the story. This is fixed and validated.
- **Dynamic (runtime, per-player, in C6):** a bounded log of **typed player-action events** (`tookItem`, `presentedItem`, `accusedNpc`, `enteredZone`, `askedTopic`, `caughtInLie`) that an NPC has come to *know*.
- **Knowledge is perception-gated (must make sense).** An NPC learns a world-event ONLY if it could actually perceive it: (a) **witnessed** — co-located + **line-of-sight** in the zone at that tick, computed from the **integer-pure `f(seed,tick)` position model** (direct reuse — no new state); (b) **told/shown** — the player addressed or presented to them; (c) **gossip** `[STRETCH]` — bounded propagation along `relationships` (v1 = off). **Canonical case: taking an item is known only to NPCs who saw you take it** — pocket the spoon unseen and it stays secret (and the unseen item becomes your "gotcha" evidence later). No omniscient NPCs.
- **Conversational memory is per-`(player, NPC)`.** Each NPC remembers **its own dialogue history with this player** (the persisted transcript) and stays consistent with it across the session; it does **not** know what the player discussed with *other* NPCs (unless the gossip stretch is on). This is naturally bounded (one NPC's own conversation) and reliable.
- **Bounded injection (single-call safe):** only the **principal free-text path** receives a **recency/relevance-ranked, capped** set of known memory events as structured context; `supporting` get templated acknowledgment, `ambient` none. Keeps the live LLM prompt bounded.
- **Reactions are pre-authored where they matter:** presented-item reactions = `presentReactions` (already pre-rendered); accusation/disposition shifts = **templated stance changes** that drive the emotion-FSM/tells. Only nuance is live-rephrased.
- **Solvability is untouched (invariant):** memory changes **disposition, continuity, and tells — never the fixed deduction fact-graph.** Any memory-gated reveal is itself a pre-authored typed clue; the set of derivable facts is unchanged. Memory never carries `killerId`.

## Map, movement & living world (the environment drives the AI)
The map is a **coordinate world**, not a backdrop, and it is a **first-class input to NPC generation and behavior** — so the environment shapes each AI's personality and life cycle.
- **Coordinate map + zones.** Named zones (parlor, kitchen, garden, study…) with bounds and **semantic tags** (`purpose`, `mood`, `who-belongs-here`) over a nav grid.
- **Smooth movement.** Phaser velocity/tween locomotion with **grid pathfinding** (free/open `easystar.js`-style A*). Player taps-to-move; NPCs path to routine waypoints. No teleporting — interpolated motion.
- **Environment → personality & knowledge (generation, C2).** Each NPC's `homeZone` tags **theme its persona**, **seed believable knowledge** (proximity decides what it plausibly witnessed — the gardener saw the garden, not the study), and **assign its routine**. This is the literal "map feeds the AI's personality and life cycle."
- **NPC life cycle = one behavioral FSM over routine data.** `Idle ⇄ Wander ⇄ GoToWaypoint ⇄ Converse ⇄ React`, driven by the `routine` schedule (thin behavior harness / fat routine data). Ambient NPCs **interpolate along precomputed routine paths — they do NOT re-run A* per frame** (50 live A* agents would spike low-end phones). NPCs feel alive without per-NPC code.
- **Determinism is INTEGER-PURE, not float-simulated (eng-review C-1).** The authoritative thing is a **discrete schedule**: NPC logical position is a pure function `f(seed, tick) → gridCell` using a **named integer PRNG (mulberry32/xorshift) over discrete logical ticks (≈4–10 Hz, snapped to a server-broadcast `serverTick`)** — never `Math.random`, `Date.now`, or float accumulation over render `dt`. The smooth Phaser tween between cells is **purely cosmetic and is never read by game logic** (logic only ever asks "which cell is NPC N in at tick T"). So co-op needs only *logical cells* to agree (they do, by integer purity) — **drop any claim that pixel paths are identical across clients.** This keeps single-player cheap and makes 1–12-player netcode tractable (sync players + events, not 50 transforms).

## World interactivity & evidence (Disco-Elysium-style item density)
Clues arrive through **multiple channels over the same `facts` substrate** — so the world feels dense without adding deduction complexity. The map is dotted with **interactable items** (drinks, food, trash, personal effects, furniture): tap to **examine** (a pre-rendered, Disco-Elysium-flavored description) and, where relevant, **collect** into inventory.
- **One discovery pipeline, four channels.** A clue's `unlockedBy` precondition is `askTopic | inspectItem | enterZone | presentItemTo(npc)`. Interrogation, **object examination**, spatial reveal, and evidence-presentation all funnel into the *same* `revealsFactIds` → player knowledge graph. Precise cost (eng-review M-2): **killer-uniqueness enumeration is unchanged by map size**, but item/present edges ARE nodes in the **one reachability graph** the validator + blind solver both traverse — so density is cheap, *not* free, and the validator must prove every innocent's refuter is reachable through that union graph (rejecting item-channel cycles).
- **Present-evidence mechanic (the deduction kicker).** Found the poisoned glass? **Show it to a suspect** → `presentReactions` unlock a fact or expose a contradiction with that NPC's earlier statement (a "gotcha"). This is Ace-Attorney-style confrontation built from pre-authored typed data, not live LLM reasoning (reliable + free-tier-safe).
- **Free-tier discipline.** All `examineText` and `presentReactions` are **pre-rendered at case-generation time** (C2) — zero runtime LLM for world interaction. Red-herring items (flavor-only, `revealsFactIds: []`) add texture cheaply.
- **Maintainability.** Items are pure `Case` data placed by zone; one interaction system (C18) renders all kinds. Adding an item is a data row, never code — same discipline as NPCs.

## Player hypothesis layer & social nominations (the board as shared info-management)
The Deduction Board is also an **information-management tool**: the player **tags each NPC with a hypothesis role** — `suspect | bystander | killer | unknown` — turning a wall of 10–50 NPCs into an organized theory. Two hard rules:
- **Player hypothesis ≠ Case truth.** Nominations live in the **per-player knowledge graph** (C6), never conflated with the ground-truth `suspectIds`/`killerId`. The accusation = the player's `killer` nomination + the supporting-clue chain (drives the deduction-strength meter).
- **Social overlay, spoiler-safe.** When a **friend or lobby-mate nominates the same NPC for the same role**, surface it ("You and Sam both suspect Vane 🔎"). Crowd/friend nominations are shown **only inside a consenting lobby** (co-op) **or post-completion** in the reveal — never to an un-played scroller (preserves the spoiler-safe principle).
- **Gameplay events are metrics.** Nominations + outcomes feed C17. The incrementally-aggregated snapshot produces, per case: **# killer-right · # who *suspected* the killer · # who *didn't*** · **most-nominated killers/suspects** · **% who found each piece of evidence/clue** · multi-dimension leaderboard (accuracy/speed/fewest-questions). This **unifies with retention analytics** (one event backbone — see C17) and powers the spoiler-safe **end-of-game summary slideshow** ("You + 31% caught the butler · only 12% found the torn glove · the crowd's favorite wrong answer was Mrs. Hale") — the social "hive-mind" moment and the shareable card.

## Game-state model (one FSM = the single UI/UX authority)
The UI must accommodate many states without ad-hoc screen flags (a redundancy + bug source). Define **one server-authoritative finite-state machine** the client renders against:
`Loading → Briefing → Exploring ⇄ Dialogue ⇄ Board → Accusing → Resolved → DailyLocked/Returning`
- **`Exploring`** (map + NPCs) and **`Dialogue`** (interrogation) and **`Board`** (deduction) are freely re-enterable; a **persistent next-action HUD** lives above all of them (C8).
- **Multiplayer overlay states** `[STRETCH]`: `Lobby → RoomActive → Spectating`.
- The server owns the authoritative state + each player's knowledge graph; the client is a pure projection. One state enum, one transition table — every screen, guard, and save derives from it.
- **React↔Phaser bridge (eng-review M-4) — a named contract, owned by C8.** The FSM emits *intents*; Phaser scenes (C9/C10) are *subscribers* that mount/unmount and take input focus on transitions, and emit domain events back — **Phaser never owns game state.** C9 and C10 build against this bus, not against each other (closing the unowned seam).

## Single-player v1 + async social (co-op = stretch)
**v1 is single-player — the right call:** it removes netcode + cold-start risk, and it **lends itself to the leaderboard**, where the social layer is *asynchronous crowd comparison* (your accuracy/speed/questions/discoveries vs. everyone who played today's case) surfaced in the end-of-game summary — not live co-presence. Realtime **co-op (1–12 players/room** — shared server-authoritative case, per-player knowledge graphs, 1:1 NPC dialogue, in-room discovery sharing) is **fully `[STRETCH]`**; request the realtime permission only if built.

## Data model (Redis — one-page schema is a Phase-0 deliverable, `docs/redis-schema.md`)
Sorted sets = leaderboards (per `caseId`, TTL). Bitfields = streaks (+freeze; **UTC-rollover logic is spec'd, not assumed**). Hashes/JSON = case + per-player knowledge graph (read via single `HGETALL`/`MGET`, no per-clue round-trips). Store the heavy persona/flavor separately from the compact deduction skeleton so per-message retrieval reads only what it needs. **Every key class has a ≤30-day TTL.**

## Case generation pipeline & budget (eng-review C-2 + per-player instances)
**Template vs. instance is what makes per-player randomization affordable.** The expensive prose (personas, voice, `examineText`) is **pre-rendered ONCE per daily template and shared by all players** — because it does *not* depend on who the killer is. The **per-player instance is a cheap, pure, no-LLM structural draw** seeded by `(daily, playerId)`: re-assign killer + means/opportunity + item placement + which slice-entries are `statedLie` + clue reachability, then **C3 validates uniqueness on the spot** (enumeration over ≤8 suspects is fast). To keep chips zero-runtime-LLM under per-instance lies, pre-render **both the truthful and the deceptive phrasing of each relevant fact per NPC** at template time; the instance just *selects* which applies. Net: unique solvable instance per player at **near-zero extra generation cost**.

The daily generation **must not** be one LLM-heavy 30s request — at scale that's tens-to-hundreds of LLM calls and trips the free-tier RPM. Two phases + a pool:
- **Phase A — structural skeleton:** pure/deterministic, **no LLM**, fast; validated by C3. This is the solvability spine.
- **Phase B — prose pre-render:** a **separate, chunked, fan-out** job (one chunk per N entities, each its own ≤30s request) rendering principal chip answers, `examineText`, `presentReactions`, persona voice — written incrementally to Redis with an **idempotency key per `(caseId, phase, chunk)`** (retries don't double-spend).
- **Pool is the primary path.** Cases are generated **hours/days ahead into the seeded pool**; the daily cron just **picks the next pre-rendered, C3-verified case and posts it** — trivially in budget. Just-in-time generation is the fallback, not the norm.
- **Bounded pre-render volume (stated cap):** ≤~8 principals with chip pre-renders, ≤~20 items with prose; **ambient barks are templated string-interpolation, zero LLM.** Only the post goes live when both phases complete and C3 re-verifies.

## Stack summary
React+Vite shell (Zustand + React Query) · Phaser for the 3 showcase mechanics · Devvit Node serverless (Hono, `@devvit/web/server`) · **one** generation provider for v1 — **Gemini Flash on the free tier by default** (OpenAI = swap; OpenAI moderation free either way) behind a provider interface that abstracts **structured-output parsing + safety-block handling**, key as Devvit secret · art via **free/open image models** to a **locked palette + style guide** + human art-direction pass. All defaults free; paid escalation only if a free option fails live.

---

# L3 — Component Decomposition (parallel work units)

> Each component is an **ownable unit** for one subagent: *responsibility · contract/interface · depends-on · tier*. The dependency edges tell the orchestrator what is parallelizable vs. gated. **Everything depends on C1 (the contract), which is built first and alone.**

| # | Component | Responsibility | Contract / interface | Depends on | Tier |
|---|---|---|---|---|---|
| **C1** | **`Case` contract & vocabulary** | The typed deduction model + closed clue/predicate vocabulary; 3–4 hand-authored example cases | `src/shared/case.ts` (exported types) | — | SPINE (gating) |
| **C2** | **Procedural generator** | `generateCase(seed)` → solvable skeleton (≤8 suspects + means/opportunity + reachable refuters) **plus a 10–50 NPC population** on a **zoned coordinate map**; **environment-driven**: each NPC's `homeZone` tags theme persona, seed proximity-plausible knowledge, and assign a `routine`; **places interactable items** (with pre-rendered `examineText` + dual truthful/deceptive `presentReactions` + red herrings); difficulty band (reject-retry). **Emits the shared daily template AND draws per-player instances** (randomized killer/means/items/events, seeded `(daily,playerId)`) | template (shared prose) + `instance` (structure) | C1 | SPINE |
| **C3** | **Validator + blind solver + corpus** | **Killer-uniqueness enumeration** O(2^≤8) (map-size-independent) **+ reachability/acyclicity over ONE union graph** `{factId, clueId, itemId, zoneId, present-target}` (grows with NPCs/items). The **blind solver shares the SAME reachability engine** (player-surface only, never `solution`). **Validates each per-player instance for unique solvability at session start** (fast, no LLM). Corpus includes reject-cases: item-channel cycle + present-evidence-gated sole refuter | `validate(instance)→bool`, `blindSolve(surface)→suspectId\|ambiguous` (shared traversal) | C1 | SPINE (the long pole — front-load) |
| **C4** | **LLM provider + moderation gateway** | Single-call provider interface; OpenAI moderation; structured-output parsing; safety-block + timeout/canned-degradation handling | `complete(prompt)→text`, `moderate(text)→verdict` | — (parallel w/ C1) | SPINE |
| **C5** | **NPC harness** | ONE harness for all 10–50 NPCs, **fidelity-tiered**: `principal` = slice facts **+ bounded memory context (C19)** → LLM rephrase → **server computes `revealedClueIds`** (chips pre-rendered, zero runtime LLM); `supporting` = pre-rendered chips; `ambient` = templated barks. ≤2-sentence cap | `NPCHarness(npc, slice, memory, transcript, msg)→{reply, revealedClueIds}` | C1, C4, C19 | SPINE |
| **C6** | **Redis data layer** | Leaderboards/streaks/knowledge-graph; TTLs; N+1 discipline; UTC streak logic | typed repo functions per `docs/redis-schema.md` | C1 | SPINE |
| **C7** | **Scheduler / daily rotation** | Cron post creation; rotate Case-of-the-Day from an AI-seeded pool (per-install) | scheduler job in `devvit.json` | C2, C6 | SPINE |
| **C8** | **Client shell + onboarding** | React shell; **owns the game-state FSM** (one transition table, server-authoritative — every screen derives from it); **feed-card-as-hook**; drop straight into one NPC w/ pre-cached first reply; persistent next-action HUD; non-blocking guided first case | game-state enum + transition table | C1 | SPINE |
| **C9** | **Phaser: Deduction Board (HERO)** | **Tap-to-link** (not drag), auto-layout/snap, pinch-zoom + "fit all", ≥44px targets, **auto-populate from interrogation**, **per-NPC role-tagging** (`suspect/bystander/killer/unknown` → emits nomination events), **deduction-strength meter** (killer nomination + supporting clues). *Prototype on a real phone week 1.* | consumes/writes player knowledge graph + nominations | C1, C6 | SPINE |
| **C10** | **Phaser: living world (map, movement, NPC life, tells)** | Coordinate map + zones; **smooth tween locomotion + grid pathfinding** (easystar-style A*); **one NPC behavioral FSM over routine data** (Idle⇄Wander⇄GoTo⇄Converse⇄React) with **seeded-deterministic ambient motion**; emotion-state lying tells; spatial clue discovery (magnifier reveal). *Large — orchestrator may split map/movement from behavior/tells.* | consumes `map`+`routine`+per-fact truthfulness | C1, C5 | SPINE |
| **C11** | **Interrogation UX** | Chips + bounded free-text (moderated); **present-evidence-from-inventory** path (C18); "press further"; clue-collected toasts; asked-chip graying; in-character "thinking" tell during latency | uses C5, C18 | C5, C8, C18 | SPINE |
| **C12** | **Resolution + summary card** | Win/lose as a **reveal** (walk the clue chain) + countdown; then an **end-of-game slideshow / "Parlor Wrapped" summary card** sequencing crowd gameplay metrics from C17 — **% who found each piece of evidence** ("only 12% found the torn glove"), your multi-dimension rank (accuracy/speed/#questions), killer-right %, most-nominated wrong answer, streak; **spoiler-safe + shareable** (the verdict card). Surfaced at the emotional peak | uses C6, C17 | C6, C8, C17 | SPINE |
| **C13** | **Asset generation** | Sprites/portraits (w/ per-character emotion sets)/board/UI via `game-asset-mcp`+AutoSprite on SDXL/FLUX-klein to the locked style guide; consistency via seed+LoRA/ControlNet; anti-slop pass | style spec + emotion-state list (feeds C10) | C1 | SPINE |
| **C14** | **UGC: Case Forge + ingestion gate** | In-app authoring → PII scrub → moderation → **structural validation (C3)** → mod-approval queue → rotation; deletion triggers | reuses C3, C4, C6 | C3, C4, C6 | STRETCH (defer until players exist) |
| **C15** | **Offline eval harness + corpus** | Synthetic-only corpus; scores PII/moderation/solvability/leak/persona/latency/cost; **v1 = thin hand-run script** (~10–20 seeds: solvable + killerId-never-leaks) | runs outside Devvit | C2, C3, C5 | RESEARCH (v1: thin script only; never a release gate) |
| **C16** | **Compliance + submission** | Devvit-rules audit before each (re)submit; ToS/Privacy; README "Fetch Domains"; deletion + 30-day expiry checks | checklist | all | SPINE |
| **C17** | **Event log & daily gameplay metrics** | **TWO stores (eng-review H-3):** (a) **live per-`(caseId,playerId)` state** — nominations (overwritten on re-tag) + outcome (solved?/time/#questions/#NPCs talked/items examined) — attributable, **deletable**; (b) **aggregate counters** incremented as events happen (`HINCRBY`/`ZINCRBY`): killer-right / suspected / didn't-suspect, most-nominated killer+suspect rankings, **% who found each clue (normalized by clue-ROLE across instances, since placement is per-player)**, multi-dimension leaderboard (accuracy/speed/fewest-questions — instance-independent, so fair + unspoilable). "Daily compile" = a near-no-op **snapshot** of these counters. Optional analytics stream **anonymized-at-write + TTL'd**. Debounced; ≤30-day TTL | `logEvent()`, `snapshotDailyStats(caseId)→Stats` | C6, C7 | SPINE |
| **C18** | **Interactable items & evidence system** | One interaction system for all item kinds (drinks/food/trash/effects): **examine** (pre-rendered Disco-style text) → unlock facts; **collect** → inventory (player knowledge graph); **present-to-NPC** → `presentReactions` (contradictions/"gotchas"). Items are a clue channel via `inspectItem`/`presentItemTo` preconditions | `examine(itemId)`, `present(itemId,npcId)` | C1, C5, C6 | SPINE |
| **C19** | **NPC memory & event visibility** | Per-player typed-event log (in C6); **perception-gated visibility** (witnessed = co-located + line-of-sight via `f(seed,tick)`, e.g. item-take seen only by present NPCs / told-or-shown; gossip = stretch) + **per-`(player,NPC)` conversation memory**; assembles the **bounded, ranked memory context** for the principal free-text path + templated disposition shifts driving tells. Never alters the fact-graph; never carries `killerId` | `noteAction(evt)`, `memoryContext(npcId,playerId)→ranked[]` | C1, C6, C10 | SPINE |

**Explicitly deferred / cut from v1:** GRPO weight-RL `[RESEARCH]`, hosted RFT/SFT `[STRETCH]`, GEPA/DSPy prompt-optimization loop (hand-tune from transcripts instead), MCP→Supabase authoring relay `[STRETCH]`, endless mode `[STRETCH]`, realtime co-op (1–12 players/room, see Multiplayer sizing) `[STRETCH]`, multi-NPC confrontations `[STRETCH]` (when built: **incremental client-polled turns**, never one blocking 30s request), cross-subreddit global leaderboard.

---

# L4 — Build sequencing & orchestration

## Review-latency-aware submission (schedule risk #1)
**Decouple the review-clock start from the generator.** The first reviewable build needs only **one hand-authored case** end-to-end through the LLM — *not* C2/C3. Submit that **as early as possible (~Day 3–4)** to start the ~1-week clock; build C2/C3 *during* review latency. Always keep a **procedural-only, no-premium-fetch fallback build** that's submittable. Budget two review cycles.

## Build-time agent harnesses (each implementation agent is wrapped, not raw)
Mirror the runtime philosophy — **fat skill / thin harness** — for the *build* agents. Every implementation agent (the C2–C16 owners) runs inside a **custom harness** that injects context and guards against common agentic-code failure modes, so agents optimize for edge cases instead of the happy path.

**The harness gives every agent (shared scaffold):**
- **Context injection:** its component spec (L3 row), the **`Case` contract (C1)**, the L2 constraints table + architectural invariants, and the **free-first / buy-don't-build** rules — so it never re-derives or violates ground truth.
- **Grounding tools, not memory:** the **Devvit MCP** (`devvit_search`/`devvit_logs`) is mandatory for any Devvit API — **no inventing/hallucinating platform APIs**; verify against docs. (Asset agent C13 → the asset MCP servers.)
- **A per-component edge-case + failure-mode checklist** the agent must address, e.g. C5: malformed/empty LLM output, killer-leak, slice-miss; C6: N+1, missing TTL, UTC streak rollover; C9: fat-finger/overflow/zoom on mobile; C7: scheduler retry/idempotency; C12: loss-state + spoiler-safe gating.
- **A deterministic verification gate (anti-"fabricated success"):** the agent must run **typecheck + the fast deterministic CI** (C3 validator/blind solver, fakeredis, snapshot/seed-determinism tests) and the **end-to-end `generate→interrogate→accuse` integration test** before declaring done — green output is the proof, not its own assertion. No partial edits left uncompiled.
- **A structured return contract:** `{ filesChanged, testsRun+results, contractDeltas, openQuestions, assumptions }` back to the orchestrator — surfacing assumptions instead of silently guessing.
- **Isolation:** file-mutating agents run in **worktrees** to avoid parallel collisions; the contract (C1) is frozen before Wave 1 so agents can't diverge on it.

This is itself a reusable artifact: the proposed **`devvit-parlor` skill** encodes the constraint table, the `Case` schema, the invariants, and these checklists, so every agent session is grounded the same way.

## Wave model (the orchestrator dispatches these)
- **Wave 0 — Foundation (sequential, gating):** **C1** (contract + hand-authored cases) → scaffold + `devvit.json` + `docs/redis-schema.md` + Devvit MCP. Plus the **thin reviewable loop** (one hand case + C4 + minimal C8/C11) to start the review clock. *Nothing parallel starts until C1 is green.*
- **Wave 1 — Build (parallel, after C1):** C2, C3, C5, C6, C7, C8, C9, C10, C11, C12, C13 — each its own subagent (worktree isolation for file-mutating agents). **Gate:** an end-to-end `generate→interrogate→accuse` integration test must pass before any Wave-1 agent is "done," or the parallel work won't compose.
- **Wave 2 — Verify & harden (parallel):** adversarial code-review (prompt-injection / killer-leak / malformed-JSON / empty+error states), latency/perf (Redis N+1, 30s budget, Phaser mobile FPS), maintainability (contract adherence, dead code), **deterministic** solvability sweep via C3's blind solver, compliance (C16).
- **Wave 3 — Synthesis:** orchestrator triages findings into fix waves; re-run until green. Gate each submission on the thin safety script, not a heavy eval harness.
- **Stretch waves (only if ahead):** C14, then `[STRETCH]`/`[RESEARCH]` items.

## Testing posture (maintainability mandate)
Split **fast deterministic CI** (C3 validator + blind solver, C6 via fakeredis, seeded-determinism: same seed → byte-identical skeleton, `Case` snapshot tests) from the **slow LLM checks** (dialogue quality, jailbreak vibes) which gate *submission*, not every commit.

---

# L5 — Agent enablement: guardrails, skills, tools, MCP (every agent)

So the fleet can **build *and* autonomously maintain** the live game, all agents — implementation, verification, and maintenance — share one baseline, encoded once in the **`devvit-parlor` project skill** + repo `CLAUDE.md` and injected by the build-time harness (L4). No agent runs raw.

## Shared baseline — every agent, no exceptions
**Guardrails (hard rules):**
- *Compliance:* runtime LLM = **OpenAI/Gemini only**; **never train/tune on Reddit data**; chips + bounded-text + moderation for user input; honor Post/Comment/Account **deletions**; **≤30-day TTL on every Redis key**; **no Reddit IP**; ToS/Privacy + README fetch-domains current.
- *Architecture invariants:* structural (not semantic) solvability; **server-authoritative facts** (LLM = untrusted prose); **`killerId` never in any prompt**; single-call LLM paths; knowledge slices are **projections, not copies**; one harness/data-driven NPCs & items; **free-first** tooling.
- *Process:* **ground via MCP, not memory** (no hallucinated Devvit APIs); **verify before "done"** (typecheck + fast deterministic CI + the e2e `generate→interrogate→accuse` test); no partial/uncompiled edits; **worktree isolation** for parallel file mutation; structured return `{filesChanged, testsRun+results, contractDeltas, openQuestions, assumptions}`; surface assumptions, don't silently guess.

**Tools (every agent):** Read · Grep · Glob · Edit/Write · Bash (test runner, typecheck, lint, `devvit` CLI) · the deterministic CI. *(Orchestrator also: Agent/Workflow, Task tools, WebSearch/WebFetch.)*

**MCP (every agent):** **Devvit MCP** (`devvit_search` = doc-RAG, `devvit_logs` = live diagnostics) — mandatory for any platform fact.

**Skills (shared):** **`devvit-parlor`** (fat project skill: constraint table, `Case` schema, invariants, per-component checklists) · `verify` (run the app, observe behavior) · `code-review` · `security-review`.

## Per-role registry (baseline above + these)
| Agent role | Extra skills | Extra MCP / tools | Owns |
|---|---|---|---|
| **Implementation (C2–C18 owners)** | `simplify`, `run` | — | their component + its contract tests |
| **Asset (C13)** | — | **`game-asset-mcp`**, **AutoSprite MCP**, `blender-mcp` (stretch) | art to the style guide |
| **Verification (Wave 2)** | `code-review`, `security-review`, `verify` | `devvit_logs` | adversarial review, leak/jailbreak, perf, compliance |
| **Orchestrator** | `loop` | Agent/Workflow, Task tools | wave dispatch, triage, submission gating |

## Autonomous maintenance agents (ongoing ops — keep the live game healthy)
Scheduled via Devvit cron / the **`loop`** skill, each wrapped in the same harness + guardrails. **Every action is classified `read-only` / `reversible-auto` / `human-gated`; every mutating action writes an audit event (to C17 analytics) with reason + trigger metric, and has hysteresis + cooldown (N failures over M min, max one switch/day) to avoid flapping (eng-review M-1):**
- **Daily-case health monitor** `reversible-auto` — after the scheduler posts: confirm generation, **C3 blind-solver re-verifies solvability**, keys reset. Roll to fallback is **human-gated by default** (detect + alert + stage the action; a human acks) with a defined auto-revert (next pool case validates).
- **Reliability watch** — degrade gracefully (`reversible-auto`); **escalate free→paid is `human-gated`** (alert + ack), never silent, with hysteresis so transient 429s don't thrash keys.
- **Compliance watcher** `read-only`→blocks — re-audit before every publish; watch Devvit rule changes via `devvit_search`; block submission if a guardrail regresses (`security-review` + `code-review`).
- **Metrics/triage agent** `read-only` — read **C17** snapshots + logs → flag balance issues (e.g., a case nobody solved), file fix tasks. Difficulty tuning is **propose-only** in v1 (never auto-apply — one day's stats is noise).
- **Pool steward** `reversible-auto` — keep the seeded pool stocked (per-install); run the eval/playtest sweep over upcoming cases before they rotate live.

# Appendix A — Review synthesis (rationale, this session)

Three independent adversarial reviews. Consensus: *strategy and platform analysis are excellent; the plan was ~1.5× over-scoped for the clock, buried its hook, and asserted rather than designed its hardest component.* Most fixes **remove** work.

- **Engineering (6.5/10):** `case.ts` must be a real deduction model written first; boolean means/opportunity + brute-force enumeration over ≤8 suspects (not a CSP lib); **blind solver = validator-of-the-validator**; server-authoritative control fields; pre-rendered chip answers (resolves cache-cardinality); single-call LLM paths + incremental confrontations; per-fact truthfulness; acyclic typed `unlockedBy`; Redis schema doc; 30-day TTL on all key classes.
- **Design (5.5/10):** the four retention-deciding moments were one sentence each — now specced: first-8-seconds (feed-card-as-hook), interrogation feel (≤2-sentence cap, clue toasts, tells), **mobile Deduction Board (tap-to-link, auto-layout, auto-populate, strength-meter — prototype on phone week 1)**, loss-as-reveal + spoiler-safe sharing; single-player-complete.
- **CEO (3.5→6.5/10):** cold-start/liveness is the real retention risk (seed cohort + single-player-complete + judges-as-cohort); cut the eval/RL/UGC/MCP mass from the critical path; promote the hook; submit thinner/earlier; one provider for v1.

# Appendix B — Risks & mitigations
- **Review latency/rejection** → thinnest LLM build ~Day 3–4; two cycles; procedural-only fallback always submittable.
- **Validator/solver is the long pole** → front-load C3 with known-answer corpus; structural not semantic; blind solver proves uniqueness.
- **Killer-leak / prompt-injection** → harness never knows the killer; lies pre-baked as `statedLie`; server-authoritative `revealedClueIds`; adversarial leak tests.
- **Free-form-text rejection** → chips + bounded text + moderation + deletion triggers + ToS/Privacy + ≤30-day TTLs.
- **Cold start / empty room** → single-player-complete; deliberate seed cohort; judges are the guaranteed cohort.
- **Judging-day reliability** → **free tier first**: pre-rendered chip answers (zero-LLM common path) + per-call timeout + canned degradation keep the free tier viable under load; a paid key + billing cap is held in reserve and switched on *only* if free-tier rate limits actually bite during judging.
- **Subreddit spoils the answer** → **per-player randomized instances** (unique killer/placement/events per `(daily,playerId)`, each validator-proven-unique): the community shares method/hints, never the answer. Leaderboard ranks instance-independent efficiency so it stays fair; difficulty held in a tight band across instances.
- **Parallel-build divergence** → C1 nailed before Wave 1; end-to-end integration test gates "done."
- **No training on Reddit data** → eval corpus/any tuning use synthetic, self-generated data only.

# Appendix C — Verification / "done" criteria
- **Solvability:** C3 blind solver lands the unique `killerId` on N seeds; validator rejects 100% of unsolvable corpus cases (deterministic CI).
- **Loop:** local `npm run dev` — generate → interrogate → discover → accuse → win/lose → leaderboard + streak.
- **Daily flywheel:** scheduler posts a fresh case; leaderboard resets per case; streak increments across UTC days.
- **Onboarding:** a first-timer (a judge) finishes their first case with zero coaching.
- **Reliability:** under simulated load, rate-limited requests degrade gracefully; `killerId` never leaks under adversarial prompts.
- **Mobile:** fits viewport; the Deduction Board is thumb-usable on a real phone; immediate CTA on first screen.
- **Hook:** a spoiler-free verdict card is shareable; the lying-tell moment is demoable in <10s.
- **Compliance:** C16 green before each submission (LLM allowlist, deletions, IP, ToS/privacy, README fetch domains).

# Appendix D — Review round 2 (full-design re-review)
Two independent re-reviews against the evolved design. **Engineering 7.0/10** (up from 6.5), **Design-quality 6.5/10**. Both mostly *de-scoping*. All engineering fixes below are **adopted** into the sections above.

**Engineering — adopted:**
- **Determinism is integer-pure** — NPC logical position = `f(seed, tick)→gridCell` over a named integer PRNG (mulberry32) on discrete ticks; tweens cosmetic and never read by logic; dropped the "identical pixel paths" claim (co-op needs only logical cells to agree). *(C-1 → living-world section, C10.)*
- **Two-phase, pool-primary generation** — structural (no-LLM, in-budget) + chunked prose pre-render with idempotency keys; daily cron just picks a pre-verified pool case; stated pre-render caps. *(C-2 → generation-pipeline section, C2/C7.)*
- **C17 split into two stores** + incremental aggregation (resolves append-only vs anonymized vs attributable vs deletable contradiction). *(H-3.)*
- **One reachability engine** shared by validator + blind solver over the union graph `{fact,clue,item,zone,present-target}`; corpus rejects item-channel cycles + present-gated sole refuters. *(H-2 → C3.)*
- **Only runtime LLM = principal free-text**; supporting chips fully pre-rendered; per-player/install LLM budget. *(H-1.)*
- **Contract pins** (PRNG, navGrid, tick semantics, `suspectIds ⊆ principal`, presentReactions keying, zone>coords, typed relationship `gating`); **`truthfulness` moved to slice-entry** (shared fact stays single source of value). *(H-4, M-3.)*
- **React↔Phaser bridge** named + owned by C8. *(M-4.)* **Maintenance fleet** actions classified read-only/reversible/human-gated with audit + hysteresis; escalate-to-paid & roll-to-fallback human-gated. *(M-1.)*

**Design-quality — adopted (palette-agnostic):** the **red string = the locked signature** ("green grid") across icon/board/verdict-card/feed; **tell-legibility protected layer** (high contrast, non-color reinforcement); **progressive disclosure** for first-run density (one lit NPC → visible tiers → board unlocks after first clue).

**Decisions locked (this round):** art direction = **"Lamplight Noir" + bounded occult accent (hybrid)** — Lovecraftian lives in story/red-herrings, not the art system; **v1 cast = lean ~10–15 NPCs, scaling to 50** once onboarding + generation-pool are proven.
