// Drizzle schema — the canonical shape of the Postgres store. Mirrors spec 03.
// Status / kind / type columns stay `text` in v0 (the TS unions in types.ts carry the allowed
// values; promote to pg enums / CHECK constraints later). Ids are app-generated strings (IdGen).

import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import type {
	ActorKind,
	AssetType,
	AutonomyLever,
	ChatInputKind,
	ChatOutputType,
	FileType,
	ReviewKind,
	ReviewVerdict,
	SubagentRef,
} from "./types.js"

export const accounts = pgTable("accounts", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable("users", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull().references(() => accounts.id), // account 1—* users
	name: text("name").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const nodes = pgTable(
	"nodes",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").references(() => accounts.id), // root only; NULL on children
		userId: text("user_id").references(() => users.id), // root only; NULL on children
		productionId: text("production_id").notNull(), // groups one tree; equals the root node id
		parentId: text("parent_id"), // NULL = root = the production (self-ref; left unconstrained to allow root insert)
		type: text("type").notNull(), // resolved against the type registry (files)
		name: text("name").notNull(),
		description: text("description"),
		status: text("status").notNull(),
		deps: jsonb("deps").$type<string[]>().notNull().default([]), // sibling prerequisites (node ids)
		position: integer("position").notNull().default(0),
		sessionId: text("session_id"), // root only: owning client session (nudge target)
		autonomyLever: text("autonomy_lever").$type<AutonomyLever>(), // root only
		actorKind: text("actor_kind").$type<ActorKind>(), // root only: human | agent — sets the agreement cap
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("idx_nodes_production").on(t.productionId),
		index("idx_nodes_parent").on(t.parentId),
		index("idx_nodes_account").on(t.accountId),
	],
)

export const versions = pgTable(
	"versions",
	{
		id: text("id").primaryKey(),
		nodeId: text("node_id").notNull().references(() => nodes.id),
		n: integer("n").notNull(), // 1, 2, 3, …
		prevVersionId: text("prev_version_id"), // lineage (self-ref)
		status: text("status").notNull(),
		artifactPath: text("artifact_path"), // file on the shared volume (not in the DB)
		subagent: jsonb("subagent").$type<SubagentRef>(), // attached subagent + state (idempotency)
		feedback: text("feedback"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("idx_versions_node").on(t.nodeId)],
)

export const reviews = pgTable("reviews", {
	id: text("id").primaryKey(),
	nodeId: text("node_id").notNull().references(() => nodes.id),
	versionId: text("version_id").notNull().references(() => versions.id),
	name: text("name").notNull(), // rubric name (craft side; files)
	kind: text("kind").$type<ReviewKind>().notNull(), // craft | coverage | consistency
	verdict: text("verdict").$type<ReviewVerdict>().notNull(), // pass | revise
	body: text("body"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const assets = pgTable(
	"assets",
	{
		id: text("id").primaryKey(),
		productionId: text("production_id").notNull(),
		nodeId: text("node_id").references(() => nodes.id), // producer/gatherer node (nullable)
		name: text("name").notNull(),
		description: text("description"),
		assetType: text("asset_type").$type<AssetType>().notNull(), // ROLE
		fileType: text("file_type").$type<FileType>().notNull(), // FORMAT
		storagePath: text("storage_path").notNull(), // file on the shared volume
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("idx_assets_production").on(t.productionId)],
)

// engine → chat: everything to SHOW the user
export const chatOutput = pgTable(
	"chat_output",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id"),
		userId: text("user_id"), // the user this message is for
		productionId: text("production_id").notNull(),
		nodeId: text("node_id"),
		versionId: text("version_id"),
		type: text("type").$type<ChatOutputType>().notNull(), // present | notify | question | options
		status: text("status").$type<"pending" | "resolved">().notNull(),
		prompt: text("prompt"),
		options: jsonb("options").$type<string[]>(), // array (for options / confirm)
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
	},
	(t) => [index("idx_chat_output_pending").on(t.productionId, t.status)],
)

// chat → engine: everything FROM the user (absorbs the old feedback table)
export const chatInput = pgTable(
	"chat_input",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id"),
		userId: text("user_id"), // the user this message came from
		productionId: text("production_id").notNull(),
		nodeId: text("node_id"),
		versionId: text("version_id"),
		respondsTo: text("responds_to").references(() => chatOutput.id), // NULL = unsolicited
		kind: text("kind").$type<ChatInputKind>().notNull(), // approve | feedback | answer
		body: text("body"), // feedback text / chosen answer
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("idx_chat_input_production").on(t.productionId)],
)

export const budget = pgTable("budget", {
	productionId: text("production_id").primaryKey(),
	approved: boolean("approved").notNull().default(false), // money-gate flag
})

// subagent interactions — one row per SubagentRunner.run() (a producer draft or one reviewer pass).
// Records which engine/model ran, the provider session id, token usage + cost, and timing. Per-call
// = the row; whole-session = SUM(...) GROUP BY session_id. Written by the engine; read by the web app.
export const interactions = pgTable(
	"interactions",
	{
		id: text("id").primaryKey(),
		productionId: text("production_id").notNull(),
		nodeId: text("node_id").notNull().references(() => nodes.id),
		versionId: text("version_id").references(() => versions.id), // the version produced / reviewed (nullable)
		role: text("role").notNull(), // producer | review:craft | review:coverage | …
		engine: text("engine").notNull(), // claude | codex | openai | fake
		model: text("model"), // resolved model, when the engine reports one
		sessionId: text("session_id"), // provider session (claude session_id); nullable
		inputTokens: integer("input_tokens"),
		outputTokens: integer("output_tokens"),
		cacheReadTokens: integer("cache_read_tokens"),
		cacheCreationTokens: integer("cache_creation_tokens"),
		costUsd: doublePrecision("cost_usd"),
		durationMs: integer("duration_ms"),
		status: text("status").notNull(), // done | failed
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("idx_interactions_production").on(t.productionId), index("idx_interactions_session").on(t.sessionId)],
)
