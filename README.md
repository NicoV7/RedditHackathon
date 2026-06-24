# Parlor *(working title)*

A **daily AI murder-mystery game for Reddit**, built on **Devvit Web**.

Each day the community plays the same randomized case: explore the scene, interrogate
LLM-driven suspects (each with their own personality and secrets), assemble clues on an
interactive **Deduction Board**, and name the killer. Cases live in a community
**case-library** subreddit and rotate daily — with a leaderboard, streaks, and
player-authored cases.

> Status: **design / planning**. No application code yet — see the plan below.
> The full design, platform-constraint analysis, phased scope, and multi-agent build
> plan live in **[`PLAN.md`](./PLAN.md)**.

## Tech direction (summary)

- **Platform:** Devvit Web (Reddit) — Node serverless backend, Redis storage, scheduler, realtime.
- **Engine:** Phaser (2D) + React. Hero mechanic: the interactive Deduction Board.
- **AI:** Gemini / OpenAI only (the two providers Devvit permits at runtime), called server-side.
- **Generation:** procedural skeleton (guaranteed-solvable) + LLM voice; validator-enforced.

See `PLAN.md` for the authoritative detail, compliance rules, and award strategy.
