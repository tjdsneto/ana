// PgStore — the Postgres adapter of the `Store` port (Drizzle + node-postgres). The only place that
// talks SQL. The MCP server, the engine, and the dashboard API all use a Store; in production it is
// this one, in tests it is the FakeStore (../testing). Ids + timestamps come from the injected
// IdGen / Clock so tests of the adapter stay deterministic.

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import type { Pool } from "pg"
import { DEFAULT_ACCOUNT_ID, DEFAULT_USER_ID } from "../defaults.js"
import type { Clock, IdGen, Store, VersionPatch } from "../ports.js"
import * as schema from "../schema.js"
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
import { SystemClock, UuidGen } from "../runtime.js"

const { accounts, assets, budget, chatInput, chatOutput, interactions, nodes, reviews, users, versions } = schema

// node statuses that count as "the parent is still active" for readiness (engine refines in step 5)
const ACTIVE_PARENT = new Set<NodeStatus>(["in-progress", "ready"])

// Production root statuses that retire the whole production: no node under such a root is ever claimed,
// even a deep pending node whose immediate parent is still in-progress. "cancelled" is a human stop;
// "skipped"/"failed" are the loop's own terminal outcomes. (The production status lives on the root node.)
const RETIRED_PRODUCTION = new Set<NodeStatus>(["cancelled", "skipped", "failed"])

export class PgStore implements Store {
	private readonly db: NodePgDatabase<typeof schema>

	constructor(
		pool: Pool,
		private readonly clock: Clock = new SystemClock(),
		private readonly idgen: IdGen = new UuidGen(),
	) {
		this.db = drizzle(pool, { schema })
	}

	// ── identity / tenant seam ────────────────────────────────────────────────────────────────

	async defaultAccount(): Promise<Account> {
		const account = await this.getAccount(DEFAULT_ACCOUNT_ID)
		if (!account) throw new Error("default account missing — run db:seed")
		return account
	}

	async getAccount(id: string): Promise<Account | null> {
		const [row] = await this.db.select().from(accounts).where(eq(accounts.id, id)).limit(1)
		return row ?? null
	}

	async defaultUser(): Promise<User> {
		const user = await this.getUser(DEFAULT_USER_ID)
		if (!user) throw new Error("default user missing — run db:seed")
		return user
	}

