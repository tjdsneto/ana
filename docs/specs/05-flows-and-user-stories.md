# Spec 05 — Flows & user stories (thinking doc)

**Status:** draft to react to — narrative companion to specs 01–04, not a new contract. Reads well
right after spec 01. The point is to walk real use cases end-to-end so the data model (nodes,
versions, reviews, `human_output`/`human_input`, budget, account) earns its shape, and to surface
gaps before any code.

> PoC = **single account**. Every flow runs under the one default account (spec 01). The actor "the
> caller" and "the user" are the same person in v0, reached through their client agent.

## Actors

- **Caller / user** — sends a brief, answers questions, approves or gives feedback. One person in v0.
- **Client agent** (`client/agent`) — the thin conversational agent in the user's Claude Code/ChatGPT.
  Talks to the user; via MCP, writes requests + inputs and reads status + outputs. **No craft, no
  subagents.**
- **Engine worker** (`server/engine`) — the loop. Produces, runs reviewers, writes `human_output`,
  resolves on `human_input`. Never talks to the user directly.
- **Specialist reviewers** — independent `claude -p` per rubric; the internal quality gate.
- **Account** — the owning tenant; default + implicit in v0, the seam for multi-tenant later.

## User stories (PoC)

Caller:

1. As a caller, I **request a video from a brief** so production starts without me waiting on the call.
2. As a caller, I **check status** so I know where my video is and what is left.
3. As a caller, I **see a deliverable when it is ready** and **approve it or give feedback**, so the
   result converges on what I want.
4. As a caller, I **answer clarifying questions** during briefing so the agent builds the right thing.
   *(v0: modeled, driven via `present` of the briefing draft; `ask` deferred.)*
5. As a caller, I **approve the render budget** before money is spent, so nothing expensive runs behind
   my back.
6. As a caller, I **give unsolicited feedback** mid-flight ("make it shorter") without waiting to be
   asked, and the system folds it in.

Engine:

7. As the engine, I **produce, then independently self-review**, and only surface work that passed the
   internal gate — the user never sees a draft a reviewer rejected.
8. As the engine, I **learn from feedback** so the next run (and future productions for this account)
   avoids the same miss.
9. As the engine, I **resume after a crash** from the DB — a production in flight is durable state, not
   tied to any open connection.

## Flows

Notation: `node` / `version` / `human_output(type)` / `human_input(kind)`.

### F1 — Happy path, end to end

1. User → client: "make a 15s video about X." Client calls `request_video(brief, session_id)`.
2. Server resolves `defaultAccount()`, inserts the **root node** (`type=video-project`, `status=queued`)
   under that account, returns `production_id`.
3. Worker polls, sees the production, moves it `producing`. Finds the first ready node (`briefing`,
   no deps).
4. Worker produces the briefing draft → internal review (advisory for briefing) → writes
   `human_output(present)` for the briefing packet, node `needs-presentation`.
5. Client `inbox` surfaces the pending output → presents it → user approves. Client writes
   `human_input(approve, responds_to=output)`; server resolves the output, node `approved`.
6. Approval unblocks the next node (`script`, deps briefing). Worker produces → reviewer set passes →
   `present` → approve. Repeat for `moodboard`, `storyboard`, `render`, `polish`, `deliver`.
7. Root rolls up `approved` when its last child approves → production `done`. `get_status` reflects it;
   `get_deliverable` returns the final artifact.

### F2 — Feedback → redo (the loop turning)

Branch from F1 step 5/6 when the user is not happy:

1. User gives feedback on the presented version. Client writes `human_input(feedback, responds_to,
   body="too long, wrong tone")`.
2. Server: version `denied`, output resolved, the **feedback event** stored; a **learned rule** is
   written to the account's preferences/learnings (separate from the event — spec 01).
3. Node back to `pending`. Worker redoes, **fed the prior version + the feedback** (never re-roll
   blind), emits a new `present`.
4. User approves the revision. This is the demo's "mistake → rule → better next version."

### F3 — Internal review fail (invisible to the user) + escalate

Inside a single produce step, before any `human_output`:

1. Worker produces version n → reviewer set runs. One reviewer returns `revise`.
2. Version `needs-work`, node `pending`. **Nothing is presented.** Worker redoes fed the union of the
   failing reviewers' feedback + version n.
3. Repeat up to `MAX_REDOS` (3). If still failing, **escalate**: emit a `present` with a caveat
   ("couldn't fully satisfy the X check") rather than spin forever.
4. The user only ever sees versions that passed the internal gate (or an explicit escalation).

### F4 — Budget gate (money before render)

Before the expensive `render` node runs:

1. Worker reaches `render`, sees `budget.approved = 0`. It emits a heads-up and **waits** —
   `human_output(notify|ask, "render ~$X, approve budget?")`. *(v0: may be a `present`/flag; `ask`
   deferred.)*
2. User approves → client calls `approve_budget(production_id)` → `budget.approved = 1`.
3. Worker proceeds with the render (stubbed in v0 → a text placeholder artifact, zero cost).

### F5 — Briefing agreement-loop (and the spin risk)

The `briefing` node is **agreement-terminal**, not rubric-terminal (spec 02):

1. Brief is thin ("a video about our new feature"). `info-check` router → `VERDICT: insufficient`.
2. `interview` runs (its `when` matched) → `draft` (the `role: output` child) produces the key-points
   packet → `present`.
3. User: "you missed the pricing angle." → `human_input(feedback)` → reopen `draft`, redraft, present
   again. **Uncapped** — the AI reviewer is advisory, client approval is the only terminal.
4. Loops until the user approves the packet.

> ⚠ **Open: F5 can spin.** In v0 with an auto/stubbed client (no real human), an uncapped agreement
> loop never terminates. Even with a human, a flapping approver could loop indefinitely. Candidate
> guard: a soft cap on agreement redraws that **escalates/pauses** (asks the user to decide "proceed
> as-is or keep refining") rather than capping-and-forcing like `MAX_REDOS`. Needs Tiago's call before
> F5 is built — flagged in spec 02 too.

## Gaps these flows surface (for us to think)

1. **The v0 client is a person or a stub?** F1/F5 assume someone approves. For an automated demo we
   need a scripted approver (or `--gate ask` style). Decide how the gate is driven in v0 so flows F1–F5
   are runnable without a human in the loop.
2. **Nudge in v0** (F1 step 5): poll `inbox` vs the headless dialer push. Poll first (spec 02).
3. **Budget gate shape** (F4): a dedicated `notify`/`ask` vs just the `budget` flag + a gate check.
   v0 leans on the flag; the `human_output` framing is the v1 shape.
4. **Learned-rule store** (F2 step 2): where account preferences/learnings physically live (a file in
   the instance vs a table). Design leaves it to client-preferences; confirm when we build the learn
   step.
5. **Agreement-loop termination** (F5): the spin guard above.
