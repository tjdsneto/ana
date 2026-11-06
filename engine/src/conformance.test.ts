// Conformance validator tests — the deterministic schema gate for planner output (0018). Pure, no DB.
// A planner emits a JSON artifact; this validates it against the step's JSON Schema and returns the
// concrete violations (missing required field, value outside an enum, wrong shape) so the loop can
// feed them back to the same model as a redo directive instead of throwing (the pre-0018 hard fail).

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { validateJsonArtifact } from "./conformance.js"

// A trimmed plan-scenes schema: an array of {name, brief, method(enum)} — the real contract that the
// generic {name,brief} fan-out parse silently drops `method` from.
const SCENE_SCHEMA = {
	type: "array",
	minItems: 1,
	items: {
		type: "object",
		additionalProperties: false,
		required: ["name", "brief", "method"],
		properties: {
			name: { type: "string", minLength: 1 },
			brief: { type: "string", minLength: 1 },
			method: { type: "string", enum: ["authored-composite", "edit-footage", "motion-graphics"] },
		},
	},
}

describe("validateJsonArtifact", () => {
	it("passes a conforming bare JSON array", () => {
		const text = JSON.stringify([{ name: "hook", brief: "open on the map", method: "authored-composite" }])
		const r = validateJsonArtifact(text, SCENE_SCHEMA)
		expect(r.ok).toBe(true)
		expect(r.errors).toEqual([])
	})

	it("extracts and passes a fenced ```json block", () => {
		const text = "Here is the plan:\n```json\n" + JSON.stringify([{ name: "a", brief: "b", method: "edit-footage" }]) + "\n```\n"
		expect(validateJsonArtifact(text, SCENE_SCHEMA).ok).toBe(true)
	})

	it("fails and names a missing required field", () => {
		const text = JSON.stringify([{ name: "hook", brief: "no method here" }])
		const r = validateJsonArtifact(text, SCENE_SCHEMA)
		expect(r.ok).toBe(false)
		expect(r.errors.join(" ")).toMatch(/method/)
		expect(r.errors.join(" ").toLowerCase()).toMatch(/required/)
	})

	it("fails and names a value outside the enum", () => {
		const text = JSON.stringify([{ name: "hook", brief: "bad method", method: "whole-clip-generative" }])
		const r = validateJsonArtifact(text, SCENE_SCHEMA)
		expect(r.ok).toBe(false)
		expect(r.errors.join(" ")).toMatch(/method/)
	})

	it("fails when the output is not valid JSON", () => {
		const r = validateJsonArtifact("I could not produce a plan, sorry.", SCENE_SCHEMA)
		expect(r.ok).toBe(false)
		expect(r.errors.length).toBeGreaterThan(0)
	})

	it("fails when an array is required but an object is given", () => {
		const text = JSON.stringify({ name: "hook", brief: "b", method: "edit-footage" })
		expect(validateJsonArtifact(text, SCENE_SCHEMA).ok).toBe(false)
	})
})

// Drift guard: the real planner schemas wired into the engine (brainstorm/storyboard/build-scenes via
// plan-scenes) must accept their own committed example. A schema edit that diverges from the canonical
// shape — or an example that no longer conforms — fails here before it can false-redo live productions.
describe("real planner schemas accept their committed example (drift guard)", () => {
	const skills = fileURLToPath(new URL("../../craft/video-production/.claude/skills/", import.meta.url))
	for (const step of ["brainstorm", "storyboard", "plan-scenes"]) {
		it(`${step}: example.json conforms to schema.json`, () => {
			const schema = JSON.parse(readFileSync(`${skills}${step}/schema.json`, "utf8")) as object
			const r = validateJsonArtifact(readFileSync(`${skills}${step}/example.json`, "utf8"), schema)
			expect(r.errors).toEqual([])
			expect(r.ok).toBe(true)
		})
	}
})
