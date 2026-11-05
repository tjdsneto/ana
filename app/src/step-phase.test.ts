import { describe, expect, test } from "vitest"
import { siblingIndex, stepPhase } from "./step-phase.js"

const v = (status: string, sub?: string) => ({
	version: { status, subagent: sub ? { status: sub } : null },
})

describe("stepPhase", () => {
	test("pending leaf with no version is waiting (blocked on deps)", () => {
		expect(stepPhase({ node: { status: "pending" }, versions: [] })).toBe("waiting")
	})

	test("ready leaf with no version is queued (no worker yet)", () => {
		expect(stepPhase({ node: { status: "ready" }, versions: [] })).toBe("queued")
	})

	test("in-progress leaf with no version is producing (claimed, drafting)", () => {
		expect(stepPhase({ node: { status: "in-progress" }, versions: [] })).toBe("producing")
	})

	test("producing version with a running subagent is producing", () => {
		expect(stepPhase({ node: { status: "in-progress" }, versions: [v("producing", "running")] })).toBe("producing")
	})

	test("producing version whose subagent is done is reviewing (draft made, reviewers next)", () => {
		expect(stepPhase({ node: { status: "in-progress" }, versions: [v("producing", "done")] })).toBe("reviewing")
	})

	test("in-review version is reviewing", () => {
		expect(stepPhase({ node: { status: "in-progress" }, versions: [v("in-review", "done")] })).toBe("reviewing")
	})

	test("needs-work version is revising", () => {
		expect(stepPhase({ node: { status: "in-progress" }, versions: [v("needs-work", "done")] })).toBe("revising")
	})

	test("approved node is approved", () => {
		expect(stepPhase({ node: { status: "approved" }, versions: [v("approved", "done")] })).toBe("approved")
	})

	test("failed node is failed", () => {
		expect(stepPhase({ node: { status: "failed" }, versions: [] })).toBe("failed")
	})

	test("uses the latest version, not the first", () => {
		expect(
			stepPhase({ node: { status: "in-progress" }, versions: [v("needs-work", "done"), v("producing", "running")] }),
		).toBe("producing")
	})
})

describe("siblingIndex", () => {
	const sibs = [
		{ id: "a", type: "card", position: 0 },
		{ id: "b", type: "card", position: 1 },
		{ id: "c", type: "card", position: 2 },
		{ id: "sb", type: "storyboard", position: 3 },
	]

	test("numbers a card 1-based among same-type siblings, in position order", () => {
		expect(siblingIndex("a", sibs)).toBe(1)
		expect(siblingIndex("b", sibs)).toBe(2)
		expect(siblingIndex("c", sibs)).toBe(3)
	})

	test("a lone sibling of its type gets no number", () => {
		expect(siblingIndex("sb", sibs)).toBeNull()
	})

	test("orders by position, not array order", () => {
		const shuffled = [
			{ id: "c", type: "card", position: 2 },
			{ id: "a", type: "card", position: 0 },
			{ id: "b", type: "card", position: 1 },
		]
		expect(siblingIndex("c", shuffled)).toBe(3)
		expect(siblingIndex("a", shuffled)).toBe(1)
	})

	test("an unknown id gets no number", () => {
		expect(siblingIndex("zzz", sibs)).toBeNull()
	})
})
