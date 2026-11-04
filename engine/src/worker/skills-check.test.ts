import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { TypeRegistry } from "../typereg.js"
import { missingSkills, referencedSkills } from "./skills-check.js"

const types = TypeRegistry.fromContracts([
	{ type: "video-project", name: "VP", checklist: [{ id: "brainstorm", type: "brainstorm", deps: [] }] },
	{ type: "brainstorm", name: "Brainstorm", skill: "brainstorm", reviews: [{ name: "q", kind: "craft", skill: "review-board-quality" }] },
	{ type: "briefing", name: "Briefing", skill: "self", reviews: [{ name: "c", kind: "coverage" }] }, // "self" = inline; a kind-only review has no skill dir
])

describe("0008 — worker skills self-check", () => {
	it("collects referenced producer + reviewer skills, skipping 'self' and kind-only reviews", () => {
		expect(referencedSkills(types)).toEqual(["brainstorm", "review-board-quality"])
	})

	it("reports referenced skills that have no SKILL.md under the skills dir", () => {
		const dir = mkdtempSync(join(tmpdir(), "skills-"))
		mkdirSync(join(dir, "brainstorm"), { recursive: true })
		writeFileSync(join(dir, "brainstorm", "SKILL.md"), "x")
		// review-board-quality dir absent
		expect(missingSkills(types, dir)).toEqual(["review-board-quality"])
	})

	it("reports every referenced skill missing when the dir is empty (the stale-mount case)", () => {
		const dir = mkdtempSync(join(tmpdir(), "skills-empty-"))
		expect(missingSkills(types, dir)).toEqual(["brainstorm", "review-board-quality"])
	})
})
