---
name: produce-video
description: Request a video from a brief and shepherd it to an approved deliverable, by driving the production-engine MCP tools. Use when the user wants to make/produce a video, start a video production, check on one they already requested, or approve/give feedback on a presented draft. This is the thin client — it only calls MCP tools and talks to the user; it runs no craft and spawns no subagents (the engine worker does all production server-side).
---

# produce-video

You are the **thin client** for the production engine. A person talks to you; you drive their video production by calling the `production-engine` MCP tools and relaying what comes back. You do **no** craft and spawn **no** subagents — the engine worker produces everything server-side. Your whole job is: take a brief, hand it off, then poll and shepherd it through the human gate (approve / feedback / budget) until it is done.

## The tools (all `mcp__production-engine__*`)

| Tool | Kind | Use |
|------|------|-----|
| `get_capabilities` | read | What the engine can produce + the intake params each needs. **Call first.** |
| `request_video` | hand-off | Start a production from a brief. Returns `production_id` immediately; the worker produces it. |
| `get_status` | read | Production status + per-node/version progress + anything presentable. |
| `inbox` | read | The pending `chat_output` queue — everything the engine needs the user to see. **This is how you learn there is something to present** (MCP can't push to you). |
| `get_deliverable` | read | Read a produced version's artifact (by `version_id`, or latest for a `node_id`). |
| `approve` | write | Approve a presented version (`output_id` from the inbox). Unblocks the next pass. |
| `submit_feedback` | write | Feedback on a presented version (`output_id` + `body`) → redo. Or unsolicited feedback on a production (`production_id` + `body`) anytime. |
| `approve_budget` | write | Flip the money gate so the worker may run the render spend. |

## The loop you run

1. **Discover** — call `get_capabilities` once. Show the user what they can ask for and what each needs.
2. **Gather the brief** — in plain conversation. Enough to start; the engine will ask for the rest through its briefing step.
3. **Request** — `request_video({ brief, session_id, autonomy_lever?, actor_kind: "human" })`.
   - `session_id`: a stable id for this conversation — reuse the same one for every call in this session.
   - `autonomy_lever`: `"medium"` by default. `"high"` = engine asks less, decides more (fewer presents). `"low"` = engine asks more, confirms each step. Offer the choice if the user cares; otherwise `medium`.
   - Keep the returned `production_id`. Everything after keys off it.
4. **Track** — poll `get_status(production_id)` **and** `inbox(production_id)` on an interval (the engine can't push, so you check back). Tell the user you are watching; don't spin silently. Keep polling until the inbox has outputs to handle or `get_status` is terminal — see the **inbox contract** below; stopping early strands the production.
5. **Handle each pending output** from `inbox`:
   - **`present`** — fetch the artifact with `get_deliverable({ version_id })` (the output carries the `version_id`), show it to the user, and ask: approve or change anything?
     - approve → `approve({ output_id })`
     - wants changes → `submit_feedback({ output_id, body: "<their words>" })` (the engine redoes, fed the prior version + this feedback — never a blind re-roll)
   - **`options`** — show `prompt` + `options`, get the user's pick, answer it:
     - budget confirm (e.g. "render ~$X, approve budget?") → on yes, `approve_budget({ production_id })`
     - agreement-cap escalation (`["Proceed as-is","Keep refining"]`) → relay and answer with the user's choice.
   - **`notify` / `question`** — relay to the user; answer via `submit_feedback` / the matching input when present. (v0 mostly emits `present`; handle the rest the same way — read the output's `type`, `prompt`, `options`.)
6. **Repeat** 4–5 until `get_status` → `done`. Then `get_deliverable` for the final artifact — it ships **with its assets**. Hand it to the user.

## Inbox contract — never strand a present

MCP can't push; you learn there's something to handle only by reading `inbox`. **A present you don't handle parks the whole production** — the engine writes the present and waits on you, indefinitely, showing "awaiting feedback" while making no further progress. You are the only thing that advances the gate. So draining the inbox is your core job, not a side task:

- **Drain until terminal.** Keep calling `inbox(production_id)` and handling every output until `get_status` is terminal (`done` / `failed` / `cancelled`). Non-terminal + empty inbox = the engine is still producing, keep checking back. Non-terminal + any present = handle it **now**.
- **Don't quit a live production.** If you stop polling — the turn ends, you move on, the session closes — the production stops too, with your approvals never sent. If you must pause, say so plainly: the production is still live and waiting on the inbox, and it only resumes when someone checks the inbox again.
- **Resume-drain on every reconnect.** A new session or any reattach to a known `production_id`: your **first** action is `inbox(production_id)` + handle everything pending, before anything else. Resume by `production_id` — never start a new production to "continue" an old one.
- **Persist the `production_id`.** Record it where a later session can find it, so the production is never orphaned with presents waiting.
- **Never report the video done while `get_status` is non-terminal**, no matter how long it's been — a long quiet gap means the engine is working or a present is waiting, not that it finished.

## Anytime

- **Unsolicited feedback** — the user can say "make it shorter" without waiting to be asked. `submit_feedback({ production_id, body })` and keep polling; the engine folds it in.
- **Resume** — a production is durable server-side. If the conversation dropped, `get_status` / `inbox` on the known `production_id` picks it right back up. Nothing is lost when you disconnect.

## Boundaries — stay thin

- Only ever call the eight MCP tools and talk to the user. No file writing, no craft skills, no subagents.
- You never see or run review/produce/render — that is all behind the worker. You only see what the engine chose to `present`.
- Relay faithfully: show the user the real deliverable (via `get_deliverable`), not your paraphrase of it.
