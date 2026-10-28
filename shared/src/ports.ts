// Ports — the interfaces at every external edge. Core logic (loop, tool handlers) depends only on
// these, never on Postgres / the network / `claude -p`. Adapters implement them; fakes implement
// them for tests. See docs/code-standards.md and spec 03.

import type {
	Account,
	Asset,
	Budget,
	ChatInput,
	ChatOutput,
	Interaction,
	NewAsset,
	NewChatInput,
	NewChatOutput,
	NewChildNode,
	NewInteraction,
	NewProduction,
	NewReview,
	NewVersion,
	Node,
	NodeStatus,
	Review,
	SubagentRef,
	User,
	Version,
	VersionStatus,
} from "./types.js"

// Patch accepted by updateVersion — only the mutable columns.
export interface VersionPatch {
	status?: VersionStatus
	artifactPath?: string
	feedback?: string
	subagent?: SubagentRef
}

// ── Store: all DB access ────────────────────────────────────────────────────────────────────
// Every method is one transaction. The MCP server, the worker, and the dashboard API are all
// Store clients; they never call each other (spec: the DB is the only integration point).

export interface Store {
	// identity / tenant seam — v0 resolves the single seeded defaults
	defaultAccount(): Promise<Account>
	getAccount(id: string): Promise<Account | null>
	defaultUser(): Promise<User>
	getUser(id: string): Promise<User | null>

	// productions (the root node) + tree reads
	createProduction(input: NewProduction): Promise<Node> // inserts the root under accountId + userId
	getProduction(id: string): Promise<Node | null> // the root node
	listProductions(): Promise<Node[]> // dashboard list
	getNode(id: string): Promise<Node | null>
	nodesFor(productionId: string): Promise<Node[]> // whole tree (v0-flat: root + leaves)
	listReadyNodes(productionId: string): Promise<Node[]> // pending + deps approved + parent active
	claimReadyNode(): Promise<Node | null> // worker claim seam (FOR UPDATE SKIP LOCKED); null = nothing ready

	// node writes
	updateNodeStatus(id: string, status: NodeStatus): Promise<void>
	createChildNodes(parentId: string, children: NewChildNode[]): Promise<Node[]>

	// versions
	createVersion(input: NewVersion): Promise<Version>
	updateVersion(id: string, patch: VersionPatch): Promise<void>
	getVersion(id: string): Promise<Version | null>
	latestVersion(nodeId: string): Promise<Version | null>
	versionsFor(nodeId: string): Promise<Version[]> // ordered by n; for the redo cap + agreement rounds

	// reviews (internal quality gate)
	addReview(input: NewReview): Promise<Review>
	reviewsFor(versionId: string): Promise<Review[]>

	// assets (raw material)
	addAsset(input: NewAsset): Promise<Asset>
	assetsFor(productionId: string): Promise<Asset[]>

	// chat I/O (the human gate)
	emitOutput(input: NewChatOutput): Promise<ChatOutput> // engine → chat
	getOutput(id: string): Promise<ChatOutput | null>
	pendingOutputs(productionId: string): Promise<ChatOutput[]> // the inbox
	recordInput(input: NewChatInput): Promise<ChatInput> // chat → engine
	resolveOutput(id: string): Promise<void>

	// budget (money gate)
	getBudget(productionId: string): Promise<Budget | null>
	approveBudget(productionId: string): Promise<void>

	// subagent usage log — one row per SubagentRunner.run() (token/session tracking)
	recordInteraction(input: NewInteraction): Promise<Interaction>
	interactionsFor(productionId: string): Promise<Interaction[]> // ordered by createdAt; for the usage view
}

// ── RenderClient: each render engine behind one interface. Stub first (text-level), real adapters
//    when keys land (pending Angie). ───────────────────────────────────────────────────────────

export interface RenderInput {
	kind: string // what to render (storyboard frame, final cut, …)
	spec: unknown // the render spec the craft produced
	outDir: string // where to write (shared volume)
}

export interface RenderResult {
	artifactPath: string // file written on the shared volume
	costEstimate?: number // for the budget gate; 0 for the stub
	meta?: Record<string, unknown>
}

export interface RenderClient {
	render(input: RenderInput): Promise<RenderResult>
}

// ── SubagentRunner: spawns `claude -p`. A fake returns canned output so the loop tests with no
//    real subagent and no network. ────────────────────────────────────────────────────────────

export interface SubagentInput {
	prompt: string
	skill?: string // a type-registry skill name, or "self"
	systemPrompt?: string
	cwd?: string
	model?: string // per-call model override (else the runner's configured default)
	resumeSessionId?: string // continue a prior provider session (e.g. claude --resume) across redo rounds
}

// Token usage + cost the engine reports back, when it can. All optional: the fake and engines
// without a usage API leave them undefined.
export interface SubagentUsage {
	inputTokens?: number
	outputTokens?: number
	cacheReadTokens?: number
	cacheCreationTokens?: number
	costUsd?: number
}

export interface SubagentResult {
	output: string // the subagent's text output (producer draft, or `VERDICT: …` for a reviewer)
	sessionId?: string // provider session id (claude session_id); undefined for engines without one
	model?: string // the resolved model the engine actually used
	usage?: SubagentUsage // tokens + cost for this interaction, when the engine reports it
	raw?: unknown // transport-level detail, if the adapter wants to surface it
}

export interface SubagentRunner {
	readonly engine: string // which backend this is (claude | codex | openai | fake) — recorded per interaction
	run(input: SubagentInput): Promise<SubagentResult>
}

// ── Clock / IdGen: injectable so timestamps and ids are deterministic in tests. ────────────────

export interface Clock {
	now(): Date
}

export interface IdGen {
	next(prefix?: string): string
}

// ── Logger: structured events behind one interface. The default adapter writes JSON lines to
//    stderr; LangSmith / OpenTelemetry / pino slot in later as alternate adapters, no core change. ─

export type LogLevel = "debug" | "info" | "warn" | "error"
export type LogFields = Record<string, unknown>

export interface Logger {
	log(level: LogLevel, event: string, fields?: LogFields): void
	debug(event: string, fields?: LogFields): void
	info(event: string, fields?: LogFields): void
	warn(event: string, fields?: LogFields): void
	error(event: string, fields?: LogFields): void
	child(bound: LogFields): Logger // bind context (productionId, nodeId, …) onto every later line
}
