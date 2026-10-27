# Spec 02 — Loop & lifecycle

**Status:** draft to build against. Depends on spec 01 (domain model). This is what the **engine
worker** runs. Derived from `../../docs/lisa/lisa-loop-design.md` §22–27.

> The loop **never presents and never approves.** It produces, reviews internally, and marks the data.
> The client watches the data and handles the human gate. The two never call each other — the DB is
> the only integration point.

## Production lifecycle

A production (the root node) moves through:

```
queued → producing → review → done
```

- **queued** — `request_video` (spec 04) inserted the root; the worker has not picked it up.
- **producing** — the worker is walking the tree, producing and reviewing nodes.
- **review** — one or more versions are `presentable` and waiting on the human gate (via `chat_output`).
- **done** — the root node is approved (completion rolled up from the leaves).

These are the production-level rollup of the per-node / per-version statuses in spec 01.

## The worker: poll → run → write back

The engine worker is a single long-running process (v0 — no queue/broker):

1. **Poll** the DB every `POLL_INTERVAL_MS` for productions with actionable work.
2. For each, find **ready nodes** and **run one dispatch step** per ready node.
3. **Write** results (versions, reviews, status, `chat_output`) back to the DB.
4. Repeat. The loop is **re-runnable**: it reads state fresh each pass and uses version↔subagent
   association (spec 01) to avoid re-dispatching in-flight work.

**A node is ready when:** it is `pending`, every node in its `deps` is `approved`, and its parent is
active. The loop walks the **whole tree** (not just the root's children) — though v0 is flat (spec 01),
so in practice one level.

## Dispatch — resolve `node.type`, then act

Per ready node, resolve the type contract (spec 01) and dispatch:

| condition | action |
|-----------|--------|
| `when` is present and **false** | **skip** — mark done, counts as satisfied, gates nothing |
| static `checklist` | **expand** — create the declared child nodes, then the node waits on them *(v0-flat: not exercised)* |
| `planner: true` | **plan** — producer emits a manifest; create one child per entry *(v0-flat: not exercised)* |
| `router: true` | **produce a verdict** — run producer, store `VERDICT: <token>`, auto-approve (gates a sibling's `when`) |
| otherwise | **leaf** — produce → specialist reviewer set → gate |
| parent whose children are all done | **set-level review → roll up** (artifact = its `output` child's, for a static sub-project) |

## The leaf path — two gates

Every leaf passes an **internal quality gate** before the human ever sees it.

```
produce (version: producing)
  → independent specialist reviewer set (version: in-review)      // spec 01: craft/coverage/consistency
    → ALL pass → version: presentable, node: needs-presentation   // hand to the client
    → any revise → version: needs-work, node: pending → REDO      // never shown to the user
```

Redo rules (these are load-bearing — a real run without them regenerated blind and took 15 tries):

- **The redo is fed the reviewers' feedback + the prior version.** The producer *revises*; it never
  re-rolls blind. Feed the **union** of the still-failing reviewers' feedback.
- **Capped at `MAX_REDOS` (default 3).** After the cap, **escalate to the human** — emit a `present`
  with a caveat rather than spinning.
- **Producer ≠ any reviewer.** A doer grading itself is a claim, not a check.

> **Convergence note (observed):** splitting one monolithic reviewer into narrow single-axis
> specialists is what made the loop converge — a monolithic reviewer rotates which axis it nitpicks
> and never passes. Keep reviewers narrow.

## Conclusion processes — three shapes, one mechanism

The design's three "processes" are not special cases in code; they fall out of the type contract:

| process | types | how it concludes |
|---------|-------|------------------|
| **agreement-loop** | briefing | expandable + `advisory_review` + feedback reopens the `role: output` child. Terminal = **client approval** (the AI reviewer is advisory only, never blocks), with a **per-actor back-and-forth cap → escalate** (below) so it can't spin. |
| **produce-review** | script, moodboard, storyboard, render, polish, deliver | leaf: produce → reviewer set → present. Terminal = all reviewers pass (or MAX_REDOS escalate) then client approve/feedback. |
| **decompose** | assets, audio | `planner` fan-out → each child produce-review → set-level review → roll up. *(v0-flat: deferred.)* |

**Why briefing differs:** its input may be a full prompt or just an idea. It explores and asks until
it has good-enough info, then presents the extracted key points for agreement. It must end with an
**approved** artifact, so its terminal is *agreement*, not a craft rubric.

### Agreement cap — stop the spin without forcing a result

The agreement loop (F5, spec 05) is agreement-terminal, so `MAX_REDOS` does **not** apply — capping and
force-passing would ship a briefing the user never agreed to. Instead cap the **back-and-forth**, then
**escalate** rather than decide:

- Count the agreement rounds (each `present` → `feedback` → redraw) on the agreement node. When the
  count reaches the **cap for this production's `actor_kind`** (spec 01), the loop stops auto-redrawing
  and emits an `options` `chat_output`: `["Proceed as-is","Keep refining"]`.
- **The actor answers the escalation — the engine never auto-decides.** "Proceed as-is" → approve the
  current draft, move on. "Keep refining" → reset the counter and continue (one more cap window).
- **The cap is the only thing `actor_kind` changes.** `human` → higher soft cap (`AGREEMENT_MAX_ROUNDS_HUMAN`,
  default 5); `agent` → lower cap (`AGREEMENT_MAX_ROUNDS_AGENT`, default 2). The stubbed/headless agent
  answers the escalation automatically ("Proceed as-is"), so automated runs always terminate — no
  special path in the engine, just a lower number + an auto-answer on the client side.
- `autonomy_lever = high` reduces rounds independently (it asks less up front), so the cap is a backstop,
  not the primary damper.

## Completion rolls up via approval

- A **leaf** completes when one of its versions is `approved`.
- A **sub-project** completes when its checklist completes → that assembles a **version of the
  parent**, which is presented and approved → the parent completes → up the tree to the root.
- When the **root** is approved, the production is `done`.

## Human gate — via `chat_output`, never inline

When a version becomes `presentable`, the loop writes a **`present` `chat_output`** (spec 01) and
stops. It does not present and does not wait. The client (spec 04) reads the pending `chat_output`
queue, presents to the user, and writes the verdict back as a `chat_input` (`responds_to` = that
output):

- **approve** (`chat_input.kind = approve`) → version + node `approved`; the `chat_output` resolves;
  roll up.
- **feedback** (`chat_input.kind = feedback`) → version `denied`, the feedback event stored, **learn a
  rule** (the rule persists separately — spec 01), node back to `pending` → the loop redoes, fed that
  feedback.

Two feedback sources, kept distinct: the internal reviewer's `revise` → silent redo; the user's
`chat_input` feedback → a learned rule + redo.

## The nudge (how the client hears about a `present`)

MCP cannot push (see the design §16). The **dashboard** (spec 06) does get live push — the worker's
`NOTIFY presentable` → the dashboard API's `LISTEN` → a WebSocket to the browser (spec 03). A pure MCP
`client/agent` still **polls** the pending `chat_output` queue (`inbox`) or uses an optional headless
dialer. v1: a background executor pushes to a notification channel. Either way, **the loop only marks
the data; the client/dashboard presents.**

## Ports this loop depends on (spec 03)

The loop talks only to interfaces, never concretes: `Store` (all DB access), `SubagentRunner` (spawns
`claude -p`; a fake returns canned output), `RenderClient` (stubbed first), `Clock` / `IdGen`
(deterministic). So the whole loop unit-tests with no DB, no network, no `claude -p`.
