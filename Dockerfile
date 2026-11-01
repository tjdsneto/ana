# Two stages (PoC — don't over-build). `base` is the one image every service runs (node services run
# their built dist; the web app runs the Vite dev server, which proxies /api + /ws to web-api so the
# browser talks to one origin). `engine` extends it with the Claude Code CLI for the real subagent
# runner — kept off the mcp/api/web image, which don't shell out to `claude`.
#
# NOTE: build with an explicit `target` — Compose services use `target: base`, engine-worker uses
# `target: engine`. Without a target, Docker builds the LAST stage (engine) for everyone.

# Base is debian (bookworm-slim), not alpine: the engine stage needs glibc — ffmpeg, the Claude Code
# CLI's native binary, and piper/onnxruntime (kokoro later) are all glibc-shaped, and uniform glibc
# removes the musl special-casing. web stage stays nginx:alpine (static assets only).
FROM node:24-bookworm-slim AS base
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

# ── engine-tools stage ──────────────────────────────────────────────────────────────────────────
# Everything the engine shells out to, in a SOURCE-INDEPENDENT stage so editing app code never
# re-runs the apt install or the ~63MB model download (big caching win across the night's rebuilds):
# the Claude Code CLI (real SubagentRunner → `claude -p`), ffmpeg + a font (local RenderClient →
# a real .mp4), and piper + a default voice model (offline TTS, VOICE_PROVIDER=piper). claude-code is
# pinned (behavior shifts between versions — e.g. -p defaults to Manual permission mode from v2.1.302).
# Subagents run text-only with tools denied (Manual mode), so the image stays root. Auth is injected at
# runtime (CLAUDE_CODE_OAUTH_TOKEN, never baked). piper's binary bundles its own onnxruntime +
# espeak-ng-data; the model is baked so there is no network or key at runtime.
FROM node:24-bookworm-slim AS engine-tools
ARG TARGETARCH
RUN apt-get update \
	# chromium: the headless browser the HTML→video renderers drive (motion-graphics / HyperFrames via
	# Puppeteer, and the Family-A html render). Baked so nothing downloads a browser at runtime.
	&& apt-get install -y --no-install-recommends bash curl ca-certificates ripgrep ffmpeg fonts-dejavu-core chromium \
	&& rm -rf /var/lib/apt/lists/* \
	# npm blocks dependency install scripts, so claude-code's postinstall (install.cjs, which links its
	# native binary) is skipped and `claude` won't launch — run it explicitly.
	&& npm i -g @anthropic-ai/claude-code@2.1.312 \
	&& node "$(npm root -g)/@anthropic-ai/claude-code/install.cjs"
# piper (offline neural TTS) — pinned release; arch from the build platform. Extracts to /opt/piper
# (binary + libs + espeak-ng-data via $ORIGIN rpath), symlinked onto PATH. Default voice under
# /opt/piper-voices.
RUN set -eux; \
	case "${TARGETARCH:-amd64}" in \
		amd64) PIPER_ARCH=x86_64 ;; \
		arm64) PIPER_ARCH=aarch64 ;; \
		arm) PIPER_ARCH=armv7l ;; \
		*) echo "unsupported TARGETARCH '${TARGETARCH}'" >&2; exit 1 ;; \
	esac; \
	curl -fsSL -o /tmp/piper.tar.gz "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_${PIPER_ARCH}.tar.gz"; \
	tar -xzf /tmp/piper.tar.gz -C /opt; \
	ln -s /opt/piper/piper /usr/local/bin/piper; \
	rm /tmp/piper.tar.gz; \
	mkdir -p /opt/piper-voices; \
	curl -fsSL -o /opt/piper-voices/en_US-amy-medium.onnx "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx"; \
	curl -fsSL -o /opt/piper-voices/en_US-amy-medium.onnx.json "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json"
# faster-whisper (speech → word-timed transcript for the edit-footage leaf). In a venv (off the system
# python), with the base model baked so nothing downloads at runtime. transcribe.py decodes with ffmpeg
# and passes a numpy array, bypassing faster-whisper's PyAV decode.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 python3-venv \
	&& rm -rf /var/lib/apt/lists/* \
	&& python3 -m venv /opt/fw-venv \
	&& /opt/fw-venv/bin/pip install --no-cache-dir faster-whisper numpy \
	&& /opt/fw-venv/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')"
# PUPPETEER_*/CHROME_PATH point the HTML→video renderers at the baked chromium so nothing downloads a
# browser at runtime (Puppeteer / HyperFrames / the Family-A html render).
ENV CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
	DISABLE_AUTOUPDATER=1 \
	RENDER_FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
	VOICE_MODEL=/opt/piper-voices/en_US-amy-medium.onnx \
	PUPPETEER_SKIP_DOWNLOAD=1 \
	PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
	CHROME_PATH=/usr/bin/chromium \
	FW_PY=/opt/fw-venv/bin/python

# ── engine stage ──────────────────────────────────────────────────────────────────────────────────
# The built app (from base) laid over the tools. Only this COPY re-runs when source changes — the
# apt/piper/model layers above stay cached.
FROM engine-tools AS engine
WORKDIR /repo
COPY --from=base /repo /repo
CMD ["node", "engine/dist/worker/index.js"]

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
