// drizzle-kit config — for generating future migrations from schema.ts changes (`npm run
// db:generate`). The PoC's initial migration (0000_init.sql) is hand-authored and applied by
// src/migrate.ts; drizzle-kit is optional tooling, not on the bootstrap path.

import { defineConfig } from "drizzle-kit"

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/schema.ts",
	out: "./migrations",
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/app",
	},
})
