# Code standards

Short on purpose. Grow as the specs settle.

## Naming rule (hard)

No brand or product names in this repo. Generic only: `engine`, `mcp-server`, `client`,
`agent-autonomy`, `worker`, `production`, `node`, `version`, `review`, `interaction`. Video-craft
terms (briefing, moodboard, storyboard, render, audio, polish) are the domain and are allowed.

## Language & toolchain

- **TypeScript / Node** for both the MCP server and the engine worker. One language, one toolchain,
  shared contract types in `server/shared`.
- **ESM** modules. Target current LTS Node.
- Test runner: **vitest** (default call; confirm when scaffolding, record in README).

## Ports and adapters (the testing seam)

Define an **interface (port)** at every external edge; core logic depends on the interface, never the
concrete implementation.

- `Store` — all DB reads/writes (productions, nodes, versions, reviews, interactions, feedback,
  budget). Tool handlers and the loop talk to `Store`, never to Postgres directly.
- `RenderClient` — each render engine behind one interface. **Stub implementation first**; real
  adapters when keys land.
- `SubagentRunner` — spawns `claude -p`. A fake returns canned output so the loop tests with no real
  subagent and no network.
- `Clock` / `IdGen` — injectable, so timestamps and ids are deterministic in tests.

Adapters (Postgres store via Drizzle + `pg`, HTTP render clients, the `claude -p` runner) each get thin, focused tests.
Unit testing is a goal, **not a blocker** — don't let test scaffolding stall the first spike.

## Conventions

- **Named exports.** No default exports.
- Tabs for indentation (match Tiago's global style).
- Follow existing project patterns first; when none exists, keep it boring and explicit.
- Shared types are the contract — define them in `server/shared` and import; don't redeclare.
- Errors: fail loud in the worker loop (log + mark the node), fail fast + typed at the MCP boundary.

## Commits

- `tn/` branch prefix. Conventional-commit style messages.
- Commit each coherent change on its own, as soon as it is done.
