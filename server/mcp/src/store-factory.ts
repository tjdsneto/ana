// Picks the Store the entrypoints use. PgStore from DATABASE_URL by default; FakeStore when
// MCP_FAKE_STORE=1, so the stdio/HTTP transport can be smoked with no Postgres (day-one check).

import { makePool, PgStore, type Store } from "@core/shared"
import { FakeStore } from "@core/shared/testing"

export function makeStore(): Store {
	if (process.env.MCP_FAKE_STORE === "1") {
		return new FakeStore()
	}
	return new PgStore(makePool())
}
