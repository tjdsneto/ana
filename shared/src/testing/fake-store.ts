// In-memory Store + deterministic Clock/IdGen for unit tests (no DB, no I/O). Mirrors PgStore
// semantics so tool-handler and loop tests run against the same contract. Seeds the default account
// + user on construction, like a migrated+seeded database.

import { DEFAULT_ACCOUNT_ID, DEFAULT_ACCOUNT_NAME, DEFAULT_USER_ID, DEFAULT_USER_NAME } from "../defaults.js"
import type { Clock, IdGen, Store, VersionPatch } from "../ports.js"
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
	User,
	Version,
} from "../types.js"
import { seedParams } from "../types.js"

export class FixedClock implements Clock {
	constructor(private current = new Date("2026-01-01T00:00:00.000Z")) {}
	now(): Date {
		return new Date(this.current)
	}
	advance(ms: number): void {
		this.current = new Date(this.current.getTime() + ms)
	}
}

export class SeqIdGen implements IdGen {
	private counters = new Map<string, number>()
	next(prefix = "id"): string {
		const n = (this.counters.get(prefix) ?? 0) + 1
		this.counters.set(prefix, n)
		return `${prefix}_${n}`
	}
}

export class FakeStore implements Store {
	readonly accounts = new Map<string, Account>()
	readonly users = new Map<string, User>()
	readonly nodes = new Map<string, Node>()
	readonly versions = new Map<string, Version>()
	readonly reviews: Review[] = []
	readonly assets: Asset[] = []
	readonly chatOutputs = new Map<string, ChatOutput>()
	readonly chatInputs: ChatInput[] = []
	readonly budgets = new Map<string, Budget>()
	readonly interactions: Interaction[] = []

	constructor(
		private readonly clock: Clock = new FixedClock(),
		private readonly idgen: IdGen = new SeqIdGen(),
	) {
		const createdAt = this.clock.now()
		this.accounts.set(DEFAULT_ACCOUNT_ID, { id: DEFAULT_ACCOUNT_ID, name: DEFAULT_ACCOUNT_NAME, createdAt })
		this.users.set(DEFAULT_USER_ID, { id: DEFAULT_USER_ID, accountId: DEFAULT_ACCOUNT_ID, name: DEFAULT_USER_NAME, createdAt })
	}

	async defaultAccount(): Promise<Account> {
		const account = this.accounts.get(DEFAULT_ACCOUNT_ID)
		if (!account) throw new Error("default account missing")
		return account
	}
	async getAccount(id: string): Promise<Account | null> {
		return this.accounts.get(id) ?? null
	}
	async defaultUser(): Promise<User> {
		const user = this.users.get(DEFAULT_USER_ID)
		if (!user) throw new Error("default user missing")
		return user
	}
	async getUser(id: string): Promise<User | null> {
		return this.users.get(id) ?? null
	}

	async createProduction(input: NewProduction): Promise<Node> {
		const id = this.idgen.next("nd")
		const now = this.clock.now()
		const root: Node = {
			id,
			accountId: input.accountId,
			userId: input.userId,
			productionId: id,
			parentId: null,
			type: input.type ?? "video-project",
			name: input.brief.trim().slice(0, 60),
			description: input.brief,
			status: "queued",
			deps: [],
			position: 0,
			sessionId: input.sessionId,
			autonomyLever: input.autonomyLever,
			actorKind: input.actorKind,
			params: seedParams(input),
			createdAt: now,
			updatedAt: now,
		}
		this.nodes.set(id, root)
		this.budgets.set(id, { productionId: id, approved: false })
		return root
	}

