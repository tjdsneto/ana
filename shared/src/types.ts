// Domain contract types. Row types are inferred from the Drizzle schema (single source of truth);
// the unions below carry the allowed values the `text` columns hold (spec 01). Both imports are
// type-only, so schema.ts ⇄ types.ts never form a runtime cycle.

import type {
	accounts,
	assets,
	budget,
	chatInput,
	chatOutput,
	interactions,
	nodes,
	reviews,
	users,
	versions,
} from "./schema.js"

// ── value unions (the allowed contents of the `text` columns) ─────────────────────────────

export type AutonomyLever = "low" | "medium" | "high"
export type ActorKind = "human" | "agent"

export type NodeStatus =
	| "pending"
	| "ready"
	| "in-progress"
	| "needs-presentation"
	| "presented"
	| "approved"
	| "skipped"
	| "failed"

export type ProductionStatus = "queued" | "producing" | "review" | "done"

export type VersionStatus =
	| "producing"
	| "in-review"
	| "presentable"
	| "presented"
	| "approved"
	| "denied"
	| "needs-work"
	| "superseded"
	| "stale" // an upstream was reopened; this version must be revalidated (kept if it still holds, else rebuilt) before it counts as approved again

export type ReviewKind = "craft" | "coverage" | "consistency" | "audio"
export type ReviewVerdict = "pass" | "revise"

export type ChatOutputType = "present" | "notify" | "question" | "options"
export type ChatOutputStatus = "pending" | "resolved"
export type ChatInputKind = "approve" | "feedback" | "answer"

// Open unions: the listed values are the known roles/formats; any other string is allowed (`& {}`
// keeps the literal hints in editors without closing the set).
export type AssetType = "logo" | "screenshot" | "b-roll" | "music" | "vo" | "sfx" | (string & {})
export type FileType = "png" | "svg" | "mp4" | "wav" | "mp3" | (string & {})

// The subagent attached to a version, for idempotency (don't re-dispatch in-flight work) and for
// resume: sessionId is the provider session the producer continues across redo rounds (see
// SubagentInput.resumeSessionId). engine/model record which backend produced this version.
export interface SubagentRef {
	runId: string
	status: "spawned" | "running" | "done" | "failed"
	sessionId?: string // provider session id (e.g. claude session_id), for --resume + usage rollup
	engine?: string // which SubagentRunner backend ran it (claude | codex | openai | fake)
	model?: string // the resolved model, when the engine reports one
}

// The engine (subagent backend) a run targets. Open union: the three known backends plus the fake,
// any other string allowed so a new adapter needs no type change.
export type SubagentEngine = "claude" | "codex" | "openai" | "fake" | (string & {})

// A single subagent interaction = one SubagentRunner.run() call (a producer draft or one reviewer
// pass). Rows accumulate per production; summing by sessionId gives whole-session usage.
export type InteractionRole = "producer" | `review:${ReviewKind}` | (string & {})

// ── row types (inferred from the schema) ──────────────────────────────────────────────────

export type Account = typeof accounts.$inferSelect
export type User = typeof users.$inferSelect
export type Node = typeof nodes.$inferSelect
export type Version = typeof versions.$inferSelect
export type Review = typeof reviews.$inferSelect
export type Asset = typeof assets.$inferSelect
export type ChatOutput = typeof chatOutput.$inferSelect
export type ChatInput = typeof chatInput.$inferSelect
export type Budget = typeof budget.$inferSelect
export type Interaction = typeof interactions.$inferSelect

// ── port-input types (what the Store accepts; the Store fills ids/timestamps/derived columns) ─

export interface NewProduction {
	accountId: string
	userId: string
	brief: string
	sessionId: string
	autonomyLever: AutonomyLever
	actorKind: ActorKind
	type?: string // the root node's type — any rootCapable type, not only "video-project" (the default). A production is just a root node of some type; a leaf root produces one artifact and rolls up.
	params?: Record<string, unknown> // the intake params for the root type (resolved against its `inputs`); the engine asks the user for a missing required one before producing.
}

// The root's effective intake params: the caller's params with the first-class `brief` folded in, so
// a type that declares a required `brief` input (video-project, scene, clip, card) is satisfied by the
// native brief field rather than the engine asking for it. Explicit params win over the brief.
export function seedParams(input: { brief: string; params?: Record<string, unknown> }): Record<string, unknown> | null {
	const params = { ...(input.params ?? {}) }
	if (input.brief?.trim() && params.brief === undefined) params.brief = input.brief
	return Object.keys(params).length > 0 ? params : null
}

export interface NewChildNode {
	type: string
	name: string
	description?: string
	deps?: string[]
	position?: number
}

export interface NewVersion {
	nodeId: string
	n: number
	prevVersionId?: string
	status: VersionStatus
	artifactPath?: string
	subagent?: SubagentRef
	builtFrom?: Record<string, string> // depNodeId → effective upstream hash this version was produced from
}

export interface NewReview {
	nodeId: string
	versionId: string
	name: string
	kind: ReviewKind
	verdict: ReviewVerdict
	body?: string
}

export interface NewAsset {
	productionId: string
	nodeId?: string
	name: string
	description?: string
	assetType: AssetType
	fileType: FileType
	storagePath: string
}

export interface NewChatOutput {
	accountId?: string
	userId?: string
	productionId: string
	nodeId?: string
	versionId?: string
	type: ChatOutputType
	prompt?: string
	options?: string[]
}

export interface NewChatInput {
	accountId?: string
	userId?: string
	productionId: string
	nodeId?: string
	versionId?: string
	respondsTo?: string
	kind: ChatInputKind
	body?: string
}

export interface NewInteraction {
	productionId: string
	nodeId: string
	versionId?: string
	role: InteractionRole
	prompt?: string
	engine: SubagentEngine
	model?: string
	sessionId?: string
	inputTokens?: number
	outputTokens?: number
	cacheReadTokens?: number
	cacheCreationTokens?: number
	costUsd?: number
	durationMs?: number
	status: "done" | "failed"
}
