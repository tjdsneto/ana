// The dashboard HTTP API. Reads assemble view DTOs (queries.ts); the two gate writes call the shared
// @core/services layer — the exact same functions the MCP tools call (spec 06: "the one write path
// stays in the server"), so there is no second copy of the gate logic to drift. Returns an express
// app; index.ts wraps it in an http.Server and attaches the WebSocket.

import { approve, approveBudget, getDeliverable, submitFeedback } from "@core/services"
import type { Logger, Store } from "@core/shared"
import express from "express"
import { artifactsRoot, listVideos, resolveUnderRoot } from "./media.js"
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
		if (typeof id !== "string") throw new Error("missing production id") // express 5 types params as string | string[]
		return productionDetail(store, id)
	}))
	app.get(
		"/api/deliverable",
		handle("deliverable", (req) => getDeliverable(store, { versionId: req.query.version_id as string | undefined, nodeId: req.query.node_id as string | undefined })),
	)

	// ── video (the produced .mp4 artifacts) ───────────────────────────────────────────────────────
	// Gallery list: every .mp4 under the artifacts root, newest first.
	app.get("/api/videos", handle("videos", () => listVideos(artifactsRoot())))
	// Stream one .mp4 by ?path= (relative, from /api/videos) or ?version_id= (its stored artifact).
	// res.sendFile handles Range/206 so the <video> element can seek. Both resolve UNDER the root.
	app.get("/api/video", async (req, res) => {
		try {
			const root = artifactsRoot()
			let target: string | null = null
			if (typeof req.query.version_id === "string") {
				const d = await getDeliverable(store, { versionId: req.query.version_id })
				target = d.artifact_path
			} else if (typeof req.query.path === "string") {
				target = req.query.path
			}
			const abs = target ? resolveUnderRoot(root, target) : null
			if (!abs) {
				res.status(400).json({ error: "pass ?path= (relative) or ?version_id= of an .mp4 under the artifacts root" })
				return
			}
			res.sendFile(abs, { headers: { "Content-Type": "video/mp4" } }, (err) => {
				if (err && !res.headersSent) res.status(404).json({ error: "artifact not found" })
			})
		} catch (err) {
			if (!res.headersSent) res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
		}
	})

	// ── gate writes (reuse the MCP tool handlers) ────────────────────────────────────────────────
	app.post("/api/approve", handle("approve", (req) => approve(store, { outputId: req.body.output_id, versionId: req.body.version_id })))
	app.post("/api/feedback", handle("feedback", (req) => submitFeedback(store, { outputId: req.body.output_id, productionId: req.body.production_id, body: req.body.body })))
	app.post("/api/approve-budget", handle("approve_budget", (req) => approveBudget(store, { productionId: req.body.production_id })))

	return app
}
