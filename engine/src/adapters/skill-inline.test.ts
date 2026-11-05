// skill-inline tests — the pure cross-engine skill-delivery logic used by the codex/gemini adapters.
// No spawning, no CLI: just slug mapping, SKILL.md reading, and prompt assembly.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { composePrompt, inlineSkillDirective, skillSlug } from "./skill-inline.js"

function craftRootWithSkill(slug: string, body: string): string {
	const root = mkdtempSync(join(tmpdir(), "craft-"))
	const dir = join(root, ".claude", "skills", slug)
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, "SKILL.md"), body)
	return root
}

describe("skillSlug", () => {
	it("returns undefined for no skill, self, and reviewer labels", () => {
		expect(skillSlug(undefined)).toBeUndefined()
		expect(skillSlug("self")).toBeUndefined()
		expect(skillSlug("review:craft")).toBeUndefined()
	})
	it("maps a skill name to its dir slug (colons → dashes)", () => {
		expect(skillSlug("storyboard")).toBe("storyboard")
		expect(skillSlug("build:card")).toBe("build-card")
	})
})

describe("inlineSkillDirective", () => {
	it("inlines the SKILL.md body with a follow-exactly directive", () => {
		const cwd = craftRootWithSkill("storyboard", "# Storyboard\nDo the thing.")
		const out = inlineSkillDirective("storyboard", cwd)
		expect(out).toContain("THE SKILL YOU MUST FOLLOW (storyboard)")
		expect(out).toContain("Do the thing.")
	})
	it("returns undefined when there is no skill to inline", () => {
		expect(inlineSkillDirective("self", "/tmp")).toBeUndefined()
		expect(inlineSkillDirective("review:craft", "/tmp")).toBeUndefined()
	})
	it("throws loud when a named skill cannot be read", () => {
		const cwd = mkdtempSync(join(tmpdir(), "empty-"))
		expect(() => inlineSkillDirective("storyboard", cwd)).toThrow(/not found for inlining/)
	})
})

describe("composePrompt", () => {
	it("orders skill, systemPrompt, then the task prompt, dropping empties", () => {
		const cwd = craftRootWithSkill("storyboard", "SKILLBODY")
		const out = composePrompt("storyboard", "SYS", "TASK", cwd)
		expect(out.indexOf("SKILLBODY")).toBeLessThan(out.indexOf("SYS"))
		expect(out.indexOf("SYS")).toBeLessThan(out.indexOf("TASK"))
	})
	it("is just the prompt when there is no skill and no systemPrompt", () => {
		expect(composePrompt("self", undefined, "TASK", "/tmp")).toBe("TASK")
	})
})
