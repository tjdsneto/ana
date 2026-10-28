// The dashboard HTTP API. Reads assemble view DTOs (queries.ts); the two gate writes reuse the MCP
// tool handlers verbatim (spec 06: "the one write path stays in the server"), so approve/feedback go
// through the exact same code as the MCP tool surface — no second write path to drift. Returns an
// express app; index.ts wraps it in an http.Server and attaches the WebSocket.

import { approve, approveBudget, getDeliverable, submitFeedback } from "@app/mcp/tools"
import type { Logger, Store } from "@app/shared"
import express from "express"
import { listProductions, productionDetail } from "./queries.js"

// Open CORS: the Vite dev app (port 5173) calls this API (port 8788) cross-origin. Dev tool only.
function cors(_req: express.Request, res: express.Response, next: express.NextFunction): void {
	res.header("Access-Control-Allow-Origin", "*")
	res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	res.header("Access-Control-Allow-Headers", "Content-Type")
	if (_req.method === "OPTIONS") {
		res.status(204).end()
		return
	}
	next()
}

export function buildApi(store: Store, logger: Logger): express.Express {
	const app = express()
	app.use(express.json())
	app.use(cors)

	// Time + log a request, mapping the handler's result (or error) to JSON.
	const handle = (name: string, fn: (req: express.Request) => Promise<unknown>) => async (req: express.Request, res: express.Response) => {
		const t0 = Date.now()
		try {
			const data = await fn(req)
			logger.info("api.call", { route: name, ms: Date.now() - t0, ok: true })
			res.json(data)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			logger.warn("api.call", { route: name, ms: Date.now() - t0, ok: false, error: message })
			res.status(400).json({ error: message })
		}
	}

	// ── reads ──────────────────────────────────────────────────────────────────────────────────
	app.get("/api/health", (_req, res) => res.json({ ok: true }))
	app.get("/api/productions", handle("productions", () => listProductions(store)))
	app.get("/api/productions/:id", handle("production_detail", (req) => {
		const id = req.params.id
		if (!id) throw new Error("missing production id")
		return productionDetail(store, id)
	}))
	app.get(
		"/api/deliverable",
		handle("deliverable", (req) => getDeliverable(store, { versionId: req.query.version_id as string | undefined, nodeId: req.query.node_id as string | undefined })),
	)

	// ── gate writes (reuse the MCP tool handlers) ────────────────────────────────────────────────
	app.post("/api/approve", handle("approve", (req) => approve(store, { outputId: req.body.output_id, versionId: req.body.version_id })))
	app.post("/api/feedback", handle("feedback", (req) => submitFeedback(store, { outputId: req.body.output_id, productionId: req.body.production_id, body: req.body.body })))
	app.post("/api/approve-budget", handle("approve_budget", (req) => approveBudget(store, { productionId: req.body.production_id })))

	return app
}
