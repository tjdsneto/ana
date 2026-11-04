// Capability discovery — the read-only catalog of what a caller can ask the engine to produce. A
// "capability" is a rootCapable type: a production can be rooted at it directly (a full video-project,
// or a single scene / clip / card / …). This lives in @core/shared (not @engine/worker) so the MCP
// server can expose it without importing the engine — MCP stays pure transport. It only READS the
// type.json files; the engine's TypeRegistry still owns dispatch.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export interface CapabilityInput {
	name: string
	required?: boolean
	default?: unknown
	description?: string
}

export interface Capability {
	type: string
	name?: string
	description?: string // one-line summary of what this capability produces (from the type.json)
	inputs?: CapabilityInput[]
}

// Read every `<typesDir>/<type>/type.json` and return the rootCapable ones as the offerable catalog,
// sorted by type. Malformed or missing files are skipped. Internal plumbing (rootCapable absent/false)
// is never returned, so the MCP surface can't expose it.
export function loadCapabilities(typesDir: string): Capability[] {
	if (!existsSync(typesDir)) return []
	const out: Capability[] = []
	for (const entry of readdirSync(typesDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const file = join(typesDir, entry.name, "type.json")
		if (!existsSync(file)) continue
		try {
			const c = JSON.parse(readFileSync(file, "utf8")) as { type?: string; name?: string; description?: string; rootCapable?: boolean; inputs?: CapabilityInput[] }
			if (c.rootCapable && c.type) out.push({ type: c.type, name: c.name, description: c.description, inputs: c.inputs })
		} catch {
			// skip a malformed type.json — it just isn't offered
		}
	}
	return out.sort((a, b) => a.type.localeCompare(b.type))
}

// A production capability — a generic class of production method the Phase-2 planner matches against.
// "Hybrid depth": structured fields are the hard constraints Phase 2 matches deterministically
// (produces / inputs / aspect / length / tier / hosted); `guidance` is the soft craft prose Phase 2
// judges. Capabilities name generic CLASSES only — never a concrete vendor/brand (the concrete backend
// is a later provisioning/config concern).
export interface ProductionCapability {
	id: string // generic class id, e.g. "screen-recording" | "generative-image" | "avatar-presenter"
	name: string
	produces: string[] // "image" | "video" | "audio" | "clip" — what Phase 2 can bind it to
	inputs: string[] // what it needs (e.g. ["url"], ["prompt"], ["script"])
	aspect: string[] // supported aspect ratios
	length?: { minS?: number; maxS?: number } // clip length constraints
	tier: "free" | "paid" // cost tier (Phase 2 surfaces paid per the autonomy lever)
	hosted: boolean // hosted vs local
	guidance: string // prose: when this class shines, its feel (Phase 2 judges)
}

// Read every `<dir>/*.json` production-capability file and return them sorted by id. Malformed files
// (bad JSON or no `id`) are skipped. A missing dir yields []. Mirrors loadCapabilities' tolerance: a
// bad entry just isn't offered, it doesn't break discovery.
export function loadProductionCapabilities(dir: string): ProductionCapability[] {
	if (!existsSync(dir)) return []
	const out: ProductionCapability[] = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) continue
		try {
			const c = JSON.parse(readFileSync(join(dir, entry.name), "utf8")) as ProductionCapability
			if (c.id) out.push(c)
		} catch {
			// skip a malformed capability file
		}
	}
	return out.sort((a, b) => a.id.localeCompare(b.id))
}
