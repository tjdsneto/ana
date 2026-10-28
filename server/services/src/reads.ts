// Read operations — status, the inbox queue, and a produced deliverable's artifact. All direct reads
// over the Store; no mutation.

import { readFile, stat } from "node:fs/promises"
import type { Store } from "@app/shared"

const MAX_INLINE_ARTIFACT_BYTES = 64 * 1024 // only inline small text artifacts into get_deliverable

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
