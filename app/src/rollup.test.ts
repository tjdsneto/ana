import { describe, expect, test } from "vitest"
import type { Interaction, NodeView } from "./api.js"
import { descendantsOf, subtreeUsage } from "./rollup.js"

// Minimal NodeView builder — only the fields the roll-up reads.
function node(id: string, parentId: string | null, runs: Array<{ dur: number; cost: number }>): NodeView {
	const interactions: Interaction[] = runs.map((r, i) => ({
		id: `${id}-i${i}`,
		nodeId: id,
		versionId: null,
		role: "producer",
		engine: "claude",
		model: "claude-opus-5-5",
		sessionId: `${id}-s${i}`,
		inputTokens: 1,
		outputTokens: 1,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		costUsd: r.cost,
		durationMs: r.dur,
		numTurns: null,
		apiDurationMs: null,
		status: "done",
		createdAt: "2026-11-05T00:00:00Z",
		prompt: null,
	}))
	return {
		node: { id, parentId, productionId: "p", type: id, name: id, status: "approved", autonomyLever: null, actorKind: null, deps: [], position: 0, description: null, params: null, createdAt: "2026-11-05T00:00:00Z" },
		versions: [],
		interactions,
	}
}

// Tree:  root ──┬── a ──── a1
//               └── b
// own durations: root 10, a 20, a1 300, b 5  (a1 has 2 runs)
const tree: NodeView[] = [
	node("root", null, [{ dur: 10, cost: 0.1 }]),
	node("a", "root", [{ dur: 20, cost: 0.2 }]),
	node("a1", "a", [{ dur: 100, cost: 1 }, { dur: 200, cost: 2 }]),
	node("b", "root", [{ dur: 5, cost: 0.05 }]),
]

describe("descendantsOf", () => {
	test("returns children and grandchildren, not the node itself", () => {
		const ids = descendantsOf(tree, "root").map((n) => n.node.id).sort()
		expect(ids).toEqual(["a", "a1", "b"])
	})
	test("a leaf has no descendants", () => {
		expect(descendantsOf(tree, "a1")).toEqual([])
	})
})

describe("subtreeUsage", () => {
	test("rolls up the node plus all descendants", () => {
		const u = subtreeUsage(tree, "a")
		expect(u.durationMs).toBe(320) // a 20 + a1 300
		expect(u.runs).toBe(3) // a 1 + a1 2
		expect(u.costUsd).toBeCloseTo(3.2, 6) // 0.2 + 1 + 2
		expect(u.ownDurationMs).toBe(20)
		expect(u.descNodeCount).toBe(1) // only a1 ran
	})
	test("root subtree totals every node exactly once (no double-count)", () => {
		const u = subtreeUsage(tree, "root")
		expect(u.durationMs).toBe(335) // 10 + 20 + 300 + 5
		expect(u.runs).toBe(5)
	})
	test("top-level children subtrees + root's own equal the whole tree", () => {
		const whole = subtreeUsage(tree, "root").durationMs
		const rootOwn = subtreeUsage(tree, "root").ownDurationMs
		const childrenSubtrees = descendantsOf(tree, "root")
			.filter((n) => n.node.parentId === "root")
			.reduce((s, n) => s + subtreeUsage(tree, n.node.id).durationMs, 0)
		expect(rootOwn + childrenSubtrees).toBe(whole)
	})
	test("a node absent from the list yields zeros", () => {
		const u = subtreeUsage(tree, "ghost")
		expect(u).toEqual({ runs: 0, costUsd: 0, durationMs: 0, ownDurationMs: 0, descNodeCount: 0 })
	})
})
