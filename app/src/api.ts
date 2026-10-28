// Thin fetch layer over dashboard/api. Types are a loose client-side mirror of the API DTOs
// (queries.ts) — only the fields the UI reads. Relative URLs; Vite proxies /api to the API port.

export interface Node {
	id: string
	parentId: string | null
	productionId: string
	type: string
	name: string
	status: string
	autonomyLever: string | null
	actorKind: string | null
	createdAt: string
}

export interface Version {
	id: string
	nodeId: string
	n: number
	prevVersionId: string | null
	status: string
	artifactPath: string | null
	feedback: string | null
}

export interface Review {
	id: string
	name: string
	kind: string
	verdict: string
	body: string | null
}

export interface ChatOutput {
	id: string
	type: string
	nodeId: string | null
	versionId: string | null
	prompt: string | null
	options: unknown
}

export interface Asset {
	id: string
	name: string
	assetType: string
	fileType: string
	storagePath: string
}

export interface NodeView {
	node: Node
	versions: Array<{ version: Version; reviews: Review[] }>
}

export interface ProductionDetail {
	root: Node
	nodes: NodeView[]
	inbox: ChatOutput[]
	assets: Asset[]
	budget: { productionId: string; approved: boolean } | null
}

async function json<T>(res: Response): Promise<T> {
	if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
	return res.json() as Promise<T>
}

export async function getProductions(): Promise<Node[]> {
	return json(await fetch("/api/productions"))
}

export async function getProduction(id: string): Promise<ProductionDetail> {
	return json(await fetch(`/api/productions/${id}`))
}

export async function getDeliverable(versionId: string): Promise<{ artifact_path: string | null; content?: string }> {
	return json(await fetch(`/api/deliverable?version_id=${encodeURIComponent(versionId)}`))
}

export async function approveOutput(outputId: string): Promise<void> {
	await json(await fetch("/api/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ output_id: outputId }) }))
}

export async function sendFeedback(outputId: string, body: string): Promise<void> {
	await json(await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ output_id: outputId, body }) }))
}

export async function approveBudget(productionId: string): Promise<void> {
	await json(await fetch("/api/approve-budget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ production_id: productionId }) }))
}
