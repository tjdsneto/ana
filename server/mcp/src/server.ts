// MCP wiring — maps the pure handlers (tools.ts) onto an McpServer with zod input schemas. Wire
// param names are snake_case (spec 04); the handlers take camelCase, so each registration adapts.
// Verified against @modelcontextprotocol/sdk 1.32.2 (registerTool(name, {description, inputSchema},
// cb); inputSchema is a raw zod shape; cb returns { content: [{type:"text", text}] }).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { Store } from "@app/shared"
import { z } from "zod"
import { approve, approveBudget, getDeliverable, getStatus, inbox, requestVideo, submitFeedback } from "./tools.js"

function ok(data: unknown): CallToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
}

function fail(err: unknown): CallToolResult {
	const message = err instanceof Error ? err.message : String(err)
	return { content: [{ type: "text", text: message }], isError: true }
}

export function buildServer(store: Store): McpServer {
	const server = new McpServer({ name: "production-engine", version: "0.0.0" })

	server.registerTool(
		"request_video",
		{
			description: "Start a video production from a brief. Hands off: inserts the root node and returns its production_id immediately — the engine worker produces it.",
			inputSchema: {
				brief: z.string(),
				session_id: z.string(),
				autonomy_lever: z.enum(["low", "medium", "high"]).optional(),
				actor_kind: z.enum(["human", "agent"]).optional(),
			},
		},
		async (a) => {
			try {
				return ok(
					await requestVideo(store, {
						brief: a.brief,
						sessionId: a.session_id,
						autonomyLever: a.autonomy_lever,
						actorKind: a.actor_kind,
					}),
				)
			} catch (err) {
				return fail(err)
			}
		},
	)

	server.registerTool(
		"get_status",
		{
			description: "Read a production's status plus its node/version progress and anything presentable.",
			inputSchema: { production_id: z.string() },
		},
		async (a) => {
			try {
				return ok(await getStatus(store, { productionId: a.production_id }))
			} catch (err) {
				return fail(err)
			}
		},
	)

	server.registerTool(
		"inbox",
		{
			description: "The pending chat_output queue for a production — everything the engine needs the user to see.",
			inputSchema: { production_id: z.string() },
		},
		async (a) => {
			try {
				return ok(await inbox(store, { productionId: a.production_id }))
			} catch (err) {
				return fail(err)
			}
		},
	)

	server.registerTool(
		"get_deliverable",
		{
			description: "Read a produced version's artifact (by version_id, or the latest for a node_id).",
			inputSchema: { version_id: z.string().optional(), node_id: z.string().optional() },
		},
		async (a) => {
			try {
				return ok(await getDeliverable(store, { versionId: a.version_id, nodeId: a.node_id }))
			} catch (err) {
				return fail(err)
			}
		},
	)

	server.registerTool(
		"approve",
		{
			description: "Approve a presented version (by output_id from the inbox, or directly by version_id). Unblocks the next pass.",
			inputSchema: { output_id: z.string().optional(), version_id: z.string().optional() },
		},
		async (a) => {
			try {
				return ok(await approve(store, { outputId: a.output_id, versionId: a.version_id }))
			} catch (err) {
				return fail(err)
			}
		},
	)

	server.registerTool(
		"submit_feedback",
		{
			description: "Give feedback on a presented version (output_id) to trigger a redo, or unsolicited feedback on a production (production_id).",
			inputSchema: { output_id: z.string().optional(), production_id: z.string().optional(), body: z.string() },
		},
		async (a) => {
			try {
				return ok(await submitFeedback(store, { outputId: a.output_id, productionId: a.production_id, body: a.body }))
			} catch (err) {
				return fail(err)
			}
		},
	)

	server.registerTool(
		"approve_budget",
		{
			description: "Approve the render-spend budget so the worker may proceed past a money gate.",
			inputSchema: { production_id: z.string() },
		},
		async (a) => {
			try {
				return ok(await approveBudget(store, { productionId: a.production_id }))
			} catch (err) {
				return fail(err)
			}
		},
	)

	return server
}
