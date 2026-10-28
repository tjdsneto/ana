# One image for every TS/Node service (PoC — don't over-build). Each Compose service overrides the
# command: the node services run their built dist, the web app runs the Vite dev server (which proxies
# /api + /ws to web-api, so the browser talks to one origin). Slim per-service images are a later concern.

FROM node:24-alpine
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
