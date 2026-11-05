import { describe, expect, test } from "vitest"
import type { Interaction, NodeView } from "./api.js"
import { descendantsOf, subtreeUsage } from "./rollup.js"

const BASE = Date.parse("2026-11-05T00:00:00.000Z")
const at = (offsetMs: number) => new Date(BASE + offsetMs).toISOString()

// Minimal NodeView builder — only the fields the roll-up reads. `end` (ms offset from BASE) sets the
// interaction's createdAt (≈ when the run finished); the run's interval is [end − dur, end].
function node(id: string, parentId: string | null, runs: Array<{ dur: number; cost: number; end?: number }>): NodeView {
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
		createdAt: r.end === undefined ? "2026-11-05T00:00:00Z" : at(r.end),
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
		expect(u).toEqual({ runs: 0, costUsd: 0, durationMs: 0, wallMs: 0, ownDurationMs: 0, descNodeCount: 0 })
	})
})

describe("subtreeUsage wall-clock (wallMs)", () => {
	test("sequential runs: elapsed equals the sum (no overlap)", () => {
		const t = [node("x", null, [{ dur: 100, cost: 0, end: 100 }, { dur: 50, cost: 0, end: 150 }])]
		const u = subtreeUsage(t, "x")
		expect(u.durationMs).toBe(150) // summed compute
		expect(u.wallMs).toBe(150) // 0..150 elapsed
	})

	test("overlapping runs under one node: elapsed is the span, less than the sum", () => {
		// run A interval 0..100, run B interval 50..200
		const t = [node("x", null, [{ dur: 100, cost: 0, end: 100 }, { dur: 150, cost: 0, end: 200 }])]
		const u = subtreeUsage(t, "x")
		expect(u.durationMs).toBe(250) // sum of subagent time
		expect(u.wallMs).toBe(200) // max end (200) − min start (0)
	})

	test("a single run: elapsed equals its duration", () => {
		const t = [node("x", null, [{ dur: 80, cost: 0, end: 80 }])]
		expect(subtreeUsage(t, "x").wallMs).toBe(80)
	})

	test("concurrent children: parent elapsed is the union span, not the sum", () => {
		// parent P (no runs); child A 0..100, child B 20..120 — produced in parallel by two workers
		const t = [
			node("P", null, []),
			node("A", "P", [{ dur: 100, cost: 0, end: 100 }]),
			node("B", "P", [{ dur: 100, cost: 0, end: 120 }]),
		]
		const u = subtreeUsage(t, "P")
		expect(u.durationMs).toBe(200) // 100 + 100 compute
		expect(u.wallMs).toBe(120) // 0..120 elapsed, not 200
	})

	test("no interactions: wallMs is zero", () => {
		const t = [node("P", null, [])]
		expect(subtreeUsage(t, "P").wallMs).toBe(0)
	})
})
