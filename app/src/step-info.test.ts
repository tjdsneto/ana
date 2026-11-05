import { describe, expect, test } from "vitest"
import { stepDescription } from "./step-info.js"

describe("stepDescription", () => {
	test("returns the fixed description for a known step", () => {
		expect(stepDescription("briefing")).toMatch(/extracts and confirms the request's key points/)
		expect(stepDescription("build-voice")).toMatch(/voiceover and its word timing/)
	})
	test("null for an unknown type", () => {
		expect(stepDescription("no-such-type")).toBeNull()
	})
})
