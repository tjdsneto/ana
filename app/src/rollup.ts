// Roll-up helpers for the node tree: a node's time/cost/runs is only its own interactions, but a
// parent (storyboard, build) can hold most of a production's work in its descendants (the fanned-out
// cards and scenes). These sum a node plus its whole subtree so a collapsed parent row reflects what
// is really under it, and the top-level rows add up to the production total.

import type { NodeView } from "./api.js"

// Every descendant node-view of `id` (children, grandchildren, …), excluding the node itself.
export function descendantsOf(nodes: NodeView[], id: string): NodeView[] {
	const out: NodeView[] = []
	const stack = [id]
	while (stack.length > 0) {
		const cur = stack.pop() as string
		for (const nv of nodes) {
			if (nv.node.parentId === cur) {
				out.push(nv)
				stack.push(nv.node.id)
			}
		}
	}
	return out
}

export interface SubtreeUsage {
	runs: number
	costUsd: number
	durationMs: number // summed subagent time (compute) — how much machine time the subtree spent
	wallMs: number // elapsed wall-clock span over the subtree's runs — concurrency-aware (parallel runs overlap, so this is ≤ durationMs), the honest "how long it took"
	ownDurationMs: number // just this node's own interactions, so a caller can show the split
	descNodeCount: number // descendant nodes that ran at least one interaction
}

// Roll up interaction usage over a node and its whole subtree. `runs`/`costUsd`/`durationMs` are the
// totals (node + descendants). An id absent from `nodes` yields zeros.
export function subtreeUsage(nodes: NodeView[], id: string): SubtreeUsage {
	const self = nodes.find((n) => n.node.id === id)
	const desc = descendantsOf(nodes, id)
	let runs = 0
	let costUsd = 0
	let durationMs = 0
	// Wall-clock span: each run occupies [end − dur, end] with end ≈ its interaction.createdAt (the row is
	// written when the run finishes). The elapsed time for the subtree is max(end) − min(start); parallel
	// runs overlap in that window instead of adding up, so this reflects concurrency honestly.
	let minStart = Number.POSITIVE_INFINITY
	let maxEnd = Number.NEGATIVE_INFINITY
	const tally = (nv: NodeView) => {
		for (const it of nv.interactions) {
			runs += 1
			costUsd += it.costUsd ?? 0
			durationMs += it.durationMs ?? 0
			const end = Date.parse(it.createdAt)
			if (Number.isNaN(end)) continue
			const start = end - (it.durationMs ?? 0)
			if (start < minStart) minStart = start
			if (end > maxEnd) maxEnd = end
		}
	}
	if (self) tally(self)
	for (const nv of desc) tally(nv)
	const wallMs = maxEnd > minStart ? maxEnd - minStart : 0
	const ownDurationMs = self ? self.interactions.reduce((s, it) => s + (it.durationMs ?? 0), 0) : 0
	const descNodeCount = desc.filter((nv) => nv.interactions.length > 0).length
	return { runs, costUsd, durationMs, wallMs, ownDurationMs, descNodeCount }
}
