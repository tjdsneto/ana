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

## What introducing `.ana/` creates

- `.ana/settings.json` — `{"version": 1}` until real properties exist. A to-do list and other ana-project behavior will be properties here. Do not invent keys.
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
