# Spec 10 — Recursion, reopen & revalidation

**Status:** implemented (engine). Extends spec 02 (loop & lifecycle). This spec documents the parts of the loop that spec 02 marked *v0-flat: not exercised* — they are now built — plus the backward-reopen and revalidation machinery the loop grew on top. Lineage: the recursive-scene idea and the backward-reopen design.

## 1. Recursion — the loop is no longer flat

Spec 02's dispatch table is now fully live, at any depth:

- **expand** (static `checklist`) — any claimed node whose type declares a checklist creates its child nodes, not just the root. (`expandNode`.)
- **plan** (`planner: true`) — a planner node runs a planner subagent over its approved upstream, which returns a generic `{name, brief}` list; the engine creates one child of `childType` per entry. Children inherit the planner's `deps` (so they see the same upstream and are immediately ready) and carry their unit spec in `description`. The engine never parses the upstream's own schema (e.g. a storyboard's `film.json`) — the planner skill does. (`dispatchPlan`.)
- **rollup at depth** — any in-progress node whose children are all `approved` (or `skipped`) becomes `approved`; the root rolling up = the production done. (`rollupNodes`.)

The leaf producer prompt also carries the node's own `description` as "this unit's spec", so a fanned-out child (one scene) sees its own brief, not just the global one.

## 2. builtFrom — what a version was produced from

Every produced version records `builtFrom`: a map of each upstream dep → that dep's **effective content hash** (nullable `jsonb` column; migration 0002). "Effective" rolls a parent's children up — a fanned-out planner's hash is the hash of its (non-skipped) children — so changing one scene changes the planner's effective hash while a kept upstream leaves it identical. This is the signal revalidation uses to tell a real upstream change from a no-op.

## 3. Backward reopen — the holistic final review

The terminal `final-review` node (`holisticReview: true`) watches the finished video and emits a structured verdict:

```
VERDICT: pass
```
or
```
VERDICT: revise
REOPEN: <step> — <reason>
REOPEN: <step>[<n>] — <reason>   # target one fanned-out instance (1-based), e.g. scene[3]
```

`pass` presents to the human. `revise` + `REOPEN` lines send the named upstream node(s) back, within a production-wide budget (`maxGlobalRevisions`, default 2); on exhaustion or no actionable target it escalates to the human with a caveat. `final-review` is terminal, so the root never reaches `approved` during a reopen — rollup stays monotonic and needs no root un-approval. An instance selector (`[n]`) picks one sibling of that type; no selector reopens every node of that type.

## 4. Revalidation cascade — rebuild only what the change breaks

A reopen does **not** blindly rebuild everything downstream. The named targets re-produce (`denied` + the critic's reason); every other node the change reaches is marked **`stale`** (a version status) and re-checked:

| node reached by the cascade | marked | on dispatch |
|---|---|---|
| named by the critic | `denied` + reason | re-produce |
| its own deps changed, **planner** | `stale` | **re-plan + reconcile** (§5) |
| a child reopened but own deps intact (ancestor) | `in-progress` | re-roll-up only (no re-produce) |
| `final-review` | `superseded` | always re-run once the cascade settles |
| any other dependent | `stale` | **revalidate** (below) |

**Revalidate** (`revalidate`) decides a stale node's fate against the now-current upstream:

1. **upstream hash unchanged** (a no-op reopen reached it) → keep as-is, approve in place, no re-produce, no human re-gate (the bytes the human already approved are unchanged). The cascade stops here — this node's output didn't change, so its own dependents' hashes still match.
2. **mechanical node** (`rendered`) or **no upstream-sensitive reviewer** → rebuild. It can't cheaply judge the change is harmless (a rendered node embeds its upstream; e.g. render re-renders whenever the storyboard actually changed).
3. **authoring node** → re-run only its upstream-sensitive reviewers (`coverage` + `consistency`) against the **existing** artifact, in revalidation mode (the reviewer is told the work was approved and to pass unless the change actually breaks its axis). All pass → keep (record it as validated against the new upstream); any revise → rebuild, fed the reviewers' notes.

Quality (`craft`) is never re-checked — an upstream change can't lower intrinsic craft. A node that is kept does not disturb its dependents; a node that rebuilds changes its artifact, so its dependents (already marked stale) detect the change and react in turn. Net effect: a trivial script edit the storyboard still covers keeps storyboard/render/polish; a substantial one propagates.

## 5. Planner re-plan — reconcile, don't re-fan

When the change reaches a planner through its **own** upstream (not merely a reopened child), the planner re-plans and reconciles its children **by name** rather than blindly re-fanning (which would discard approved scene work) or merely re-rolling-up (which would miss an added/removed scene):

- a child still named in the new plan is **kept** (it revalidates individually via its own stale mark);
- a child no longer named is **skipped** (excluded from the planner's rollup and from effective-hash);
- a genuinely new entry is **created** (pending → built).

The planner records a new plan version and re-rolls-up once the reconciled set settles. Reopening a single *scene* (a child) does **not** trigger a re-plan — only a change to the planner's own upstream does — so the surgical per-scene path is untouched.

## 6. Known gaps

- **Generative scenes are keyless.** The scene pipeline is now `video-project`'s own tail (`build → scene → assemble`); there is no separate `video-project-generative` type. A scene's realization `method` decides how it is produced: `authored-composite` / `authored-continuous` render via the Family-A craft chain today, while `whole-clip-generative` scenes can't produce real clips until HeyGen/Higgsfield keys are provisioned (`build-scene` emits a shot spec and `scene` is a text leaf until then; flip to a rendered leaf when keys land). `assemble`'s consistency reviewer is still a generic lens for the same reason.
- **Revalidation precision = reviewer precision.** Whether a change is "substantial" is the conformance/consistency reviewers' call; the rubrics are where that quality lives.
- **Reopen budget is in-memory, per-process** (like the spend guard) — a worker restart mid-production resets the count. Fine for v0 single-worker; persist it for multi-worker.
