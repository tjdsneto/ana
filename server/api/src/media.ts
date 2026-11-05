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

// One produced media file (audio/image/video) under a node's output dir — for the dashboard media strips
// (build-assets gallery, build-voice / build-soundtrack players).
export interface MediaFile {
	path: string // relative to the artifacts root; the key /api/media takes as ?path=
	name: string
	dir: string // containing folder relative to root
	kind: "audio" | "image" | "video"
	sizeBytes: number
	mtimeMs: number
}

const MIME: Record<string, string> = {
	mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
	wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac",
	png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
}

// The servable content-type for a filename by extension, or undefined for an unknown/non-media type.
export function contentTypeFor(name: string): string | undefined {
	const ext = name.split(".").pop()?.toLowerCase()
	return ext ? MIME[ext] : undefined
}

// Classify a filename as audio / image / video for the media strips, or null if it is neither.
export function mediaKind(name: string): MediaFile["kind"] | null {
	const ct = contentTypeFor(name)
	if (!ct) return null
	if (ct.startsWith("audio")) return "audio"
	if (ct.startsWith("image")) return "image"
	if (ct.startsWith("video")) return "video"
	return null
}

// Every audio/image/video file under `startAbs` (already resolved under root), capped. Walks
// recursively; unreadable dirs are skipped. Paths are relative to root (the /api/media ?path= key).
export async function listMedia(root: string, startAbs: string, kinds: Set<MediaFile["kind"]>): Promise<MediaFile[]> {
	const out: MediaFile[] = []
	const CAP = 300
	async function walk(dir: string): Promise<void> {
		if (out.length >= CAP) return
		let entries: Dirent[]
		try {
			entries = await readdir(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const e of entries) {
			if (out.length >= CAP) break
			const full = join(dir, e.name)
			if (e.isDirectory()) {
				await walk(full)
			} else if (e.isFile()) {
				const k = mediaKind(e.name)
				if (k && kinds.has(k)) {
					const info = await stat(full)
					out.push({ path: relative(root, full), name: e.name, dir: relative(root, dir), kind: k, sizeBytes: info.size, mtimeMs: info.mtimeMs })
				}
			}
		}
	}
	await walk(startAbs)
	out.sort((a, b) => (a.path < b.path ? -1 : 1))
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

// Map ANY stored artifact path onto this container's artifacts root, then guard it. The engine has
// stored two shapes: a container path (/data/artifacts/…) and a host-absolute path
// (…/server/data/artifacts/…). Only the former is mounted here, so when a path does not already sit
// under root we re-root it on its last "artifacts/" segment — the same file, reached through the
// mount. Returns null if it can't be placed under root. Used by both the deliverable read and the
// video stream so neither depends on which shape the engine happened to write.
export function locateUnderRoot(root: string, p: string): string | null {
	const direct = resolveUnderRoot(root, p)
	if (direct) return direct
	const marker = `artifacts${sep}`
	const idx = p.lastIndexOf(marker)
	if (idx === -1) return null
	return resolveUnderRoot(root, p.slice(idx + marker.length))
}
