// 0008: a worker's `claude -p` subagents resolve craft skills from <craftRoot>/.claude/skills/<name>/.
// A stale or empty bind mount serves an EMPTY dir, so a skill-required node fails three layers down
// with "Unknown skill" and (via 0001) the production strands. This module lets the worker assert at
// boot that every skill the loaded type registry references actually resolves, and fail loud instead.

import { existsSync } from "node:fs"
import { join } from "node:path"
import type { TypeRegistry } from "../typereg.js"

// The skills a worker subagent must be able to resolve: each contract's producer skill (other than the
// inline "self") plus every declared reviewer skill. A kind-only review (no `skill`) uses a generic
// lens with no skill dir, so it is not required here.
export function referencedSkills(types: TypeRegistry): string[] {
	const names = new Set<string>()
	for (const c of types.all()) {
		if (c.skill && c.skill !== "self") names.add(c.skill)
		for (const r of c.reviews ?? []) if (r.skill) names.add(r.skill)
	}
	return [...names].sort()
}

// The directory the subagent resolves skills from: <craftRoot>/.claude/skills. craftRoot defaults to
// the worker's cwd (in the container, /repo, where the skills bind mount lands).
export function skillsDirFor(craftRoot: string | undefined): string {
	return join(craftRoot ?? process.cwd(), ".claude", "skills")
}

// Referenced skills with no <skillsDir>/<name>/SKILL.md — i.e. the ones that would fail "Unknown skill".
export function missingSkills(types: TypeRegistry, skillsDir: string): string[] {
	return referencedSkills(types).filter((name) => !existsSync(join(skillsDir, name, "SKILL.md")))
}
