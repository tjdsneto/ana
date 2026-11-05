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
#
# SHARED-IMAGE CONTRACT — read before changing the agent-CLI installs below. The engine stage
# (FROM engine-tools) is run by TWO Compose services: `engine-worker` (the real loop, `target: engine`)
# AND `toolbox` (the `./x` wrapper, also `target: engine` — see docker-compose.yml). They MUST stay the
# same image: every subagent-engine CLI the worker can dispatch to (claude-code, codex, gemini) is baked
# HERE, in engine-tools, precisely so both services carry the identical set. Never add an agent CLI to
# only one service, and never split toolbox onto a lighter target — `./x` must be able to run exactly
# what the worker runs, or a `codex`/`gemini` node that works under the worker breaks under toolbox (and
# vice versa). Add a new engine CLI only in this stage.
FROM node:24-bookworm-slim AS engine-tools
ARG TARGETARCH
# Docker Desktop's VM filesystem (macOS/arm64) breaks apt's unprivileged `_apt` sandbox: that user
# can't read the just-downloaded InRelease, so gpgv checks a garbage file and EVERY repo fails with a
# false "At least one invalid signature was encountered". Run apt as root (no privilege drop) for the
# whole image — the documented workaround for that false signature failure. Persists into the engine
# stage (FROM engine-tools), so playwright's own `--with-deps` apt is covered too.
RUN echo 'APT::Sandbox::User "root";' > /etc/apt/apt.conf.d/00no-sandbox
RUN apt-get update \
	# chromium: the headless browser the HTML→video renderers drive (motion-graphics / HyperFrames via
	# Puppeteer, and the Family-A html render). Baked so nothing downloads a browser at runtime.
	&& apt-get install -y --no-install-recommends bash curl ca-certificates ripgrep ffmpeg fonts-dejavu-core chromium \
	&& rm -rf /var/lib/apt/lists/* \
	# npm blocks dependency install scripts, so claude-code's postinstall (install.cjs, which links its
	# native binary) is skipped and `claude` won't launch — run it explicitly.
	&& npm i -g @anthropic-ai/claude-code@2.1.312 \
	&& node "$(npm root -g)/@anthropic-ai/claude-code/install.cjs"
# OpenAI Codex CLI — the second SubagentRunner backend (`codex exec`), for nodes that pin engine
# "codex" (TypeContract.engine) or SUBAGENT_ENGINE=codex. Installs clean under npm 12 with NO explicit
# postinstall (verified): unlike claude-code's install.cjs above, codex ships a prebuilt per-platform
# binary as an optional dep, so npm's script-blocking doesn't skip anything. Pinned. Auth is injected
# at runtime (OPENAI_API_KEY in .engine_env), never baked. Headless call:
# `codex exec -m <model> --dangerously-bypass-approvals-and-sandbox` (the worker container IS the
# external sandbox that flag is meant for).
RUN npm i -g @openai/codex@0.166.0
# Google Gemini CLI — the third SubagentRunner backend (`gemini -p`), for nodes that pin engine
# "gemini" (TypeContract.engine) or SUBAGENT_ENGINE=gemini. Bin is a bundled JS entry (bundle/gemini.js,
# no native link), so it installs clean under npm 12. The install DOES warn that two OPTIONAL scripts
# are blocked — @github/keytar (OS-keychain store for interactive OAuth login) and node-pty (interactive
# PTY); neither is needed for our headless, API-key use and `gemini --version` runs without them, so the
# warning is expected and left as-is (do NOT --allow-scripts them). Pinned. Auth is injected at runtime
# (GEMINI_API_KEY in .engine_env), never baked — the container has no interactive Google login. Headless
# call (intended): `gemini -p "<prompt>" -m <model>`.
RUN npm i -g @google/gemini-cli@0.67.0
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
# python3 + the voice/compose toolchain the render shells out to (craft/video-production/tools/vo.py, mix.py, build.py).
# build.py is stdlib python3; vo.py/mix.py need numpy + soundfile, and vo.py's word timing uses the
# `whisper` CLI (openai-whisper). A venv at /opt/voenv holds those; make-film.sh runs vo.py/mix.py under
# $KOKORO_PY (pointed at the venv), build.py under system python3. The whisper base model is baked so
# there is no runtime download. libsndfile1 is soundfile's native dep.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 python3-venv libsndfile1 \
	&& rm -rf /var/lib/apt/lists/* \
	&& python3 -m venv /opt/voenv \
	&& /opt/voenv/bin/pip install --no-cache-dir numpy soundfile openai-whisper \
	&& ln -s /opt/voenv/bin/whisper /usr/local/bin/whisper \
	&& /opt/voenv/bin/python -c "import whisper; whisper.load_model('base')"
# faster-whisper (speech → word-timed transcript for the edit-footage leaf) — a SEPARATE venv at
# /opt/fw-venv (CTranslate2 ASR, distinct from the render voenv above), base model baked so nothing
# downloads at runtime. transcribe.py decodes with ffmpeg + passes a numpy array (bypasses PyAV).
# python3 / python3-venv are already installed above, so this only creates the venv.
RUN python3 -m venv /opt/fw-venv \
	&& /opt/fw-venv/bin/pip install --no-cache-dir faster-whisper numpy \
	&& /opt/fw-venv/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')"
# PUPPETEER_*/CHROME_PATH point the HTML→video renderers at the baked chromium so nothing downloads a
# browser at runtime (Puppeteer / HyperFrames / the Family-A html render).
ENV CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
	DISABLE_AUTOUPDATER=1 \
	KOKORO_PY=/opt/voenv/bin/python \
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
# Playwright + chromium for the composed render (craft/video-production/tools/site-capture.mjs screenshots each plate).
# Installed in the IMAGE only — not the shared repo package.json, which would shadow the host's own
# playwright. npm 12 blocks the browser-download postinstall, so fetch chromium + its apt deps explicitly.
# Kept ABOVE the source COPY (issue 0031): this layer depends only on engine-tools, so editing source or
# a type.json never invalidates it and chromium is not re-downloaded on a rebuild. The browser lands in
# /root/.cache/ms-playwright (outside /repo); the playwright npm package in /repo/node_modules survives
# the COPY overlay because base carries no playwright dep (it is --no-save).
RUN npm i --no-save playwright@1.48.2 \
	&& npx playwright install --with-deps chromium
COPY --from=base /repo /repo
# Stamp the source git SHA (passed as a build arg) so the worker logs which build it is running (0015),
# making a stale / not-rebuilt image visible at worker.up instead of silently running old code.
ARG GIT_SHA=unknown
ENV ENGINE_BUILD_SHA=$GIT_SHA
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
