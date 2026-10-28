// The gate — the human verdict writes. approve / submit_feedback resolve a presented chat_output and
// drive the node's next pass; approve_budget flips the money gate. These are the only writes on the
// client-facing surface, and they are the one write path shared by the MCP tools and the dashboard.

import type { Store } from "@core/shared"

export async function approve(store: Store, input: { outputId?: string; versionId?: string }): Promise<{ ok: true }> {
	if (input.outputId) {
		const out = await store.getOutput(input.outputId)
		if (!out) throw new Error(`approve: chat_output ${input.outputId} not found`)
		await store.recordInput({
			productionId: out.productionId,
			userId: out.userId ?? undefined,
			nodeId: out.nodeId ?? undefined,
			versionId: out.versionId ?? undefined,
			respondsTo: out.id,
			kind: "approve",
		})
		await store.resolveOutput(out.id)
		if (out.versionId) await store.updateVersion(out.versionId, { status: "approved" })
		if (out.nodeId) await store.updateNodeStatus(out.nodeId, "approved")
		return { ok: true }
	}
	if (input.versionId) {
		const version = await store.getVersion(input.versionId)
		if (!version) throw new Error(`approve: version ${input.versionId} not found`)
		const node = await store.getNode(version.nodeId)
		if (!node) throw new Error(`approve: node ${version.nodeId} not found`)
		await store.recordInput({ productionId: node.productionId, nodeId: node.id, versionId: version.id, kind: "approve" })
		await store.updateVersion(version.id, { status: "approved" })
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
		// unsolicited feedback (no responds_to) — the engine folds it into the next pass (spec 02)
		await store.recordInput({ productionId: input.productionId, kind: "feedback", body: input.body })
		return { ok: true }
	}
	throw new Error("submit_feedback: pass output_id or production_id")
}

export async function approveBudget(store: Store, input: { productionId: string }): Promise<{ ok: true }> {
	await store.approveBudget(input.productionId)
	return { ok: true }
}
