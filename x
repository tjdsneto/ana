#!/usr/bin/env sh
# Run a command in the pinned Node 24 LTS + npm 12 toolbox container (the `toolbox` service in
# docker-compose.yml). The host needs only Docker — no local Node/npm. The repo is bind-mounted live,
# so edits on the host are seen immediately; node_modules live in named volumes (container-only).
#
#   ./x npm ci              # install from the lockfile (populates the node_modules volumes)
#   ./x npm install <pkg>   # add a dependency / regenerate the lockfile
#   ./x npm run build       # tsc -b across the workspace
#   ./x npm test            # vitest run
#   ./x npm run typecheck
#   ./x sh                  # interactive shell inside the toolbox
#
# db-touching scripts (db:migrate / db:seed) need the db service up and on the network first:
#   docker compose up -d db && ./x npm run db:migrate
#
# First run builds the image (one-time) before executing.
set -e
exec docker compose run --rm toolbox "$@"
