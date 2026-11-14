# Issue 0036 — Registry-safe image build (no secrets in pushed layers)

Pre-emptive deploy hardening: restructure the image build so a credential **cannot** land in a pushed layer regardless of what `.dockerignore` says, and add a pre-push scan backstop. No active leak today (images are local-only, `.dockerignore` is correct); this closes the one-mistake-away gap before any registry push.

## What changed

### 1. `Dockerfile` — allowlist copy + multi-stage from a clean base (issue fixes #1, #2, #3)
Replaced the single `base` stage (whose `COPY . .` copied the whole build context, gated only by the `.dockerignore` blocklist) with a staged layout where **no pushed stage ever copies the repo root**:

- **`deps`** — `node:24-bookworm-slim` + pinned npm + `npm ci` from the package manifests only. No source, no secrets. Shared dependency layer.
- **`build`** (intermediate, never pushed) — `FROM deps` + `COPY . .` + `npm run build`. The *only* stage that copies the repo root wholesale, purely to compile.
- **`base`** (pushed: mcp-server / web-api / migrate) — `FROM deps` + an **allowlist** `COPY --from=build` of just the `shared` / `core` / `engine` / `server` workspace dirs. The repo root is never copied, so `.env` / `.common_env` / `.engine_env` (all root-only per `.gitignore`) cannot enter.
- **`engine`** (pushed: engine-worker) — unchanged agent-tools + playwright, then `COPY --from=base /repo /repo` (the allowlisted tree) + `COPY --from=build /repo/craft /repo/craft` (baked craft). Still never copies the root.
- **`web`** (pushed) — unchanged; nginx + built SPA only, already clean.
- **`web-build`** — now `FROM build` (was `FROM base`), since `base` no longer carries app source.
- **Build-time secrets (#3):** none needed today (all auth injects at runtime via Compose `env_file`). Added a documented BuildKit `--mount=type=secret` pattern in the header for any future need, with an explicit "never `ARG`/`ENV` a secret" warning.

### 2. `docker-compose.yml` — `web-dev` retargeted
`web-dev` (Vite dev server, needs full app source) now builds `target: build` (image `production-engine-dev:local`) instead of the now-allowlisted `target: base`. Dev-only (`dev` profile), never pushed. All other services unchanged: migrate/mcp-server/web-api on `target: base`, engine-worker + toolbox on `target: engine`, web on `target: web`.

### 3. `scripts/scan-image-secrets.sh` — pre-push guard (issue fix #4)
New required CI gate to run before `docker push`. Fails (exit 1) if an image contains: a credential-config file (`.env*` / `*_env` / named private keys; `*.example` allowed), a secret-shaped `ENV`/`ARG` in `docker history`, or (with `--deep`, or auto when `gitleaks` is on PATH) secret material in file contents. Defaults to the three pushed images.

### 4. `README.md` — registry-push contract (issue fix #5)
New "Registry-push contract (secret safety)" section: images are secret-free by construction, secrets inject at runtime only, the pre-push scan is mandatory, and a "do not reintroduce `COPY . .`" guard note.

## Build validation — RAN (docker 28.5.1 + buildx available)

- `docker build --target base|web|engine` all **succeeded** (tagged `:scan036` to avoid clobbering the shared `:local` images; tags removed after).
- **Base image verified:** no `*_env`/`.env`/`.pem` files at `/repo` root; all runtime artifacts present — `server/mcp/dist`, `server/api/dist`, `shared/dist`, `core/services/dist`, `engine/dist/worker`, `shared/src/migrate.ts`, `shared/migrations/*.sql`, `engine/types`, `engine/capabilities`, `node_modules/@core/shared` symlink, `node_modules/.bin/tsx`.
- **Engine image verified:** no secrets at root; `engine/dist/worker`, `engine/types`, `craft/.../tools`, `craft/.../.claude/skills`, `node_modules/playwright` all present; `claude` / `chromium` / `ffmpeg` baked; `ENGINE_BUILD_SHA` stamped (`eafc8e8`). Baked-toolchain behavior (0005/0031 chromium ordering) preserved — those layers were `CACHED`, untouched.
- **Module load:** `@core/shared` + `@core/services` dist import OK inside the base image (workspace symlinks resolve) — no DB needed.
- **Scan guard verified both ways:** PASS on the three clean images; and a negative test (a throwaway image baking `/repo/.engine_env` + a `CLAUDE_CODE_OAUTH_TOKEN` ENV) correctly **FAILED** (exit 1), flagging both the file and the history entries. Also fixed a false-positive in the gate during review — an initial `*.pem`/`*.key` filename rule flagged the OS CA trust store; narrowed to credential-config files + named private keys, leaving private-key *material* to the content gate.
- `docker compose config` parses (with the `.*_env.example` files stubbed to the real names for validation, then removed).

## What a human must still verify

1. **A real `docker compose up` of the full stack** end-to-end — I did NOT start the engine/MCP/worker or run a production (per task constraints). Confirm: `migrate` applies migrations + seed (runs `tsx src/migrate.ts` against the baked `shared/src` + `shared/migrations`), `mcp-server` serves and reads `engine/types`/`engine/capabilities`, `engine-worker` runs the loop, `web`/`web-api` serve, and the full-loop smoke passes.
2. **`web-dev` under the `dev` profile** actually serves the Vite dev server from the `build` stage (`docker compose --profile dev up web-dev`).
3. **The pre-push scan in CI** wired as a required gate before `docker push` (currently a script; no CI exists yet in this repo).
4. **`gitleaks`** optionally installed on CI so the content gate runs automatically (otherwise it SKIPs unless `--deep`).

## Not done / deferred
- Issue `issues/0036-*.md` left **open** and not renamed `closed-` — it lives at the project level (outside this worktree / `repo/` git) and the work isn't merged yet. Close it after the PR merges.
- No PR opened; commits left on branch `tn/feat/0036-registry-safe-image` per instructions.
