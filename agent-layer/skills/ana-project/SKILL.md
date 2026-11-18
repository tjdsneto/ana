---
name: ana-project
description: Use when a project has a .ana directory, or when Tiago says "make this an ana project", "introduce ana here", or "add the ana protocol". The .ana directory marks an ana project. Its settings, learnings, and mistakes tell every agent how to treat that project.
---

# ana-project

Owned by `~/projects/ana/agent-layer/`.

A project is an ana project when it has a `.ana/` directory. That directory is the marker. Codex, Cursor, and Claude Code treat the project the same way whether the session is driven or unattended.

Do not edit a versioned company `CLAUDE.md` to record this. Personal notes stay in `.ana/`.

## On every session in an ana project

Read, when the file exists:

- `.ana/settings.json` — properties for this ana project. Obey them.
- `.ana/learnings.md` — the story of each lesson.
- `.ana/mistakes.json` — the same lessons, counted. The highest counts are binding.
- `.ana/memory/MEMORY.md` — Claude auto-memory index. Open a topic file only when the index says it is relevant.

Claude Code also injects the top mistakes through `inject-mistakes` at session start. Cursor and Codex do not, so the read above is what reaches them.

## Learnings and mistakes

A learning and a mistake are one event. An approach failed, another was tried, and the right approach is now known. Record it when the lesson is non-obvious: a tool quirk, a flag, an environment behavior, or a convention of this codebase. Skip typos and anything a developer would already know.

Record that event before you continue, in both files, under the same slug.

`.ana/learnings.md` is the story, in markdown, so a person can read what was tried and why the right approach works. Append:

```markdown
## YYYY-MM-DD — short description
**Project:** `<cwd>`
**Task:** one sentence

**[slug]**: What was tried first and why it failed. What the correct approach is and why it works.
```

A lesson about this codebase goes in `.ana/learnings.md`. A lesson that applies to any project goes in `~/.claude/learnings.md`.

`.ana/mistakes.json` is the counter. It is JSON so a hook can match a slug, add the project count to the global count, and rank the results. Each entry has `slug`, `text`, `count`, `first_seen`, and `last_seen`. `text` is one sentence: the wrong approach and why it failed, then the correct approach. The same slug increments `count` and refreshes `text` and `last_seen`. A new slug starts at 1. Project mistakes go in `.ana/mistakes.json`. Mistakes that apply to any project go in `~/.claude/mistakes.json`.

The ranked counts constrain the work. Do the task the way the highest entry's `text` says. Open the learning with the same slug when you need the story of what was tried.

## Todo, done, and daily notes

These files are separate from the session-start read. Open one when an occasion below applies. Each file is created on the first write.

`.ana/todo.md` is the personal open list. It stays even when the project has a GitHub issue tracker. A GitHub issue can be for other people. A todo is one we manage ourselves. Each line is the day it was added, the item, and why. Take the day from `date +%Y-%m-%d`. Never infer it. A line may link a ticket. The link does not replace the line. The same wording already on the list is not added again. Adding a line does not write a daily note.

Groups are `##` headings. Use one when a split helps, and name it for the split (priority, area, or another name). When groups exist, the line under `# Todo` is the count of each group, updated in the same edit that adds, moves, or removes a line. A flat list has no count line. Put a new item in the group that was named, or the group it belongs to. Leave a flat list flat until a split is useful. After the last item is removed, keep the `# Todo` heading.

`.ana/done.md` is finished todo items. Put the newest line directly under the heading, above older lines. Leave older lines as they are. A GitHub issue that was never a todo does not get a line. A todo that linked an issue still gets a line, and the link stays on it.

`.ana/notes/YYYY-MM-DD.md` is the day's record. The file name and the heading are that date, from `date +%Y-%m-%d`. New bullets go at the end. Worth a line: a decision, an outcome, a blocker, a pick, or a finish.