	async getProduction(id: string): Promise<Node | null> {
		return this.getNode(id)
	}
	async listProductions(): Promise<Node[]> {
		return [...this.nodes.values()]
			.filter((n) => n.parentId === null)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
	}
	async getNode(id: string): Promise<Node | null> {
		return this.nodes.get(id) ?? null
	}
	async nodesFor(productionId: string): Promise<Node[]> {
		return [...this.nodes.values()].filter((n) => n.productionId === productionId).sort((a, b) => a.position - b.position)
	}
	async listReadyNodes(productionId: string): Promise<Node[]> {
		const tree = await this.nodesFor(productionId)
		return tree.filter((n) => isReady(n, tree))
	}
	async claimReadyNode(): Promise<Node | null> {
		for (const n of [...this.nodes.values()].sort((a, b) => a.position - b.position)) {
			if (n.status !== "pending") continue
			// Never claim work for a retired production (cancelled/skipped/failed). The production status
			// is the root node's status; if it is retired, skip every descendant at any depth.
			const root = this.nodes.get(n.productionId)
			if (root && RETIRED_PRODUCTION.has(root.status as NodeStatus)) continue
			const tree = await this.nodesFor(n.productionId)
			if (isReady(n, tree)) {
				const claimed = { ...n, status: "in-progress" as NodeStatus, updatedAt: this.clock.now() }
				this.nodes.set(n.id, claimed)
				return claimed
			}
		}
		return null
	}

	async updateNodeStatus(id: string, status: NodeStatus): Promise<void> {
		const n = this.nodes.get(id)
		if (n) this.nodes.set(id, { ...n, status, updatedAt: this.clock.now() })
	}
	async createChildNodes(parentId: string, children: NewChildNode[]): Promise<Node[]> {
		const parent = this.nodes.get(parentId)
		if (!parent) throw new Error(`createChildNodes: parent ${parentId} not found`)
		const now = this.clock.now()
		const created = children.map((c, i) => {
			const node: Node = {
				id: this.idgen.next("nd"),
				accountId: null,
				userId: null,
				productionId: parent.productionId,
				parentId,
				type: c.type,
				name: c.name,
				description: c.description ?? null,
				status: "pending",
				deps: c.deps ?? [],
				position: c.position ?? i,
				sessionId: null,
				autonomyLever: null,
				actorKind: null,
				params: null, // children carry no intake params (root only)
				createdAt: now,
				updatedAt: now,
			}
			this.nodes.set(node.id, node)
			return node
		})
		return created
	}

	async createVersion(input: NewVersion): Promise<Version> {
		const now = this.clock.now()
		const version: Version = {
			id: this.idgen.next("ver"),
			nodeId: input.nodeId,
			n: input.n,
			prevVersionId: input.prevVersionId ?? null,
			status: input.status,
			artifactPath: input.artifactPath ?? null,
			subagent: input.subagent ?? null,
			feedback: null,
			builtFrom: input.builtFrom ?? null,
			createdAt: now,
			updatedAt: now,
		}
		this.versions.set(version.id, version)
		return version
	}
	async updateVersion(id: string, patch: VersionPatch): Promise<void> {
		const v = this.versions.get(id)
		if (v) this.versions.set(id, { ...v, ...patch, updatedAt: this.clock.now() })
	}
	async getVersion(id: string): Promise<Version | null> {
		return this.versions.get(id) ?? null
	}
	async latestVersion(nodeId: string): Promise<Version | null> {
		const list = [...this.versions.values()].filter((v) => v.nodeId === nodeId).sort((a, b) => b.n - a.n)
		return list[0] ?? null
	}
	async versionsFor(nodeId: string): Promise<Version[]> {
		return [...this.versions.values()].filter((v) => v.nodeId === nodeId).sort((a, b) => a.n - b.n)
	}

	async addReview(input: NewReview): Promise<Review> {
		const review: Review = {
			id: this.idgen.next("rev"),
			nodeId: input.nodeId,
			versionId: input.versionId,
			name: input.name,
			kind: input.kind,
			verdict: input.verdict,
			body: input.body ?? null,
			createdAt: this.clock.now(),
		}
		this.reviews.push(review)
		return review
	}
	async reviewsFor(versionId: string): Promise<Review[]> {
		return this.reviews.filter((r) => r.versionId === versionId)
	}

