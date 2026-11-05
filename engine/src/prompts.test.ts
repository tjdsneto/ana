import { describe, expect, test } from "vitest"
import { buildHolisticPrompt } from "./prompts.js"

const contract = { type: "video-project" } as Parameters<typeof buildHolisticPrompt>[0]

describe("buildHolisticPrompt", () => {
	test("without feedback, no feedback section and the normal pass/revise instruction stands", () => {
		const p = buildHolisticPrompt(contract, { brief: "a launch video", upstream: [] })
		expect(p).toContain("VERDICT: pass")
		expect(p).not.toMatch(/feedback/i)
	})

	test("with human feedback, threads it in as a directive that forces a revise + reopen", () => {
		const p = buildHolisticPrompt(contract, {
			brief: "a launch video",
			upstream: [],
			feedback: "make the voice more expressive — add audio tags in the script",
		})
		expect(p).toContain("make the voice more expressive — add audio tags in the script")
		// it must tell the critic this is a directive it has to act on, not optional grading context
		expect(p).toMatch(/directive|must|even if.*pass/i)
		expect(p).toContain("REOPEN")
	})
})
