// Minimal forward-only migration runner: applies every migrations/*.sql not yet recorded, in
// filename order, each file in its own transaction, tracked in a `_migrations` table. Boring and
// explicit — no drizzle-kit needed to bootstrap the PoC. Run: `npm run db:migrate` (from the root)
// or `npm -w @core/shared run migrate`.

import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { makePool } from "./pg.js"

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations")

async function main(): Promise<void> {
	const pool = makePool()
	try {
		await pool.query(
			`CREATE TABLE IF NOT EXISTS _migrations (
				name       text PRIMARY KEY,
				applied_at timestamptz NOT NULL DEFAULT now()
			)`,
		)

		const files = readdirSync(MIGRATIONS_DIR)
			.filter((f) => f.endsWith(".sql"))
			.sort()

		const applied = new Set(
			(await pool.query<{ name: string }>("SELECT name FROM _migrations")).rows.map((r) => r.name),
		)

		let ran = 0
		for (const file of files) {
			if (applied.has(file)) continue
			const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
			const client = await pool.connect()
			try {
				await client.query("BEGIN")
				await client.query(sql)
				await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file])
				await client.query("COMMIT")
				console.log(`applied ${file}`)
				ran++
			} catch (err) {
				await client.query("ROLLBACK")
				throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err })
			} finally {
				client.release()
			}
		}

		console.log(ran === 0 ? "up to date — no migrations to apply" : `done — applied ${ran} migration(s)`)
	} finally {
		await pool.end()
	}
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
