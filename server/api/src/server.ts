// The dashboard HTTP API. Reads assemble view DTOs (queries.ts); the two gate writes call the shared
// @core/services layer — the exact same functions the MCP tools call (spec 06: "the one write path
// stays in the server"), so there is no second copy of the gate logic to drift. Returns an express
// app; index.ts wraps it in an http.Server and attaches the WebSocket.

import { readFile, stat } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { approve, approveBudget, getDeliverable, submitFeedback } from "@core/services"
import type { Logger, Store } from "@core/shared"
import express from "express"
import { artifactsRoot, contentTypeFor, listMedia, listVideos, locateUnderRoot, type MediaFile, resolveUnderRoot } from "./media.js"
import { listProductions, productionDetail } from "./queries.js"

// Inline only small text artifacts, matching the service's own cap. Binary artifacts stream instead.
const MAX_INLINE_ARTIFACT_BYTES = 64 * 1024
const BINARY_ARTIFACT_RE = /\.(mp4|mov|webm|mkv|avi|wav|mp3|m4a|aac|ogg|flac|png|jpe?g|gif|webp|svg|pdf)$/i

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
	// The service reads content off the version's stored path, but that path may be a host-absolute
	// path this container can't open (the engine writes two path shapes). If the content came back
	// empty, re-root the path under the mounted artifacts dir and read it here — the same remap the
	// video route relies on — so briefing/script/moodboard/storyboard render instead of showing a path.
	app.get(
		"/api/deliverable",
		handle("deliverable", async (req) => {
			const d = await getDeliverable(store, {
				versionId: req.query.version_id as string | undefined,
				nodeId: req.query.node_id as string | undefined,
			})
			if (d.content != null || !d.artifact_path || BINARY_ARTIFACT_RE.test(d.artifact_path)) return d
			const abs = locateUnderRoot(artifactsRoot(), d.artifact_path)
			if (!abs) return d
			try {
				const info = await stat(abs)
				if (info.isFile() && info.size <= MAX_INLINE_ARTIFACT_BYTES) {
					return { ...d, content: await readFile(abs, "utf8") }
				}
			} catch {
				// still not readable — fall through and return the path only
			}
			return d
		}),
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
			const abs = target ? locateUnderRoot(root, target) : null
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

	// ── media (audio / image / any produced file) ─────────────────────────────────────────────────
	// Stream one media file by ?path= (relative, from /api/media-list) or ?version_id=. Content-Type is
	// derived from the extension, so this serves audio (vo/soundtrack .wav/.mp3) and images (assets)
	// the same way /api/video serves .mp4. res.sendFile handles Range so <audio>/<video> can seek.
	app.get("/api/media", async (req, res) => {
		try {
			const root = artifactsRoot()
			let target: string | null = null
			if (typeof req.query.version_id === "string") {
				const d = await getDeliverable(store, { versionId: req.query.version_id })
				target = d.artifact_path
			} else if (typeof req.query.path === "string") {
				target = req.query.path
			}
			const abs = target ? locateUnderRoot(root, target) : null
			if (!abs) {
				res.status(400).json({ error: "pass ?path= (relative, from /api/media-list) or ?version_id=" })
				return
			}
			res.sendFile(abs, { headers: { "Content-Type": contentTypeFor(abs) ?? "application/octet-stream" } }, (err) => {
				if (err && !res.headersSent) res.status(404).json({ error: "media not found" })
			})
		} catch (err) {
			if (!res.headersSent) res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
		}
	})

	// List the audio/image/video files a node produced, under <production_id>/<dir> (relative to the
	// artifacts root). Used by the dashboard media strips: build-assets → "assets", build-soundtrack →
	// "board/audio", build-voice → "board/media/vo". Guarded under root; empty list if the dir is absent.
	app.get(
		"/api/media-list",
		handle("media_list", async (req) => {
			const pid = typeof req.query.production_id === "string" ? req.query.production_id : undefined
			if (!pid) throw new Error("pass ?production_id=")
			const dir = typeof req.query.dir === "string" ? req.query.dir : ""
			const root = artifactsRoot()
			const startAbs = resolveUnderRoot(root, join(pid, dir))
			if (!startAbs) return { files: [] as MediaFile[] }
			const requested = (typeof req.query.kinds === "string" ? req.query.kinds.split(",") : ["audio", "image", "video"]).filter((k): k is MediaFile["kind"] => k === "audio" || k === "image" || k === "video")
			return { files: await listMedia(root, startAbs, new Set(requested)) }
		}),
	)

	// ── storyboard board image ─────────────────────────────────────────────────────────────────
	// The rendered board sheet for a storyboard version (one card per beat). The producer saves it to
	// <prod>/boards/<type>-v<n>.jpg beside the version's artifact; derive that from the version's
	// artifact_path and stream it. 404 is normal for versions produced before boards existed.
	app.get("/api/board", async (req, res) => {
		try {
			if (typeof req.query.version_id !== "string") {
				res.status(400).json({ error: "pass ?version_id=" })
				return
			}
			const d = await getDeliverable(store, { versionId: req.query.version_id })
			if (!d.artifact_path) {
				res.status(404).json({ error: "no artifact for this version" })
				return
			}
			const boardRel = join(dirname(d.artifact_path), "boards", basename(d.artifact_path).replace(/\.[^.]+$/, ".jpg"))
			const abs = locateUnderRoot(artifactsRoot(), boardRel)
			if (!abs) {
				res.status(404).json({ error: "no board for this version" })
				return
			}
			res.sendFile(abs, { headers: { "Content-Type": "image/jpeg" } }, (err) => {
				if (err && !res.headersSent) res.status(404).json({ error: "board not found" })
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
