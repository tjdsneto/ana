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
