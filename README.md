# Parlor *(working title)*

A **daily AI murder-mystery game for Reddit**, built on **Devvit Web**.

Explore a coordinate map of LLM-driven suspects and witnesses, interrogate them (each with their
own personality, secrets, and **memory of what you've done**), examine interactable items for clues,
assemble everything on an interactive **Deduction Board**, and name the killer. Every player gets a
**uniquely randomized — but provably solvable — instance** of the day's case, so the community can
trade hints and methods without ever spoiling the answer.

> **Status:** design complete, build in progress. The authoritative design lives in
> **[`PLAN.md`](./PLAN.md)** (the north-star) with the agent rules in **[`CLAUDE.md`](./CLAUDE.md)**
> and platform limits in **[`docs/devvit-constraints.md`](./docs/devvit-constraints.md)**.

## Tech direction (summary)

- **Platform:** Devvit Web (Reddit) — Node serverless backend, Redis storage, scheduler.
- **Engine:** Phaser (2D) + React. Hero mechanic: the interactive Deduction Board (red string = the signature).
- **AI:** Gemini / OpenAI only (the two providers Devvit permits at runtime), called server-side, free-tier-first.
- **Generation:** procedural skeleton (guaranteed-solvable, validator-enforced) + pre-rendered LLM voice; per-player randomized instances.
- **Art:** "Lamplight Noir" — warm theatrical-parlor palette, crimson reserved for the red string + lie-tells.

## Repo layout (Wave 0 onward)

```
src/shared/      # the Case typed contract — single source of truth (frozen first)
src/server/      # case generation, validator + blind solver, NPC harness, Redis, LLM provider
src/client/      # React shell + Phaser scenes (Deduction Board, living world)
docs/            # distilled platform constraints + design notes
```

## Fetch Domains

This app makes server-side HTTPS requests to approved LLM/moderation providers only:
`generativelanguage.googleapis.com` (Gemini), `api.openai.com` (OpenAI + moderation).

See `PLAN.md` for the full design, compliance rules, component contracts, and award strategy.