	async addAsset(input: NewAsset): Promise<Asset> {
		const now = this.clock.now()
		const asset: Asset = {
			id: this.idgen.next("ast"),
			productionId: input.productionId,
			nodeId: input.nodeId ?? null,
			name: input.name,
			description: input.description ?? null,
			assetType: input.assetType,
			fileType: input.fileType,
			storagePath: input.storagePath,
			createdAt: now,
			updatedAt: now,
		}
		this.assets.push(asset)
		return asset
	}
	async assetsFor(productionId: string): Promise<Asset[]> {
		return this.assets.filter((a) => a.productionId === productionId)
	}

	async emitOutput(input: NewChatOutput): Promise<ChatOutput> {
		const output: ChatOutput = {
			id: this.idgen.next("out"),
			accountId: input.accountId ?? null,
			userId: input.userId ?? null,
			productionId: input.productionId,
			nodeId: input.nodeId ?? null,
			versionId: input.versionId ?? null,
			type: input.type,
			status: "pending",
			prompt: input.prompt ?? null,
			options: input.options ?? null,
			createdAt: this.clock.now(),
			resolvedAt: null,
		}
		this.chatOutputs.set(output.id, output)
		return output
	}
	async getOutput(id: string): Promise<ChatOutput | null> {
		return this.chatOutputs.get(id) ?? null
	}
	async pendingOutputs(productionId: string): Promise<ChatOutput[]> {
		return [...this.chatOutputs.values()]
			.filter((o) => o.productionId === productionId && o.status === "pending")
			.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
	}
	async recordInput(input: NewChatInput): Promise<ChatInput> {
		const record: ChatInput = {
			id: this.idgen.next("inp"),
			accountId: input.accountId ?? null,
			userId: input.userId ?? null,
			productionId: input.productionId,
			nodeId: input.nodeId ?? null,
			versionId: input.versionId ?? null,
			respondsTo: input.respondsTo ?? null,
			kind: input.kind,
			body: input.body ?? null,
			createdAt: this.clock.now(),
		}
		this.chatInputs.push(record)
		return record
	}
	async resolveOutput(id: string): Promise<void> {
		const o = this.chatOutputs.get(id)
		if (o) this.chatOutputs.set(id, { ...o, status: "resolved", resolvedAt: this.clock.now() })
	}

	async getBudget(productionId: string): Promise<Budget | null> {
		return this.budgets.get(productionId) ?? null
	}
	async approveBudget(productionId: string): Promise<void> {
		this.budgets.set(productionId, { productionId, approved: true })
	}

	async recordInteraction(input: NewInteraction): Promise<Interaction> {
		const interaction: Interaction = {
			id: this.idgen.next("int"),
			productionId: input.productionId,
			nodeId: input.nodeId,
			versionId: input.versionId ?? null,
			role: input.role,
			prompt: input.prompt ?? null,
			engine: input.engine,
			model: input.model ?? null,
			sessionId: input.sessionId ?? null,
			inputTokens: input.inputTokens ?? null,
			outputTokens: input.outputTokens ?? null,
			cacheReadTokens: input.cacheReadTokens ?? null,
			cacheCreationTokens: input.cacheCreationTokens ?? null,
			costUsd: input.costUsd ?? null,
			durationMs: input.durationMs ?? null,
			status: input.status,
			createdAt: this.clock.now(),
		}
		this.interactions.push(interaction)
		return interaction
	}
	async interactionsFor(productionId: string): Promise<Interaction[]> {
		return this.interactions.filter((i) => i.productionId === productionId)
	}
}

// Production root statuses that retire the whole production — no node under such a root is claimed.
// Mirrors PgStore's RETIRED_PRODUCTION (cancelled = human stop; skipped/failed = loop terminals).
const RETIRED_PRODUCTION = new Set<NodeStatus>(["cancelled", "skipped", "failed"])

function isReady(node: Node, tree: Node[]): boolean {
	if (node.status !== "pending") return false
	const byId = new Map(tree.map((n) => [n.id, n]))
	for (const depId of node.deps) {
		if (byId.get(depId)?.status !== "approved") return false
	}
	if (node.parentId) {
		const parent = byId.get(node.parentId)
		if (!parent || (parent.status !== "in-progress" && parent.status !== "ready")) return false
	}
	return true
}
