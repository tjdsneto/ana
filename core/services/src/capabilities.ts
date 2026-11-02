// get_capabilities — the catalog of what a caller can ask the engine to produce (the rootCapable
// types + their intake schema). Reads the type registry files via @core/shared's loadCapabilities, so
// the MCP server can expose it without importing the engine. The types dir is resolved from the same
// env the worker uses (AUTONOMY_TYPES_DIR, else AUTONOMY_ROOT/types), or passed explicitly.

import { join } from "node:path"
import { type Capability, loadCapabilities } from "@core/shared"

export function getCapabilities(typesDir?: string): Capability[] {
	const dir = typesDir ?? process.env.AUTONOMY_TYPES_DIR ?? (process.env.AUTONOMY_ROOT ? join(process.env.AUTONOMY_ROOT, "types") : "")
	return dir ? loadCapabilities(dir) : []
}
