# Autonomous video-production engine — PoC

A caller sends a brief; a generic autonomy engine produces a video through a recursive,
self-reviewing loop and returns it for approval. Two processes (an MCP server + an engine worker)
share one Postgres DB and an artifacts directory. v0 proof-of-concept, internal only.

> **Naming rule:** no brand or product names in this repo — generic only (`engine`, `mcp-server`,
> `client`, `worker`, `production`). See `CLAUDE.md`.

## Locked decisions

1. **TypeScript / Node** for both the MCP server and the engine worker — one language, one toolchain,
   shared contract types in `shared`. (PoC-scoping only; the product keeps v1 language open.)
   **Toolchain is pinned by the project, not the machine:** Node 24 LTS + npm 12 (`.nvmrc`, root
   `engines` + `packageManager`, `.npmrc` `engine-strict`), and the Docker image (`node:24-alpine` +
   `npm@latest`) is the **canonical build/run/test environment**. Deps are kept at latest (zod 4,
   express 5, react 19, drizzle-orm 0.45, vite 8, vitest 5); `npm audit` is clean (0 vulns). TypeScript
   is held at 5.9 (7.0 is the native-compiler rewrite — revisit when tsx/vitest certify it).
   **Local dev needs no host Node** — use the `toolbox` container via `./x` (see below); `nvm use`
   + `npm ci` on the host is only the alternative if you prefer running Node locally.
2. **Transport — streamable HTTP** for the Compose target, plus a **thin stdio entrypoint** for the
   first local Claude Code check.
3. **Postgres from v0** — a `db` service in Compose (switched off the handoff's SQLite: it is the v1
   shape, removes the single-writer ceiling, and gives `LISTEN/NOTIFY` push + `jsonb` + `SKIP LOCKED`
   claiming, so no Phase-4 migration). Adapter: Drizzle + `pg`, behind the `Store` port. v0 still runs
   **one worker**; multi-worker is a later config change (the `SKIP LOCKED` seam), not a redesign.
4. **Ports and adapters** at every external edge (Store / SubagentRunner / Clock+IdGen)
   so the core unit-tests against fakes. See `docs/code-standards.md`.
5. **Render and voice are worker skills, not engine ports.** A rendered leaf runs its skill (e.g.
   `render-film`), which drives the craft tools directly — `site-capture` + a GSAP build + ffmpeg to
   assemble a **real `.mp4` offline** (no external key), and `voice-production` for TTS
   (`piper`/`kokoro`, offline). The engine owns no renderer and no `RenderClient`/`VoiceClient`/`Exec`
   port; it records the file the skill writes. Generative engines (HeyGen/Higgsfield) are reserved for
   the Family-B scene pipeline (keys pending Angie). **Live `.mp4` output needs ffmpeg + a font (+ a
   voice model for piper/kokoro) in the engine image — not baked yet (base-image decision pending;
   onnxruntime/kokoro is glibc-shaped).**
