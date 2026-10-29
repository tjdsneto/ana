# Spec 08 — Artifact retention & cleanup

**Status:** retention rule is in force now; the cleanup method is designed here but **not built yet** (deferred). Implement when the cleanup gate / TTL sweep is scheduled.

## Rule: keep the files a production used

Every file a production produced or was built from is **kept on disk** for the life of the production. Nothing in the engine, services, or API deletes an artifact or working file. The DB never stores bytes — it points to the file (`versions.artifact_path`, `assets.storage_path`); binaries are served/streamed from disk (spec 06, `/api/video`), never inlined (`get_deliverable` skips binary media).

"Files a production used" = everything under `/data/artifacts/<productionId>/`:

- the **deliverables** — the versioned leaf artifacts (text drafts + the final render `.mp4`), referenced by `versions.artifact_path`;
- the **input/working files** the render was built from — the narration **audio** (`.wav`), and the per-scene work clips + concat lists in the render working dir (`local-<uuid>/`). Audio is now registered as a production **asset** (`assetType: "vo"`, `fileType: "wav"`, path only) so it is first-class and queryable, not anonymous scratch. Scene work clips stay on disk, hidden from the final-videos gallery (a display filter, not a delete).

## Cleanup method (deferred)

A production accumulates working files. Cleanup frees that disk **without losing the deliverable**, and is always one of two triggers — never automatic-on-write:

1. **User-presented, after approval.** Once the production is `approved`, the gate offers a cleanup action (a `chat_output`, like the approve/budget gates). The user chooses: keep everything, or purge the working files (audio + scene clips + concat lists) while keeping the final deliverable(s). Opt-in; default keep.
2. **TTL self-clean.** A periodic sweep purges the working files of productions `approved` (or `abandoned`) longer than a configured age (e.g. `CLEANUP_TTL_DAYS`). The final deliverable is kept; a shorter/second TTL may later purge whole abandoned productions.

### What each tier purges

| tier | purges | keeps |
|------|--------|-------|
| working-files cleanup (gate or TTL) | audio `.wav`, per-scene clips, concat lists, the `local-<uuid>/` working dir | final render `.mp4`, text deliverables, all DB rows |
| full purge (explicit only) | the whole `/data/artifacts/<productionId>/` tree | — (DB rows may be kept as a tombstone, or removed on explicit request) |

### Shape of the work (when built)

- A `cleanup(productionId, tier)` service over the `Store` + a filesystem port — same path-only discipline. It reads the production's assets + versions to know which files are working vs. deliverable, then unlinks the working set and marks the assets cleaned (a `cleanedAt` on `assets`, or a delete of the asset rows whose files are gone).
- The gate variant emits a `chat_output` of a new type (e.g. `cleanup`) and runs `cleanup(..., "working")` on the user's confirm.
- The TTL variant is a scheduled sweep (a worker tick or a cron service) selecting productions past the TTL.
- Never purge a file still referenced by a non-cleaned `versions.artifact_path`.
