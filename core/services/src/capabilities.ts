// get_capabilities — the catalog of what a caller can ask the engine to produce. Two layers:
// `rootCapable` (the rootCapable types + their intake schema — what a production can be rooted at) and
// `production` (the production-capability registry the Phase-2 planner matches against). Reads the
// type registry and the capability data files via @core/shared's loaders, so the MCP server can expose
// both without importing the engine. Dirs resolve from the same env the worker uses
// (AUTONOMY_TYPES_DIR / AUTONOMY_CAPS_DIR, else <AUTONOMY_ROOT>/types and
// <AUTONOMY_ROOT>/engine/capabilities), or passed explicitly.

import { join } from "node:path"
import { type Capability, type ProductionCapability, loadCapabilities, loadProductionCapabilities } from "@core/shared"

export interface GetCapabilitiesOptions {
	typesDir?: string
	capsDir?: string
}

export interface Capabilities {
	rootCapable: Capability[]
	production: ProductionCapability[]
}

export function getCapabilities(opts: GetCapabilitiesOptions = {}): Capabilities {
	const typesDir = opts.typesDir ?? process.env.AUTONOMY_TYPES_DIR ?? (process.env.AUTONOMY_ROOT ? join(process.env.AUTONOMY_ROOT, "types") : "")
	const capsDir = opts.capsDir ?? process.env.AUTONOMY_CAPS_DIR ?? (process.env.AUTONOMY_ROOT ? join(process.env.AUTONOMY_ROOT, "engine", "capabilities") : "")
	return {
		rootCapable: typesDir ? loadCapabilities(typesDir) : [],
		production: capsDir ? loadProductionCapabilities(capsDir) : [],
	}
}
