// The gate — the human verdict writes. approve / submit_feedback resolve a presented chat_output and
// drive the node's next pass; approve_budget flips the money gate. These are the only writes on the
// client-facing surface, and they are the one write path shared by the MCP tools and the dashboard.

import type { Store } from "@core/shared"

// Production statuses that retire the whole production — no gate write is accepted against them. The
// production status is the root node's status. Mirrors the engine's claim-seam RETIRED_PRODUCTION:
// a cancelled (human stop) or skipped/failed production is terminal, so approving/feeding back/funding
// it is a no-op the engine would never act on. Reject loudly instead of writing dead state.
const RETIRED_PRODUCTION = new Set(["cancelled", "skipped", "failed"])

async function assertProductionActive(store: Store, productionId: string, op: string): Promise<void> {
	const root = await store.getProduction(productionId)
	if (root && RETIRED_PRODUCTION.has(root.status)) {
		throw new Error(`${op}: production ${productionId} is ${root.status}; no gate action can be taken on it`)
	}
}

export async function approve(store: Store, input: { outputId?: string; versionId?: string }): Promise<{ ok: true }> {
	if (input.outputId) {
		const out = await store.getOutput(input.outputId)
		if (!out) throw new Error(`approve: chat_output ${input.outputId} not found`)
		await assertProductionActive(store, out.productionId, "approve")
		await store.recordInput({
			productionId: out.productionId,
			userId: out.userId ?? undefined,
			nodeId: out.nodeId ?? undefined,
			versionId: out.versionId ?? undefined,
			respondsTo: out.id,
			kind: "approve",
		})
		await store.resolveOutput(out.id)
		if (out.versionId) await store.updateVersion(out.versionId, { status: "approved", approvedBy: "human" })
		if (out.nodeId) await store.updateNodeStatus(out.nodeId, "approved")
		return { ok: true }
	}
	if (input.versionId) {
		const version = await store.getVersion(input.versionId)
		if (!version) throw new Error(`approve: version ${input.versionId} not found`)
		const node = await store.getNode(version.nodeId)
		if (!node) throw new Error(`approve: node ${version.nodeId} not found`)
		await assertProductionActive(store, node.productionId, "approve")
		await store.recordInput({ productionId: node.productionId, nodeId: node.id, versionId: version.id, kind: "approve" })
		await store.updateVersion(version.id, { status: "approved", approvedBy: "human" })
		await store.updateNodeStatus(node.id, "approved")
		return { ok: true }
	}
	throw new Error("approve: pass output_id or version_id")
}

export async function submitFeedback(
	store: Store,
	input: { outputId?: string; productionId?: string; body: string },
): Promise<{ ok: true }> {
	if (input.outputId) {
		const out = await store.getOutput(input.outputId)
		if (!out) throw new Error(`submit_feedback: chat_output ${input.outputId} not found`)
		await assertProductionActive(store, out.productionId, "submit_feedback")
		await store.recordInput({
			productionId: out.productionId,
			userId: out.userId ?? undefined,
			nodeId: out.nodeId ?? undefined,
			versionId: out.versionId ?? undefined,
			respondsTo: out.id,
			kind: "feedback",
			body: input.body,
		})
		await store.resolveOutput(out.id)
		if (out.versionId) await store.updateVersion(out.versionId, { status: "denied", feedback: input.body })
		if (out.nodeId) await store.updateNodeStatus(out.nodeId, "pending")
		return { ok: true }
	}
	if (input.productionId) {
		await assertProductionActive(store, input.productionId, "submit_feedback")
		// unsolicited feedback (no responds_to) — the engine folds it into the next pass (spec 02)
		await store.recordInput({ productionId: input.productionId, kind: "feedback", body: input.body })
		return { ok: true }
	}
	throw new Error("submit_feedback: pass output_id or production_id")
}

export async function approveBudget(store: Store, input: { productionId: string }): Promise<{ ok: true }> {
	await assertProductionActive(store, input.productionId, "approve_budget")
	await store.approveBudget(input.productionId)
	return { ok: true }
}

// Cancel a node and its whole subtree: mark them "skipped" (a loop-terminal, non-root status the engine
// treats as settled, not blocking — rollup counts a skipped child as done), supersede their latest
// versions so none still reads as approved, and resolve any pending present outputs so the inbox clears.
// Used to prune a node the loop should stop pursuing — e.g. a duplicate fanned-out child a planner
// re-plan left behind. Not for the production root (that is a production stop, a different gate).
export async function cancelNode(store: Store, input: { nodeId: string }): Promise<{ ok: true; cancelled: number }> {
	const node = await store.getNode(input.nodeId)
	if (!node) throw new Error(`cancel: node ${input.nodeId} not found`)
	if (node.parentId === null) throw new Error(`cancel: ${input.nodeId} is the production root — stop the production, don't cancel it as a node`)
	await assertProductionActive(store, node.productionId, "cancel")

	// resolve the subtree (this node + all descendants) over the production's node list
	const tree = await store.nodesFor(node.productionId)
	const childrenOf = new Map<string, string[]>()
	for (const n of tree) {
		if (!n.parentId) continue
		const arr = childrenOf.get(n.parentId) ?? []
		arr.push(n.id)
		childrenOf.set(n.parentId, arr)
	}
	const subtree: string[] = []
	const stack = [node.id]
	while (stack.length > 0) {
		const id = stack.pop()!
		subtree.push(id)
		for (const childId of childrenOf.get(id) ?? []) stack.push(childId)
	}

	for (const id of subtree) {
		const latest = await store.latestVersion(id)
		if (latest && latest.status !== "superseded") await store.updateVersion(latest.id, { status: "superseded" })
		await store.updateNodeStatus(id, "skipped")
	}
	// clear any present outputs waiting on a cancelled node, so they leave the inbox
	const subtreeSet = new Set(subtree)
	for (const out of await store.pendingOutputs(node.productionId)) {
		if (out.nodeId && subtreeSet.has(out.nodeId)) await store.resolveOutput(out.id)
	}
	return { ok: true, cancelled: subtree.length }
}
