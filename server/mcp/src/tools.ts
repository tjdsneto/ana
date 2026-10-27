// Tool handlers — the business logic of each MCP tool, as pure async functions over a `Store`.
// They know nothing about MCP, transports, or zod; server.ts wires them. Depending only on `Store`
// means every one unit-tests against FakeStore (tools.test.ts). Wire param names are snake_case
// (spec 04); these handlers take camelCase and server.ts maps between them.

import { stat } from "node:fs/promises"
import { readFile } from "node:fs/promises"
import type { AutonomyLever, ActorKind, Store } from "@app/shared"

const MAX_INLINE_ARTIFACT_BYTES = 64 * 1024 // only inline small text artifacts into get_deliverable

// ── request_video — HAND OFF (insert the root, return immediately) ───────────────────────────────

export interface RequestVideoInput {
	brief: string
	sessionId: string
	autonomyLever?: AutonomyLever
	actorKind?: ActorKind
}

export async function requestVideo(store: Store, input: RequestVideoInput): Promise<{ production_id: string; status: string }> {
	const account = await store.defaultAccount()
	const user = await store.defaultUser()
	const root = await store.createProduction({
		accountId: account.id,
		userId: user.id,
		brief: input.brief,
		sessionId: input.sessionId,
		autonomyLever: input.autonomyLever ?? "medium",
		actorKind: input.actorKind ?? "human",
	})
	return { production_id: root.id, status: root.status }
}

// ── get_status — DIRECT ──────────────────────────────────────────────────────────────────────────

export async function getStatus(store: Store, input: { productionId: string }) {
	const root = await store.getProduction(input.productionId)
	if (!root) throw new Error(`production ${input.productionId} not found`)
	const tree = await store.nodesFor(input.productionId)
	const pending = await store.pendingOutputs(input.productionId)
	return {
		status: root.status,
		nodes: tree.map((n) => ({ id: n.id, type: n.type, name: n.name, status: n.status })),
		presentable: pending
			.filter((o) => o.type === "present")
			.map((o) => ({ output_id: o.id, node_id: o.nodeId, version_id: o.versionId })),
	}
}

// ── inbox — DIRECT (pending chat_output queue) ────────────────────────────────────────────────────

export async function inbox(store: Store, input: { productionId: string }) {
	const outputs = await store.pendingOutputs(input.productionId)
	return {
		outputs: outputs.map((o) => ({
			id: o.id,
			type: o.type,
			node_id: o.nodeId,
			version_id: o.versionId,
			prompt: o.prompt,
			options: o.options,
		})),
	}
}

// ── get_deliverable — DIRECT ───────────────────────────────────────────────────────────────────────

export async function getDeliverable(store: Store, input: { versionId?: string; nodeId?: string }) {
	const version = input.versionId
		? await store.getVersion(input.versionId)
		: input.nodeId
			? await store.latestVersion(input.nodeId)
			: null
	if (!version) throw new Error("get_deliverable: pass version_id or node_id to an existing version")

	let content: string | undefined
	if (version.artifactPath) {
		try {
			const info = await stat(version.artifactPath)
			if (info.isFile() && info.size <= MAX_INLINE_ARTIFACT_BYTES) {
				content = await readFile(version.artifactPath, "utf8")
			}
		} catch {
			// artifact not readable (not written yet, binary, too big) — return the path only
		}
	}

	return {
		version: { id: version.id, n: version.n, node_id: version.nodeId, status: version.status },
		artifact_path: version.artifactPath,
		content,
	}
}

// ── approve — DIRECT (approve a presented version) ──────────────────────────────────────────────────

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

// ── submit_feedback — DIRECT (deny + reopen, or unsolicited) ────────────────────────────────────────

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

// ── approve_budget — DIRECT (flip the money gate) ──────────────────────────────────────────────────

export async function approveBudget(store: Store, input: { productionId: string }): Promise<{ ok: true }> {
	await store.approveBudget(input.productionId)
	return { ok: true }
}
