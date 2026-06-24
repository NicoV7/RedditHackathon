# Devvit platform constraints (distilled)

> Load-bearing limits that shaped the architecture. Verify specifics against the Devvit MCP (`devvit_search`) before relying on them — do not trust memory.

| Constraint | Consequence for Parlor |
|---|---|
| **Approved runtime LLMs = OpenAI + Google Gemini only.** Anthropic/Claude, Llama, self-hosted = denied. | NPCs run on Gemini/OpenAI. Claude builds, never serves. |
| **LLM + HTTP fetch are "premium" → ~1-week app review; re-submit on every publish** (streamlined after first). | Schedule risk #1. Submit the thinnest LLM-touching build early to start the review clock; budget two cycles; keep a procedural-only fallback build always submittable. |
| **Storage = Redis only**, siloed per-subreddit install. No Postgres/pgvector/external DB in-process. **2KB per *setting*** (not per Redis value). | All game state in Redis. External stores only via allow-listed HTTPS fetch (stretch). |
| **Realtime supported** (`connectRealtime` + `realtime.send`; pub/sub) but server-authoritative. | Co-op = stretch (lobby + netcode). v1 single-player. |
| **Scheduler:** cron via `devvit.json`, ≤10 recurring jobs/install, 60 `runJob`/min. | Daily Case-of-the-Day post is trivial/reliable. |
| **"Avoid free-form text inputs"** for user content; constrain to safe dictionaries; moderate UGC; honor deletions; **expire Redis ≤30 days**. | Interrogation = chips + bounded free-text through OpenAI moderation; deletion triggers wired; TTLs on every key class. |
| **Serverless: 30s/request, 4MB payload, 10MB response;** per-token cost; localStorage wipes on update. | Generate the case offline (scheduler/pool), not per-message. Every player-facing LLM path is single-call. Two-phase + chunked generation. |
| **Engines React/Three.js/Phaser first-class** (templates + agent rules). Unity = WebGL export risk. | Phaser + React. Locked. |
| **No Reddit IP** (no Snoo/karma theming); original; no off-platform linking. | Original art + name. |

## Required `devvit.json` (Wave 0)
- Permissions: `redis`; HTTP domains `generativelanguage.googleapis.com` + `api.openai.com`; scheduler task; post entrypoint. **No realtime permission yet** (request only if co-op is built).
- Secrets: LLM API key(s) via Devvit settings/secrets.

## Submission checklist (C16)
LLM allowlist · deletions wired · ≤30-day TTLs · no Reddit IP · ToS/Privacy pages · README "Fetch Domains" section · moderation on bounded text · `killerId` never leaks (adversarial test green).