Suggest a GitHub issue when `origin` is a GitHub remote and someone else might need the ticket. File it only after a yes, then add the URL to the todo line. When the item needs more than a line and should stay personal, write `.ana/issues/NNNN-short-kebab.md`. Four digits. The next number is one higher than the highest `NNNN` already there, including `closed-` and `deferred-` files. Keep `index.md` in the same edit: Open, Deferred, and Closed tables with number, title, severity, and area. Body fields, omitting any that do not apply: Summary, Severity, Area, Repro, Root cause, Impact, Suggested fix, Status, Found via. Summary is the why. Found via is the source. Status is `open`, `in-progress`, `deferred`, or `closed`. Close by renaming to `closed-NNNN-….md`, setting Status closed, and moving the index row. Defer by renaming to `deferred-NNNN-….md`, setting Status deferred with the reason and what would un-defer it, and moving the index row. Reopen the same work by renaming the file back and adding a todo line. Personal notes stay in `.ana/`.

| Occasion | What to do |
|---|---|
| Work is named and is not being done now | Add one dated line to `todo.md`, with why. Refresh the count line when groups exist. Suggest GitHub, or write `.ana/issues/`, only under the rules above |
| A todo is picked | Leave the line in its group. Append `- Picked: item` to today's note. If that Picked line is already there today, do not add another. A local ticket's status becomes `in-progress` |
| A todo is finished | Remove the line and refresh the count. Insert the dated line at the top of `done.md`. Append `- Done: item` to today's note. Close a linked local ticket, or run `gh issue close` on a linked GitHub issue. The todo still goes to `done.md` |
| Work finishes that was never a todo | Append one factual line to today's note. Leave `done.md` unchanged |
| A decision, outcome, or blocker is worth keeping | Append one factual line to today's note |
| A todo is consciously not-now | Remove the line. Append `- Deferred: item — why` to today's note. Defer a local ticket with the `deferred-` rename |

Read `todo.md` before changing it, when choosing work, or when asked what is open. Read today's note when continuing today's work, or when asked what happened today. Read another day only when that day is the subject. Read `done.md` before inserting a finish, or when asked what we finished. Read a linked issue when the line has one, or the edit needs the body. Read `issues/index.md` when filing, closing, or deferring a local ticket.

## What introducing `.ana/` creates

- `.ana/settings.json` — `{"version": 1}` until real properties exist. Do not invent keys.
- `.ana/learnings.md`
- `.ana/mistakes.json` — creating it opts the project in. The Claude stop hook then writes project-scoped mistakes here.
- `.ana/memory/` — Claude's auto-memory, via `autoMemoryDirectory` in `.claude/settings.json` or `.claude/settings.local.json`. Claude does not discover `.ana/` by itself.
- A SessionStart hook that runs `inject-mistakes`.
- `tmp/` where the project is a git repo, gitignored.
- On a personal wrapper with no `CLAUDE.md` yet, a personal stub. An existing `CLAUDE.md` is never overwritten.

## Layouts

| Layout | When | Claude hook config | `.ana/` itself |
|---|---|---|---|
| **wrapper** | cwd is not a git repo | `.claude/settings.json` | unversioned |
| **local** | cwd is a git repo | `.claude/settings.local.json` | `.ana/` and `tmp/` added to the repo `.gitignore` |
| **wrapper-git** | personal wrapper under your own git | `.claude/settings.json` | tracked. Pass `--layout wrapper-git`. Child repo dirs and `tmp/` are ignored. |

`auto` picks wrapper or local. `wrapper-git` does not add a remote. Pushing company-derived notes to a personal GitHub account needs an AM SOP decision first.

## Run it

```bash
python3 "$HOME/projects/ana/agent-layer/scripts/apply-ana-project" --dry-run
python3 "$HOME/projects/ana/agent-layer/scripts/apply-ana-project"
```

Idempotent. Re-running reports "already applied" and changes nothing.

## Scripts

| Script | Role |
|---|---|
| `agent-layer/scripts/apply-ana-project` | create `.ana/` and point Claude at it |
| `agent-layer/scripts/inject-mistakes` | print the top mistakes at session start |
| `agent-layer/scripts/extract-learnings` | Stop hook. Project entries go to `.ana/`. Cross-project entries stay in `~/.claude/`. |
| `agent-layer/plugins/` | Claude, Codex, and Cursor plugins. `install` enables them. Each Stop hook runs `extract-learnings` |
