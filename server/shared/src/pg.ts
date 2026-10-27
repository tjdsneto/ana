// Thin pg Pool factory used by the migrate + seed scripts. The runtime Store adapter (server/shared,
// step 4) will own its own pool; this keeps the bootstrap scripts self-contained.

import { Pool } from "pg"

export function makePool(connectionString = process.env.DATABASE_URL): Pool {
	if (!connectionString) {
		throw new Error("DATABASE_URL is not set (see .env.example)")
	}
	return new Pool({ connectionString })
}
