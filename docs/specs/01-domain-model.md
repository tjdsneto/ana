# Spec 01 — Domain model (the spine)

**Status:** draft to build against. Derived from the external design source of truth
(`../../docs/lisa/lisa-loop-design.md` §20–27, `key-decisions.md` D7). Everything else — the loop, the
schema, the tools — derives from this. Keep it current when the model changes.

> Naming: generic only. No brand/product name. The entity below is the **production**, not a product.

## One recursive concept: the typed node

Everything is a **node**. A node is the same shape at every level — it is either a whole production, a
sub-project, or a single work item. A node has a **type**; the loop resolves the type against the
**type registry** and dispatches on it. There is no separate "production" entity — the **root node**
(`parent_id = null`) *is* the production; `production_id` groups one tree.

```
node {
  id
  account_id             // root only: the account (tenant) that owns this production — see Accounts below
  production_id          // groups one tree; the root's own id
  parent_id              // null = root = the production
  type                   // resolved against the type registry (see below)
  name, description
  status                 // see lifecycle (spec 02)
  deps: [node_id]        // sibling prerequisites that must be approved before this can START
  position               // ordering among siblings
  session_id             // root only: the client session that owns it (the nudge target)
  created_at, updated_at
}
```

Two orthogonal axes (do not conflate):

- **`deps` = getting started (gating).** Horizontal, between siblings. A node is not ready until every
  dep is approved.
- **children = measuring progress (decomposition).** Vertical. A node *with* children is a
  **sub-project** — its status derives from its children. A node *without* children is a **leaf** — it
  progresses through its **versions**.

## Account — the tenant seam

An **account** owns productions. It is the brand/tenant the design calls out as a v1 concern
(`key-decisions.md` D1; `lisa-loop-design.md` §18/§23 + the "no separate projects table in v0" footer). We pull the abstraction forward **now** — not
the multi-tenancy, just the seam — so nothing has to be retrofitted later.

```
account {
  id
  name
  created_at
}
```

- **PoC runs single-account.** One **default** account is seeded at init; every production is created
  under it. Code never hardcodes "there is one account" — it always reads/writes `account_id`, which
  happens to resolve to the default. That is the whole point: the join exists, the data is there, and
  turning on real tenancy later is adding rows + auth, not a migration.
- `account_id` lives on the **root node** (the production); the tree inherits it via `production_id`.
- Tenant metadata that is *not* recursive (owner, delivery target, billing) is deferred — the table is
  deliberately thin for v0. Grow it when the external phase needs it.

## Versions — the feedback history of a leaf

A leaf produces **versioned deliverables**. Each attempt is a version; versions carry the feedback
that produced the next one.

```
version {
  id
  node_id
  n                      // 1, 2, 3, …
  prev_version_id        // links a revision to the one it supersedes (lineage)
  status                 // producing | in-review | presentable | presented | approved | denied | needs-work | superseded
  artifact_path          // file on disk (storyboard.md, render, audio); big artifacts never live in the DB
  subagent               // the subagent attached to produce it + its state → idempotency: don't re-dispatch
  feedback               // the feedback that led to the next version (from reviewer or user)
  created_at, updated_at
}
```

**Idempotency:** a version records which subagent is producing it, so a re-runnable / async loop knows
not to re-dispatch work already in progress or done.

## Reviews — the internal quality gate (not one pass)

A leaf's internal gate is a **set** of specialist reviewers, each an independent `claude -p` with its
own rubric emitting `VERDICT: pass | revise`. The node becomes `presentable` only when **every**
reviewer passes (or it hits `MAX_REDOS` and escalates — spec 02). Three archetypes drive what context
the reviewer is fed:

| kind | checks | fed beyond the deliverable |
|------|--------|-----------------------------|
| craft | the deliverable on its own merits | rubric only |
| coverage | did every upstream point make it in? | the upstream brief / final brief / feedback / interview |
| consistency | matches the design language + sibling artifacts | sibling artifacts + the moodboard |

```
review {
  id, node_id, version_id
  name                   // maps to a rubric (craft side; files, not a table)
  kind                   // craft | coverage | consistency
  verdict                // pass | revise
  body                   // the reviewer's feedback
  created_at
}
```

