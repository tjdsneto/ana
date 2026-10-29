// Media serving for the dashboard: list the produced .mp4 artifacts and stream one by relative path.
// The web-api container bind-mounts server/data/artifacts at ARTIFACTS_DIR (/data/artifacts), so the
// same files the engine writes are readable here. Everything resolves UNDER that root — a traversal
// guard (resolveUnderRoot) rejects any path that escapes it, so ?path= can't read outside artifacts.

import type { Dirent } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"

export interface VideoFile {
	path: string // relative to the artifacts root; the key the stream route takes as ?path=
	name: string
	dir: string // the containing folder, relative to root ("" for root-level) — groups renders by production
	sizeBytes: number
	mtimeMs: number
}

// The artifacts root as an absolute, normalised path. Everything served is checked to live under it.
export function artifactsRoot(): string {
	return resolve(process.env.ARTIFACTS_DIR ?? "/data/artifacts")
}

// Every .mp4 under root, newest first. Walks recursively; unreadable dirs are skipped, not fatal.
export async function listVideos(root: string): Promise<VideoFile[]> {
	const out: VideoFile[] = []
	async function walk(dir: string): Promise<void> {
		let entries: Dirent[]
		try {
			entries = await readdir(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const e of entries) {
			const full = join(dir, e.name)
			// Skip the render working dirs (local-<uuid>) in THIS list — they hold per-scene work clips,
			// not finished videos; only the final .mp4 sits in the parent folder. The clips are KEPT on
			// disk (retention, spec 08); they are just not shown in the final-videos gallery.
			if (e.isDirectory()) {
				if (!/^local-[0-9a-f]{6,}$/i.test(e.name)) await walk(full)
			} else if (e.isFile() && e.name.toLowerCase().endsWith(".mp4")) {
				const info = await stat(full)
				const rel = relative(root, full)
				out.push({ path: rel, name: e.name, dir: relative(root, dir), sizeBytes: info.size, mtimeMs: info.mtimeMs })
			}
		}
	}
	await walk(root)
	out.sort((a, b) => b.mtimeMs - a.mtimeMs)
	return out
}

// Resolve a relative path under root, guarding against traversal. Returns null if it escapes root.
// Accepts an already-absolute path too (e.g. a version's stored /data/artifacts/... path) by making
// it relative to root first, so one guard covers both the gallery (?path=) and version_id lookups.
export function resolveUnderRoot(root: string, p: string): string | null {
	const rel = p.startsWith(root) ? relative(root, p) : p
	const abs = resolve(root, rel)
	if (abs !== root && !abs.startsWith(root + sep)) return null
	return abs
}
