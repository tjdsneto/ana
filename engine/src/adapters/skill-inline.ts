// skill-inline — deliver a craft skill to an engine that has no claude-style `/slash` skill seam.
//
// The claude adapter maps `input.skill` → a `/<slug>` slash command that claude resolves from
// `<cwd>/.claude/skills/<slug>/SKILL.md`. Codex and Gemini have their own, different skill/extension
// systems and do NOT resolve claude-code's skills, so for those engines the skill is delivered by
// INLINING its `SKILL.md` body into the prompt — the same approach the host-side competition harness
// (`tmp/competition/run.py`) uses to deliver a skill identically across engines. Files the SKILL.md
// references (CRAFT-BAR, schemas, tool paths) are left for the agent to read via its file tools at
// `cwd`, exactly as the claude path relies on the skill pulling them in.
//
// Returns undefined when there is nothing to inline: `self` produces inline with no skill, and a
// reviewer label (`review:<kind>`) carries no skill directive — reviewers judge from the rubric that
// the loop already put in the prompt.

import { readFileSync } from "node:fs"
import { join } from "node:path"

// The type-registry skill name → the on-disk skill-dir slug. `storyboard` → `storyboard`;
// `review:craft` and `self` → undefined (no skill). Mirrors the claude adapter's mapping.
export function skillSlug(skill?: string): string | undefined {
	if (!skill || skill === "self" || skill.startsWith("review:")) return undefined
	return skill.replace(/:/g, "-")
}

// The directive prepended to the prompt for codex/gemini: the SKILL.md body plus an instruction to
// follow it exactly. Throws if the skill can't be read — the worker already asserts every referenced
// skill resolves at boot (0008), so a miss here is a real misconfiguration and should fail loud.
export function inlineSkillDirective(skill: string | undefined, cwd: string | undefined): string | undefined {
	const slug = skillSlug(skill)
	if (!slug) return undefined
	const path = join(cwd ?? process.cwd(), ".claude", "skills", slug, "SKILL.md")
	let body: string
	try {
		body = readFileSync(path, "utf8")
	} catch {
		throw new Error(`skill "${slug}" not found for inlining at ${path} (craft skills must be mounted at <cwd>/.claude/skills)`)
	}
	return [
		"Complete this task by following the skill below exactly. It is the method you MUST use; do not produce the deliverable any other way.",
		`=== THE SKILL YOU MUST FOLLOW (${slug}) ===`,
		body.trim(),
		"=== END SKILL ===",
	].join("\n\n")
}

// Assemble the full stdin prompt for an inlining engine: the skill directive (if any), then any
// caller systemPrompt, then the task prompt. One string because codex/gemini have no separate
// system-prompt channel like claude's `--append-system-prompt`.
export function composePrompt(skill: string | undefined, systemPrompt: string | undefined, prompt: string, cwd: string | undefined): string {
	return [inlineSkillDirective(skill, cwd), systemPrompt, prompt].filter(Boolean).join("\n\n")
}
