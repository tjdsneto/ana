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
	createdAt: string
	updatedAt: string
}

export interface Review {
	id: string
	name: string
	kind: string
	verdict: string
	body: string | null
	createdAt: string
}

// One subagent run (a producer draft or one reviewer pass): engine/model/session + token usage +
// timing. Null fields = the engine didn't report them (e.g. the fake runner, or a non-usage engine).
export interface Interaction {
	id: string
	nodeId: string
	versionId: string | null
	role: string // "producer" | "review:<kind>"
	engine: string // claude | fake | …
	model: string | null
	sessionId: string | null
	inputTokens: number | null
	outputTokens: number | null
	cacheReadTokens: number | null
	cacheCreationTokens: number | null
	costUsd: number | null
	durationMs: number | null
	status: string
	createdAt: string
	prompt: string | null // the full prompt sent to the subagent; null on old rows / pre-prompt failures
}

export interface UsageSummary {
	interactions: number
	sessions: string[]
	inputTokens: number
	outputTokens: number
	cacheReadTokens: number
	cacheCreationTokens: number
	costUsd: number
	durationMs: number
}

// One produced .mp4 on disk (from /api/videos). `path` is relative to the artifacts root and is the
// key the /api/video stream route takes.
export interface VideoFile {
	path: string
	name: string
	dir: string
	sizeBytes: number
	mtimeMs: number
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
	interactions: Interaction[]
}

export interface ProductionDetail {
	root: Node
	nodes: NodeView[]
	inbox: ChatOutput[]
	assets: Asset[]
	budget: { productionId: string; approved: boolean } | null
	usage: UsageSummary
}

async function json<T>(res: Response): Promise<T> {
	if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
	return res.json() as Promise<T>
}

// A production list row + whether it's blocked on the human, so the sidebar can badge it.
export type ProductionListItem = Node & { awaitingFeedback: boolean }

export async function getProductions(): Promise<ProductionListItem[]> {
	return json(await fetch("/api/productions"))
}

export async function getProduction(id: string): Promise<ProductionDetail> {
	return json(await fetch(`/api/productions/${id}`))
}

export async function getDeliverable(versionId: string): Promise<{ artifact_path: string | null; content?: string }> {
	return json(await fetch(`/api/deliverable?version_id=${encodeURIComponent(versionId)}`))
}

export async function getVideos(): Promise<VideoFile[]> {
	return json(await fetch("/api/videos"))
}

// Stream URLs for the <video> element (not JSON — used directly as a src).
export function videoUrlByVersion(versionId: string): string {
	return `/api/video?version_id=${encodeURIComponent(versionId)}`
}

export function videoUrlByPath(path: string): string {
	return `/api/video?path=${encodeURIComponent(path)}`
}

// Rendered storyboard board sheet for a version (404s for versions produced before boards existed).
export function boardUrlByVersion(versionId: string): string {
	return `/api/board?version_id=${encodeURIComponent(versionId)}`
}

export function emitsBoard(nodeType: string): boolean {
	return nodeType === "storyboard"
}

export function isVideoPath(p: string | null | undefined): boolean {
	return !!p && /\.mp4$/i.test(p)
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
