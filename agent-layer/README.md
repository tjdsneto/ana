# agent-layer

Owns the ana-project protocol. A `.ana/` directory in some other project marks that project as an ana project. Codex, Cursor, and Claude Code learn how to treat it from the skill in this folder.

The video engine in this repo does not read `.ana`.

| Path | What |
|---|---|
| `install` | enable the learnings plugins |
| `.claude-plugin/marketplace.json` | Claude's marketplace. Lists `plugins/claude` only |
| `.agents/plugins/marketplace.json` | Codex's marketplace. Lists `plugins/codex` only |
| `plugins/claude/` | Claude plugin. Stop hook, plus a link to the skill |
| `plugins/codex/` | Codex plugin. Stop hook, plus a link to the skill |
| `plugins/cursor/` | Cursor plugin. Stop hook, plus a link to the skill |
| `skills/ana-project/SKILL.md` | the one skill text. Each plugin's `skills/ana-project` points here |
| `scripts/apply-ana-project` | create `.ana/` in a project and point Claude at it |
| `scripts/inject-mistakes` | session-start reader |
| `scripts/extract-learnings` | the script the three plugins run |
| `scripts/install-plugins` | enable the plugins and remove the old global Stop command |

`install` is the publisher. Run it from this repo.

`.ana/settings.json` holds properties for that project. Learnings and mistakes for the project live beside it. A to-do list and further behavior are future properties, not separate protocols.

The naming rule in this repo's `CLAUDE.md` does not apply inside `agent-layer/`. This folder is allowed to say `.ana`.