## Human contact — split by direction (`human_output` / `human_input`)

Engine↔user contact is explicit and **typed by direction**, not inferred from `node.status`. Two
tables, defined from the **engine's** point of view:

- **`human_output`** — everything the engine needs to **show the user** (engine → user).
- **`human_input`** — everything that **comes from the user** (user → engine).

> Direction is defined, not guessed: `human_output` = *output the engine sends out to the human*;
> `human_input` = *input the engine receives from the human*. (If this reads ambiguous in code,
> `to_human` / `from_human` are the unambiguous fallbacks — one decision, easy to swap.)

```
human_output {
  id, account_id, production_id, node_id?, version_id?
  type                   // present | ask | notify
  status                 // pending | resolved   (resolved when a human_input answers it)
  prompt
  options                // JSON, for `ask`
  created_at, resolved_at
}

human_input {
  id, account_id, production_id, node_id?, version_id?
  responds_to            // human_output.id it answers — NULLABLE (unsolicited feedback has none)
  kind                   // approve | feedback | answer
  body                   // feedback text / the chosen answer
  created_at
}
```

**`human_output` types** (what to show): **present** a presentable version · **ask** a decision
(optionally with options) · **notify** a heads-up (e.g. "render started, ~$X").

**`human_input` kinds** (what came back): **approve** a version · **feedback** (denies + text →
learns a rule) · **answer** an `ask`.

- A `present` → `approve`/`feedback` is one exchange across the two tables, linked by `responds_to`.
- **`human_input` absorbs the old `feedback` table** — feedback is just input from the human. The
  *learned rule* it produces is a **separate** concern (it persists across productions in
  client-preferences / a learnings store), not a row here.
- **v0 emits `present` only** (+ the matching `approve`/`feedback` inputs). `ask` / `notify` / `answer`
  are schema-supported for when the loop needs them.

## Budget

```
budget { production_id, approved }   // the money-gate flag (render-spend cap)
```

A single flag for v0. Promote to a `cost_events` table only if/when we track real render spend.

## The type registry — files, not tables

Node **behavior** lives in the type registry on disk, resolved by `node.type`. It is **not** DB state.
Each type directory holds a contract (`type.json`) and optional producer instructions.

A type's contract can declare:

| field | meaning |
|-------|---------|
| `checklist: [{id,type,deps,when?,role?}]` | **static** sub-project — expand into these children (`expand`) |
| `planner: true` + `child_type` | **dynamic** sub-project — a planner derives the children (`plan`) |
| `reviews: [{name,kind}]` | the specialist reviewer set; for a parent, its set-level rollup review |
| `advisory_review: true` | rollup review never blocks (agreement types — client approval is the gate) |
| `router: true` | a leaf emitting `VERDICT: <token>` to gate a sibling via `when` |
| `skill` | `"self"` or a skill name — producer instructions |
| `role: "output"` | on a child: the sub-project's deliverable; parent feedback reopens THIS child |
| `when: "<sibling-key> == \| != <value>"` | conditional child — skip unless the sibling's verdict matches |

The three "conclusion processes" from the design (agreement-loop / produce-review / decompose) fall
out of this one mechanism — see spec 02.

## What becomes a table vs code vs file

| thing | home | why |
|-------|------|-----|
| account, node, version, review, human_output, human_input, budget | **SQLite tables** | durable state the loop resumes from; two concurrent writers |
| artifacts (storyboard.md, render, audio) | **files** on the shared volume | big; referenced from the DB by `artifact_path` |
| type contracts + rubrics + producer skills | **files** (type registry) | behavior, the craft/IP; not state |

Full table shapes: spec 03 (`db-schema`). Port interfaces over them: spec 03 (`ports-and-testing`).

## v0 scope seam (spec full, implement flat)

The full recursive model above is the target. **v0 implements it flat:** the root node + leaf
children only — no sub-projects, no dynamic fan-out, no recursion depth. `plan` / `expand` /
sub-project rollup are specified so the schema and seams support them, but the v0 loop walks a single
level. Add the first sub-project (assets is the natural one) when a step earns it. Mark any flat-only
shortcut in code with a `// v0-flat:` comment so the seam is visible.
