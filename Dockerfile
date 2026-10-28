# Two stages (PoC — don't over-build). `base` is the one image every service runs (node services run
# their built dist; the web app runs the Vite dev server, which proxies /api + /ws to web-api so the
# browser talks to one origin). `engine` extends it with the Claude Code CLI for the real subagent
# runner — kept off the mcp/api/web image, which don't shell out to `claude`.
#
# NOTE: build with an explicit `target` — Compose services use `target: base`, engine-worker uses
# `target: engine`. Without a target, Docker builds the LAST stage (engine) for everyone.

FROM node:24-alpine AS base
WORKDIR /repo

# Pin the toolchain in the image (the versioned source of truth, not the host): Node 24 LTS from the
# base, npm bumped to the latest major (12.x) — npm 10/11 crash resolving vite 8's rolldown tree.
RUN npm i -g npm@latest

# Install with the full workspace layout present (npm needs every package.json to resolve the
# @core/@server/@engine/@app links) — copied before the source so this layer caches on lockfile changes.
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY shared/package.json shared/package.json
COPY core/services/package.json core/services/package.json
COPY engine/package.json engine/package.json
COPY server/mcp/package.json server/mcp/package.json
COPY server/api/package.json server/api/package.json
COPY app/package.json app/package.json
RUN npm ci

# Source, then build the composite TS projects (shared → core/services → engine → server/{mcp,api}).
# The web app is not pre-built; it runs the Vite dev server at runtime.
COPY . .
RUN npm run build

# Overridden per service in docker-compose.yml.
CMD ["node", "server/mcp/dist/http.js"]

# ── engine stage ──────────────────────────────────────────────────────────────────────────────────
# Adds the Claude Code CLI so the engine's real SubagentRunner can spawn `claude -p`. Pinned (behavior
# shifts between CLI versions — e.g. -p defaults to Manual permission mode from v2.1.302). The apk
# deps are what the CLI needs on musl. Subagents run text-only with tools denied (Manual mode), so no
# non-root/bypass is needed and the image stays root. Auth is injected at runtime (CLAUDE_CODE_OAUTH_TOKEN,
# never baked in). The disable-traffic/autoupdater envs stop background update + telemetry calls in CI.
FROM base AS engine
# npm 12 blocks dependency install scripts by default, so claude-code's postinstall (install.cjs, which
# links its per-platform native binary) is skipped and `claude` won't launch — run it explicitly.
RUN apk add --no-cache bash curl libgcc libstdc++ ripgrep \
	&& npm i -g @anthropic-ai/claude-code@2.1.312 \
	&& node "$(npm root -g)/@anthropic-ai/claude-code/install.cjs"
ENV CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
	DISABLE_AUTOUPDATER=1
CMD ["node", "engine/dist/worker.js"]

# ── web build stage ─────────────────────────────────────────────────────────────────────────────
# Produce the static SPA bundle (app/dist). Separate from `base` so the heavy node_modules never ship
# in the final web image — only the built assets do.
FROM base AS web-build
RUN npm -w @app/web run build

# ── web (prod) stage ────────────────────────────────────────────────────────────────────────────
# Serve the built SPA with nginx and reverse-proxy /api + /ws to web-api (same origin, so the app's
# relative URLs work unchanged — no CORS, no baked API host). This replaces the Vite dev server for
# the Compose target; the dev server stays available via the `web-dev` service (dev profile).
FROM nginx:1.27-alpine AS web
COPY app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /repo/app/dist /usr/share/nginx/html
EXPOSE 80
# nginx:alpine's default CMD runs the server in the foreground.
