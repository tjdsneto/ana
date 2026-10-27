// Real Clock + IdGen implementations (the production adapters of those ports). Tests inject fakes
// instead (see ./testing). Kept in shared so the MCP server and the engine use the same ones.

import { randomUUID } from "node:crypto"
import type { Clock, IdGen } from "./ports.js"

export class SystemClock implements Clock {
	now(): Date {
		return new Date()
	}
}

// Prefixed, URL-safe, sortable-enough ids: `<prefix>_<uuid-no-dashes>` (e.g. `nd_1f2e…`). The
// prefix is a human hint only; uniqueness comes from the UUID.
export class UuidGen implements IdGen {
	next(prefix = "id"): string {
		return `${prefix}_${randomUUID().replaceAll("-", "")}`
	}
}
