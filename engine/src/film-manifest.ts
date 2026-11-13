// board/film.json is the authoritative shared manifest (Option B — see
// docs/lisa/progressive-film-json-design.md). It is created at production start and edited in place by
// each contributing node as it approves. This module owns the file's shape, a read-modify-write that
// touches only the given keys, and a per-slice hash — no engine or craft logic lives here. Dependency-
// free so it unit-tests anywhere.

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export interface FilmManifest {
	script?: string[]
	camera?: unknown[]
	plates?: Record<string, unknown>
	voice?: Record<string, unknown>
	music?: unknown
	audio?: unknown
	size?: { width: number; height: number }
	[key: string]: unknown
}

export function emptyManifest(): FilmManifest {
	return { script: [], camera: [], plates: {} }
}

export function readManifest(path: string): FilmManifest {
	if (!existsSync(path)) return emptyManifest()
	try {
		return JSON.parse(readFileSync(path, "utf8")) as FilmManifest
	} catch {
		return emptyManifest()
	}
}

// Create the skeleton if absent. Idempotent: an existing manifest is left untouched, so a worker restart
// or a reopen never wipes slices other nodes already wrote.
export function seedManifest(path: string): void {
	if (existsSync(path)) return
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, JSON.stringify(emptyManifest(), null, 2))
}

// Merge the given keys into the manifest in place, preserving every other key. Returns the merged result.
// (Writes are serialized operationally — one worker during reopen loops; sub-plan 5 adds an advisory lock
// for parallel fan-out.)
export function writeSlice(path: string, slice: Partial<FilmManifest>): FilmManifest {
	const next: FilmManifest = { ...readManifest(path), ...slice }
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, JSON.stringify(next, null, 2))
	return next
}

// Keep only the named keys that are present in `obj` — a node's slice is just its owned keys.
export function pickKeys(obj: Record<string, unknown>, keys: string[]): Partial<FilmManifest> {
	const out: Record<string, unknown> = {}
	for (const k of keys) if (k in obj) out[k] = obj[k]
	return out
}

// Parse a slice object from a manifest-owning producer's output: a bare JSON object, or the first fenced
// ```json block in prose. Returns {} when there is no JSON object (or the JSON isn't an object), so a
// malformed produce degrades to "wrote no slice" instead of throwing.
export function parseSliceJson(output: string): Record<string, unknown> {
	const fenced = output.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
	const candidates = [fenced?.[1], output]
	for (const c of candidates) {
		if (!c) continue
		try {
			const v = JSON.parse(c.trim())
			if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
		} catch {
			// try the next candidate
		}
	}
	return {}
}

// A stable 16-hex hash of ONLY the named keys — the per-slice builtFrom primitive (sub-plan 2). Keys are
// sorted so arg order doesn't matter; keys outside the set never affect the hash.
export function sliceHash(m: FilmManifest, keys: string[]): string {
	const picked: Record<string, unknown> = {}
	for (const k of [...keys].sort()) picked[k] = m[k]
	return createHash("sha256").update(JSON.stringify(picked)).digest("hex").slice(0, 16)
}
