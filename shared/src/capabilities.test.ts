import { describe, expect, it } from "vitest"
import { loadCapabilities } from "./capabilities.js"

const TYPES_DIR = new URL("../../engine/types", import.meta.url).pathname

describe("loadCapabilities", () => {
	it("returns the rootCapable types with their intake schema, excluding plumbing", () => {
		const caps = loadCapabilities(TYPES_DIR)
		const types = caps.map((c) => c.type)
		// the offerable capabilities (rootCapable: true)
		expect(types).toEqual(expect.arrayContaining(["card", "clip", "scene", "video-project"]))
		// internal plumbing is never offered
		for (const p of ["briefing", "moodboard", "storyboard", "build", "build-scenes", "assemble", "polish", "final-review"]) {
			expect(types).not.toContain(p)
		}
		// each capability carries its intake schema (video-project needs a brief)
		const vp = caps.find((c) => c.type === "video-project")
		expect(vp?.inputs?.some((i) => i.name === "brief" && i.required)).toBe(true)
		// the type's description is surfaced in the catalog
		expect(vp?.description).toMatch(/full-pipeline production/)
	})

	it("returns [] for a missing types dir", () => {
		expect(loadCapabilities("/no/such/dir")).toEqual([])
	})
})
