# Code standards

Short on purpose. Grow as the specs settle.

## Naming rule (hard)

No brand or product names in this repo. Generic only: `engine`, `mcp-server`, `client`,
`agent-autonomy`, `worker`, `production`, `node`, `version`, `review`, `interaction`. Video-craft
terms (briefing, moodboard, storyboard, render, audio, polish) are the domain and are allowed.

## Language & toolchain

- **TypeScript / Node** for both the MCP server and the engine worker. One language, one toolchain,
  shared contract types in `shared`.
- **ESM** modules. Target current LTS Node.
- Test runner: **vitest** (default call; confirm when scaffolding, record in README).

## Ports and adapters (the testing seam)

Define an **interface (port)** at every external edge; core logic depends on the interface, never the
concrete implementation.

- `Store` — all DB reads/writes (productions, nodes, versions, reviews, interactions, feedback,
  budget). Tool handlers and the loop talk to `Store`, never to Postgres directly.
- `RenderClient` — each render engine behind one interface. **Stub implementation first**; real
  adapters when keys land.
- `SubagentRunner` — the LLM-call backend (the "engine"). The real one shells out to `claude -p`
  (`--output-format json`, so one call returns the text, the `session_id`, and token usage + cost);
  a fake returns canned output so the loop tests with no real subagent and no network. A factory
  (`engine/src/adapters/runner-factory.ts`) selects the backend by `SUBAGENT_ENGINE` (claude | fake;
  codex | openai reserved) and model by `SUBAGENT_MODEL`. The producer carries a `resumeSessionId` so
  a redo round continues the same session. Each `run()` is logged one row to the `interactions` table
  (role, engine, model, session_id, tokens, cost, duration): per-call usage is the row, whole-session
  usage is `SUM(...) GROUP BY session_id`.
- `Clock` / `IdGen` — injectable, so timestamps and ids are deterministic in tests.
- `Logger` — structured events (JSON lines to stderr by default). A real tracer (LangSmith,
  OpenTelemetry, pino) is a later adapter behind the same port — no core change. Entrypoints inject
  a `JsonLogger`; library code defaults to `NoopLogger` (quiet).

### Observability seam — reserved for tracing (LangSmith / OTel), not built yet

We are **not** adding a tracing backend now. But the abstractions must leave an obvious place for
one, so it drops in later with no core rewrite. Two facts fix that place:

- **The LLM-call boundary is `SubagentRunner`.** Every `claude -p` producer and specialist reviewer
  goes through it, and `SubagentResult` already carries a `runId`. That is the natural origin of a
  trace span: one run in, one span out. A future `LangSmithRunner` (or a tracing decorator wrapping
  any `SubagentRunner`) opens a span there, records the prompt/response as span I/O, and closes it —
  the loop is unchanged because it only sees the `SubagentRunner` interface.
- **The loop already emits span-shaped events** through `Logger`: `node.produce` (with `ms`),
  `review.verdict`, `production.start`/`done`, all tagged with `productionId`/`nodeId`. A tracer that
  consumes these — a `Logger` adapter that maps events to spans, correlating by `runId` + node ids —
  is the lighter alternative to a dedicated `Tracer` port.

So the reserved seam is: **wrap `SubagentRunner` for spans, and/or add a `Logger` adapter that
forwards to a tracer.** LangSmith works without LangChain (its SDK's `traceable()`, an OTel exporter,
or the REST API), so neither choice pulls LangChain into the tree. Decide between the two (wrap-runner
vs logger-adapter) when tracing is actually introduced; until then, keep `runId` flowing and keep the
events tagged.

Adapters (Postgres store via Drizzle + `pg`, HTTP render clients, the `claude -p` runner) each get thin, focused tests.
Unit testing is a goal, **not a blocker** — don't let test scaffolding stall the first spike.

## Where the logic lives — the service layer

Client-facing business logic (start a production, read status/inbox/deliverable, and the gate —
approve / feedback / budget) lives in **`@core/services`** as pure functions over the `Store` port. It
does **not** live in the MCP server and **not** in the dashboard. Those two are **transports**: each
translates its own wire format (MCP tool calls over stdio/HTTP; HTTP+JSON for the dashboard) to and
from the same service functions. One place for the rule, many ways to reach it — a new client (a CLI,
another transport) reuses the layer instead of reimplementing a gate write, so the write path can't
drift. The service layer unit-tests against `FakeStore` the same way the loop does; the transports
stay thin enough to need almost no logic tests of their own.

## Conventions

- **Named exports.** No default exports.
- Tabs for indentation (match Tiago's global style).
- Follow existing project patterns first; when none exists, keep it boring and explicit.
- Shared types are the contract — define them in `shared` and import; don't redeclare.
- Errors: fail loud in the worker loop (log + mark the node), fail fast + typed at the MCP boundary.

## Commits

- `tn/` branch prefix. Conventional-commit style messages.
- Commit each coherent change on its own, as soon as it is done.
