#!/usr/bin/env sh
# Pick up engine source / type.json changes in the RUNNING worker.
#
# engine-worker runs a BAKED image: `docker compose up -d --force-recreate` ALONE runs stale code/types
# (issue 0015) — only a rebuild picks up source. This script does the correct sequence and stamps the
# current git SHA into the image so worker.up logs which build it is running. Run from the repo root.
set -eu

GIT_SHA="$(git rev-parse --short HEAD)"
export GIT_SHA

echo "building engine-worker at ${GIT_SHA} ..."
docker compose build engine-worker
docker compose up -d --no-deps engine-worker
echo "worker recreated at ${GIT_SHA}."
echo "verify: docker compose logs engine-worker --tail 5 | grep worker.up   (buildSha should be ${GIT_SHA})"