	async getUser(id: string): Promise<User | null> {
		const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1)
		return row ?? null
	}

	// ── productions (root node) + tree reads ────────────────────────────────────────────────────

	async createProduction(input: NewProduction): Promise<Node> {
		const id = this.idgen.next("nd")
		const now = this.clock.now()
		const [root] = await this.db
			.insert(nodes)
			.values({
				id,
				accountId: input.accountId,
				userId: input.userId,
				productionId: id, // the root's own id groups the tree
				parentId: null,
				type: input.type ?? "video-project",
				name: deriveName(input.brief),
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
			})
			.returning()
		if (!root) throw new Error("createProduction: insert returned no row")
		await this.db.insert(budget).values({ productionId: id, approved: false }).onConflictDoNothing()
		// push-wake the worker (spec 03); the poll loop is the fallback if no one is LISTENing
		await this.db.execute(sql`SELECT pg_notify('new_production', ${id})`)
		return root
	}

	async getProduction(id: string): Promise<Node | null> {
		return this.getNode(id)
	}

	async listProductions(): Promise<Node[]> {
		return this.db.select().from(nodes).where(isNull(nodes.parentId)).orderBy(desc(nodes.createdAt))
	}

	async getNode(id: string): Promise<Node | null> {
		const [row] = await this.db.select().from(nodes).where(eq(nodes.id, id)).limit(1)
		return row ?? null
	}

	async nodesFor(productionId: string): Promise<Node[]> {
		return this.db.select().from(nodes).where(eq(nodes.productionId, productionId)).orderBy(nodes.position)
	}

	async listReadyNodes(productionId: string): Promise<Node[]> {
		const tree = await this.nodesFor(productionId)
		return tree.filter((n) => isReady(n, tree))
	}

	// Worker claim seam — FOR UPDATE SKIP LOCKED so N workers never grab the same node. v0 runs one
	// worker; readiness is re-checked in JS (the engine refines the exact semantics in step 5).
	async claimReadyNode(): Promise<Node | null> {
		return this.db.transaction(async (tx) => {
			const pending = await tx
				.select()
				.from(nodes)
				.where(eq(nodes.status, "pending"))
				.orderBy(nodes.position)
				.for("update", { skipLocked: true })
			for (const n of pending) {
				const tree = await tx.select().from(nodes).where(eq(nodes.productionId, n.productionId))
				// Never claim work for a retired production (cancelled/skipped/failed). The production status
				// is the root node's status; if it is retired, skip every descendant at any depth.
				const root = tree.find((r) => r.id === n.productionId)
				if (root && RETIRED_PRODUCTION.has(root.status as NodeStatus)) continue
				if (isReady(n, tree)) {
					await tx.update(nodes).set({ status: "in-progress", updatedAt: this.clock.now() }).where(eq(nodes.id, n.id))
					return { ...n, status: "in-progress" }
				}
			}
			return null
		})
	}

	// ── node writes ───────────────────────────────────────────────────────────────────────────

	async updateNodeStatus(id: string, status: NodeStatus): Promise<void> {
		await this.db.update(nodes).set({ status, updatedAt: this.clock.now() }).where(eq(nodes.id, id))
		await this.touch()
	}

	async createChildNodes(parentId: string, children: NewChildNode[]): Promise<Node[]> {
		const parent = await this.getNode(parentId)
		if (!parent) throw new Error(`createChildNodes: parent ${parentId} not found`)
		const now = this.clock.now()
		const rows = children.map((c, i) => ({
			id: this.idgen.next("nd"),
			accountId: null,
			userId: null,
			productionId: parent.productionId,
			parentId,
			type: c.type,
			name: c.name,
			description: c.description ?? null,
			status: "pending" as NodeStatus,
			deps: c.deps ?? [],
			position: c.position ?? i,
			sessionId: null,
			autonomyLever: null,
			actorKind: null,
			createdAt: now,
			updatedAt: now,
		}))
		if (rows.length === 0) return []
		const created = await this.db.insert(nodes).values(rows).returning()
		await this.touch()
		return created
	}

	// ── versions ────────────────────────────────────────────────────────────────────────────────

	async createVersion(input: NewVersion): Promise<Version> {
		const now = this.clock.now()
		const [row] = await this.db
			.insert(versions)
			.values({
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
			})
			.returning()
		if (!row) throw new Error("createVersion: insert returned no row")
		await this.touch()
		return row
	}

	async updateVersion(id: string, patch: VersionPatch): Promise<void> {
		await this.db.update(versions).set({ ...patch, updatedAt: this.clock.now() }).where(eq(versions.id, id))
		await this.touch()
	}

	async getVersion(id: string): Promise<Version | null> {
		const [row] = await this.db.select().from(versions).where(eq(versions.id, id)).limit(1)
		return row ?? null
	}

	async latestVersion(nodeId: string): Promise<Version | null> {
		const [row] = await this.db
			.select()
			.from(versions)
			.where(eq(versions.nodeId, nodeId))
			.orderBy(desc(versions.n))
			.limit(1)
		return row ?? null
	}

	async versionsFor(nodeId: string): Promise<Version[]> {
		return this.db.select().from(versions).where(eq(versions.nodeId, nodeId)).orderBy(versions.n)
	}

	// ── reviews ─────────────────────────────────────────────────────────────────────────────────

	async addReview(input: NewReview): Promise<Review> {
		const [row] = await this.db
			.insert(reviews)
			.values({
				id: this.idgen.next("rev"),
				nodeId: input.nodeId,
				versionId: input.versionId,
				name: input.name,
				kind: input.kind,
				verdict: input.verdict,
				body: input.body ?? null,
				createdAt: this.clock.now(),
			})
			.returning()
		if (!row) throw new Error("addReview: insert returned no row")
		await this.touch()
		return row
	}

	async reviewsFor(versionId: string): Promise<Review[]> {
		return this.db.select().from(reviews).where(eq(reviews.versionId, versionId))
	}

	// ── assets (raw material) ─────────────────────────────────────────────────────────────────────

	async addAsset(input: NewAsset): Promise<Asset> {
		const now = this.clock.now()
		const [row] = await this.db
			.insert(assets)
			.values({
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
			})
			.returning()
		if (!row) throw new Error("addAsset: insert returned no row")
		return row
	}

	async assetsFor(productionId: string): Promise<Asset[]> {
		return this.db.select().from(assets).where(eq(assets.productionId, productionId))
	}

	// ── chat I/O (the human gate) ───────────────────────────────────────────────────────────────

	async emitOutput(input: NewChatOutput): Promise<ChatOutput> {
		const [row] = await this.db
			.insert(chatOutput)
			.values({
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
			})
			.returning()
		if (!row) throw new Error("emitOutput: insert returned no row")
		// push-wake the dashboard on a presentable version (spec 03/06)
		if (row.type === "present") {
			await this.db.execute(sql`SELECT pg_notify('presentable', ${row.productionId})`)
		}
		await this.touch()
		return row
	}

	async getOutput(id: string): Promise<ChatOutput | null> {
		const [row] = await this.db.select().from(chatOutput).where(eq(chatOutput.id, id)).limit(1)
		return row ?? null
	}

	async pendingOutputs(productionId: string): Promise<ChatOutput[]> {
		return this.db
			.select()
			.from(chatOutput)
			.where(and(eq(chatOutput.productionId, productionId), eq(chatOutput.status, "pending")))
			.orderBy(chatOutput.createdAt)
	}

	async recordInput(input: NewChatInput): Promise<ChatInput> {
		const [row] = await this.db
			.insert(chatInput)
			.values({
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
			})
			.returning()
		if (!row) throw new Error("recordInput: insert returned no row")
		return row
	}

	async resolveOutput(id: string): Promise<void> {
		await this.db
			.update(chatOutput)
			.set({ status: "resolved", resolvedAt: this.clock.now() })
			.where(eq(chatOutput.id, id))
		await this.touch()
	}

	// ── budget (money gate) ───────────────────────────────────────────────────────────────────────

	async getBudget(productionId: string): Promise<Budget | null> {
		const [row] = await this.db.select().from(budget).where(eq(budget.productionId, productionId)).limit(1)
		return row ?? null
	}

	async approveBudget(productionId: string): Promise<void> {
		await this.db
			.insert(budget)
			.values({ productionId, approved: true })
			.onConflictDoUpdate({ target: budget.productionId, set: { approved: true } })
		await this.touch()
	}

	// ── subagent usage log ────────────────────────────────────────────────────────────────────────

	async recordInteraction(input: NewInteraction): Promise<Interaction> {
		const [row] = await this.db
			.insert(interactions)
			.values({
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
				numTurns: input.numTurns ?? null,
				apiDurationMs: input.apiDurationMs ?? null,
				status: input.status,
				createdAt: this.clock.now(),
			})
			.returning()
		if (!row) throw new Error("recordInteraction: insert returned no row")
		await this.touch()
		return row
	}

	async interactionsFor(productionId: string): Promise<Interaction[]> {
		return this.db.select().from(interactions).where(eq(interactions.productionId, productionId)).orderBy(interactions.createdAt)
	}

	// Live-dashboard nudge: fire after any write that changes a production's visible state. The payload
	// is empty on purpose — the dashboard refetches whatever production is selected on any nudge (spec
	// 06), so no productionId lookup is needed on the write path. new_production / presentable stay as their
	// own channels for the worker wake-up + inbox badge; this one drives the intra-production updates
	// (producing → review → redo → versions) the operator watches in real time.
	private async touch(): Promise<void> {
		await this.db.execute(sql`SELECT pg_notify('production_changed', '')`)
	}
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────

function deriveName(brief: string): string {
	const trimmed = brief.trim().replace(/\s+/g, " ")
	return trimmed.length <= 60 ? trimmed : `${trimmed.slice(0, 57)}…`
}

// A node is ready when it is pending, every dep is approved, and its parent is still active (or it is
// the root). Pure over a snapshot of the production's nodes. v0-flat: the engine refines this.
function isReady(node: Node, tree: Node[]): boolean {
	if (node.status !== "pending") return false
	const byId = new Map(tree.map((n) => [n.id, n]))
	for (const depId of node.deps) {
		if (byId.get(depId)?.status !== "approved") return false
	}
	if (node.parentId) {
		const parent = byId.get(node.parentId)
		if (!parent || !ACTIVE_PARENT.has(parent.status as NodeStatus)) return false
	}
	return true
}
