// Read queries for the dashboard — assemble the view DTOs over the shared Store. No SQL here; the
// dashboard is "just another DB reader" (spec 06), so it goes through the same Store port as the MCP
// server and the worker. N+1 reads (versions per node, reviews per version) are fine at PoC scale.

import type { Asset, Budget, ChatOutput, Node, Review, Store, Version } from "@app/shared"

// A node plus everything hanging off it, for the live tree view.
export interface NodeView {
	node: Node
	versions: Array<{ version: Version; reviews: Review[] }>
}

export interface ProductionDetail {
	root: Node
	nodes: NodeView[] // flat; the app nests by parentId (v0-flat = root + leaves)
	inbox: ChatOutput[] // pending chat_output (the gate)
	assets: Asset[]
	budget: Budget | null
}

export async function listProductions(store: Store): Promise<Node[]> {
	return store.listProductions()
}

export async function productionDetail(store: Store, productionId: string): Promise<ProductionDetail> {
	const root = await store.getProduction(productionId)
	if (!root) throw new Error(`production ${productionId} not found`)

	const nodes = await store.nodesFor(productionId)
	const nodeViews: NodeView[] = []
	for (const node of nodes) {
		const versions = await store.versionsFor(node.id)
		const withReviews = []
		for (const version of versions) {
			withReviews.push({ version, reviews: await store.reviewsFor(version.id) })
		}
		nodeViews.push({ node, versions: withReviews })
	}

	const [inbox, assets, budget] = await Promise.all([
		store.pendingOutputs(productionId),
		store.assetsFor(productionId),
		store.getBudget(productionId),
	])

	return { root, nodes: nodeViews, inbox, assets, budget }
}
