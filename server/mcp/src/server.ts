// MCP wiring — maps the application service layer (@core/services) onto an McpServer with zod input
// schemas. This package is pure transport: no business logic lives here. Wire param names are
// snake_case (spec 04); the service functions take camelCase, so each registration adapts.
// Verified against @modelcontextprotocol/sdk 1.32.2 (registerTool(name, {description, inputSchema},
// cb); inputSchema is a raw zod shape; cb returns { content: [{type:"text", text}] }). Every call is
// timed + logged through the injected Logger (default quiet).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { approve, approveBudget, getCapabilities, getDeliverable, getStatus, inbox, requestVideo, submitFeedback } from "@core/services"
import { type Logger, NoopLogger, type Store } from "@core/shared"
import { z } from "zod"

function ok(data: unknown): CallToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
}

function fail(err: unknown): CallToolResult {
	const message = err instanceof Error ? err.message : String(err)
	return { content: [{ type: "text", text: message }], isError: true }
}

export function buildServer(store: Store, logger: Logger = new NoopLogger()): McpServer {
	const server = new McpServer({ name: "production-engine", version: "0.0.0" })

	// Time + log a handler call, mapping its result (or error) to a CallToolResult.
	async function run(tool: string, fn: () => Promise<unknown>): Promise<CallToolResult> {
		const t0 = Date.now()
		try {
			const data = await fn()
			logger.info("tool.call", { tool, ms: Date.now() - t0, ok: true })
			return ok(data)
		} catch (err) {
			logger.warn("tool.call", { tool, ms: Date.now() - t0, ok: false, error: err instanceof Error ? err.message : String(err) })
			return fail(err)
		}
	}

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
		(a) => run("request_video", () => requestVideo(store, { brief: a.brief, sessionId: a.session_id, autonomyLever: a.autonomy_lever, actorKind: a.actor_kind })),
	)

	server.registerTool(
		"get_capabilities",
		{
			description: "List what the engine can produce: the rootCapable capabilities (a full video-project, and standalone ones like scene / clip / card) with their intake params. Call this first to discover what can be requested and what each needs; then request_video (or a typed production) with those params.",
			inputSchema: {},
		},
		() => run("get_capabilities", async () => getCapabilities()),
	)

	server.registerTool(
		"get_status",
		{ description: "Read a production's status plus its node/version progress and anything presentable.", inputSchema: { production_id: z.string() } },
		(a) => run("get_status", () => getStatus(store, { productionId: a.production_id })),
	)

	server.registerTool(
		"inbox",
		{ description: "The pending chat_output queue for a production — everything the engine needs the user to see.", inputSchema: { production_id: z.string() } },
		(a) => run("inbox", () => inbox(store, { productionId: a.production_id })),
	)

	server.registerTool(
		"get_deliverable",
		{ description: "Read a produced version's artifact (by version_id, or the latest for a node_id).", inputSchema: { version_id: z.string().optional(), node_id: z.string().optional() } },
		(a) => run("get_deliverable", () => getDeliverable(store, { versionId: a.version_id, nodeId: a.node_id })),
	)

	server.registerTool(
		"approve",
		{ description: "Approve a presented version (by output_id from the inbox, or directly by version_id). Unblocks the next pass.", inputSchema: { output_id: z.string().optional(), version_id: z.string().optional() } },
		(a) => run("approve", () => approve(store, { outputId: a.output_id, versionId: a.version_id })),
	)

	server.registerTool(
		"submit_feedback",
		{ description: "Give feedback on a presented version (output_id) to trigger a redo, or unsolicited feedback on a production (production_id).", inputSchema: { output_id: z.string().optional(), production_id: z.string().optional(), body: z.string() } },
		(a) => run("submit_feedback", () => submitFeedback(store, { outputId: a.output_id, productionId: a.production_id, body: a.body })),
	)

	server.registerTool(
		"approve_budget",
		{ description: "Approve the render-spend budget so the worker may proceed past a money gate.", inputSchema: { production_id: z.string() } },
		(a) => run("approve_budget", () => approveBudget(store, { productionId: a.production_id })),
	)

	return server
}
