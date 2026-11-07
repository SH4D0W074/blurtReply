# Pairwise

Make room for reasoning. Pairwise helps a lecturer see the reasoning behind a class's answers, organise a focused peer discussion, and check a fresh independent response.

## Status

Under active development. The first target is a complete local demo, backed by a private GitHub repository. See [the implementation plan](docs/IMPLEMENTATION.md).

## Setup

Requires Node.js 24 or newer and pnpm.

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

Open http://localhost:3000. Local session data is stored in `.local/` and excluded from Git.

The application will support an explicitly labelled demonstration mode without API credentials. For live AI, add `OPENAI_API_KEY` to `.env.local` and set `PAIRWISE_LIVE_AI=true`. Keep this file private. `PAIRWISE_MAX_AI_CALLS` limits live analysis calls; it is a call limit, not a monetary spending guarantee.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## Product boundaries

Pairwise classifies expressed reasoning with uncertainty. It does not infer a student's ability or certify mastery. A short before/after demonstration illustrates a response change and is not evidence that the product improves learning.