6. **Test runner: vitest** (default; confirm on scaffolding).
7. **Web app from v0** — a dev/observability SPA (`app/`, React + Vite) over a thin read API
   (`server/api`, Node/TS) that renders productions/nodes live (via `LISTEN/NOTIFY` → WebSocket) and
   drives the v0 **human gate** (approve/feedback). Not the product client. In Compose it is a
   **production build** (`vite build`) served by **nginx**, which reverse-proxies `/api` + `/ws` to
   `web-api` (one origin — the SPA's relative URLs need no CORS/host baking); the Vite dev server
   stays available as the `web-dev` service under the `dev` profile. See `docs/specs/06-dashboard.md`.

Design source of truth (outside this repo — don't copy its product name in):
`../docs/lisa/lisa-loop-design.md` (§20–27 = the recursive typed-project model) and
`../docs/lisa/key-decisions.md` (D1–D9).

## Build order

1. Repo + `git init` + `.gitignore` + skeleton `CLAUDE.md` / `docs/code-standards.md`. ✅
2. Specs in `docs/specs/`, **domain model first**, then lifecycle/loop, ports + schema, tools, flows,
   web app, compose. ✅ (01–07)
3. Shared contract: types + port interfaces + Drizzle schema/migrations in `shared`; seed the
   default account + user. ✅ (`@core/shared` — schema + `0000_init.sql` + `migrate`/`seed`; smoked
   against a throwaway Postgres: 9 tables created, defaults seeded, both scripts idempotent)
4. MCP server: the direct tools + `request_video` (stdio entrypoint first), against a `Store` fake,
   then the Postgres (Drizzle + `pg`) adapter. ✅ (`@server/mcp` — 7 tools, stdio + stateless-HTTP
   entrypoints; `PgStore` + `FakeStore` in `@core/shared`; smoked over the real MCP protocol on both
   FakeStore and Postgres)
5. Engine worker: the poll/`LISTEN` loop against fakes (fake subagent runner + stubbed render), then
   the `claude -p` runner. ✅ (`@engine/worker` — generic loop + on-disk type registry (7-step pipeline),
   redo cap + F5 agreement cap, `LISTEN/NOTIFY` wake-ups; smoked end-to-end on Postgres: queued →
   7 children produced/reviewed/approved → root done in 8 ticks)
6. Web app: `server/api` (reads + WebSocket over `LISTEN/NOTIFY`) + `app` (React),
   once there is live data to render. ✅ (`@server/api` — read DTOs over the `Store`, gate
   writes calling the shared `@core/services` layer, `LISTEN new_job`/`presentable` relayed to browsers
   over a WebSocket; `@app/web` — React + Vite SPA: productions list, live node tree +
   versions + reviews, type-driven inbox gate (approve/feedback/ack + budget). Smoked on Postgres:
   reads + both NOTIFYs over the socket + an approve round-trip; `vite build` clean.)
7. Docker Compose (`db` + `mcp-server` + `engine-worker` + `web-api` + `web`) on the shared volume. ✅
   (one root `Dockerfile`, multi-stage: `base` runs the node services, `engine` adds the Claude Code
   CLI for the real subagent runner, `web` is an nginx prod build of the SPA proxying `/api`+`/ws` to
   `web-api`. A one-shot `migrate` service applies migrations + seed. Default `SUBAGENT_ENGINE=fake`
   so the stack runs with no `claude` call (zero spend), like render stays stubbed; real `claude` is
   opt-in via the subscription token. `web-dev` (Vite hot-reload) and `toolbox` sit behind profiles.)
8. End-to-end check per acceptance below. ✅ (full stack `up`; `request_video` over the **real MCP
   protocol** created a production; the `NOTIFY`-woken worker produced all 7 leaves; approving each
   gate output over MCP rolled the root up to `approved`; `web-api` reflected all 8 nodes approved; 7
   artifact files landed under `server/data/artifacts/<id>/`.)

## Local development — no host Node required

The pinned toolchain lives in the container, not on your machine. The `toolbox` service (Node 24 LTS
+ npm 12, the same image every service runs) gives a host-free shell for install / build / test / add-
a-dep; drive it with the `./x` wrapper. The repo is bind-mounted live, so host edits are seen at once,
while every `node_modules` sits in a named volume — the container's Linux-arch install never clobbers
a host `node_modules`, and vice versa.

```
./x npm ci              # install from the lockfile (first run also builds the image)
./x npm install <pkg>   # add a dependency / regenerate the lockfile
./x npm run build       # tsc -b across the workspace
./x npm test            # vitest run
./x npm run typecheck
./x sh                  # interactive shell in the toolbox
```

db-touching scripts need the `db` service up first: `docker compose up -d db && ./x npm run db:migrate`.
Running Node directly on the host still works (`nvm use` → `npm ci` under Node 24) if you prefer it —
the IDE's in-editor test runner / debugger is the one thing the container can't drive.

## Acceptance (PoC spike)

- `docker compose up` brings up `db` + `mcp-server` + `engine-worker` (+ `web-api` + `web`) sharing the
  DB and the artifacts volume.
- From a Claude Code session: `request_video` inserts a production; `engine-worker` is woken by
  `NOTIFY` and advances status; `get_status` / the web app reflect progress; a presentable version
  shows in `inbox` / the web app; `approve` drives the next pass; an artifact row + file appears
  under `server/data/artifacts`.
- Render stubbed (text-level) is fine. Core loop + tool handlers have unit tests against fakes. No
  brand/product naming anywhere.

## Registry-push contract (secret safety)

Images are **secret-free by construction**, not by blocklist (issue 0036). The build is structured so no credential can land in a pushed layer regardless of `.dockerignore`:

- **No `COPY . .` in any shipped stage.** The Dockerfile splits into `deps` (toolchain + `npm ci`, no source) → `build` (the one stage that copies the repo root, to compile — **intermediate, never a Compose/runtime target, never pushed**) → `base` (the pushed node image: an **allowlist** `COPY --from=build` of just the `shared` / `core` / `engine` / `server` workspace dirs) → `engine` (the pushed worker: the allowlisted `base` /repo overlaid on the agent-tools stage, plus the baked `craft` tree) → `web` (nginx + the built SPA only). Because the pushed stages copy only named subpaths and never the repo root, a root secret file (`.env` / `.common_env` / `.engine_env`, or any future one) **cannot** be copied in — `.dockerignore` is now a second line of defence, not the only one.
- **Secrets inject at RUNTIME only**, via Compose `env_file` (`.common_env`, `.engine_env`). No secret is ever a build `ARG` or `ENV` (both are readable in `docker history` of a pushed image). If a build step ever genuinely needs one, use a **BuildKit secret mount** (`RUN --mount=type=secret,id=…`) — see the pattern in the Dockerfile header.
- **Pre-push guard is mandatory.** Before any `docker push`, run `scripts/scan-image-secrets.sh` (defaults to the three pushed images: `production-engine:local`, `production-engine-claude:local`, `production-engine-web:local`). It fails the pipeline if it finds a credential-config file (`.env*` / `*_env`), a named private key, a secret-shaped `ENV`/`ARG` in `docker history`, or (with `--deep`, or automatically when `gitleaks` is on `PATH`) secret material in file contents. A non-zero exit must abort the push.

> **Do not reintroduce `COPY . .` into `base`, `engine`, or `web` for convenience.** That re-opens the exact gap 0036 closed. Full-source needs (the Vite dev server) use the `build` stage, which is never pushed.

## Not in scope

Real render wiring (needs keys), hosting, accounts/billing, multi-worker scale, the production
website (WordPress) — all later phases.
