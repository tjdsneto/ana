// Read queries for the dashboard — assemble the view DTOs over the shared Store. No SQL here; the
// dashboard is "just another DB reader" (spec 06), so it goes through the same Store port as the MCP
// server and the worker. N+1 reads (versions per node, reviews per version) are fine at PoC scale.

import type { Asset, Budget, ChatOutput, Interaction, Node, Review, Store, Version } from "@core/shared"

// A node plus everything hanging off it, for the live tree view.
export interface NodeView {
	node: Node
	versions: Array<{ version: Version; reviews: Review[] }>
	interactions: Interaction[] // subagent runs for this node (producer + reviewers), oldest first
}

// Rolled-up subagent usage for the whole production — the money/attention view (spec 06).
export interface UsageSummary {
	interactions: number
	sessions: string[] // distinct provider session ids seen
	inputTokens: number
	outputTokens: number
	cacheReadTokens: number
	cacheCreationTokens: number
	costUsd: number
	durationMs: number
}

export interface ProductionDetail {
	root: Node
	nodes: NodeView[] // flat; the app nests by parentId (v0-flat = root + leaves)
	inbox: ChatOutput[] // pending chat_output (the gate)
	assets: Asset[]
	budget: Budget | null
	usage: UsageSummary
}

export async function listProductions(store: Store): Promise<Node[]> {
	return store.listProductions()
}

export async function productionDetail(store: Store, productionId: string): Promise<ProductionDetail> {
	const root = await store.getProduction(productionId)
	if (!root) throw new Error(`production ${productionId} not found`)

	const nodes = await store.nodesFor(productionId)
	const interactions = await store.interactionsFor(productionId)
	const byNode = new Map<string, Interaction[]>()
	for (const it of interactions) {
		const list = byNode.get(it.nodeId) ?? []
		list.push(it)
		byNode.set(it.nodeId, list)
	}

	const nodeViews: NodeView[] = []
	for (const node of nodes) {
		const versions = await store.versionsFor(node.id)
		const withReviews = []
		for (const version of versions) {
			withReviews.push({ version, reviews: await store.reviewsFor(version.id) })
		}
		nodeViews.push({ node, versions: withReviews, interactions: byNode.get(node.id) ?? [] })
	}

	const [inbox, assets, budget] = await Promise.all([
		store.pendingOutputs(productionId),
		store.assetsFor(productionId),
		store.getBudget(productionId),
	])

	return { root, nodes: nodeViews, inbox, assets, budget, usage: summarize(interactions) }
}

function summarize(interactions: Interaction[]): UsageSummary {
	const sessions = new Set<string>()
	const sum = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, durationMs: 0 }
	for (const it of interactions) {
		if (it.sessionId) sessions.add(it.sessionId)
		sum.inputTokens += it.inputTokens ?? 0
		sum.outputTokens += it.outputTokens ?? 0
		sum.cacheReadTokens += it.cacheReadTokens ?? 0
		sum.cacheCreationTokens += it.cacheCreationTokens ?? 0
		sum.costUsd += it.costUsd ?? 0
		sum.durationMs += it.durationMs ?? 0
	}
	return { interactions: interactions.length, sessions: [...sessions], ...sum }
}
