// Seeds the single default account + user (spec 01). Idempotent — fixed ids + ON CONFLICT DO
// NOTHING, so re-running is safe. Run after migrate: `npm run db:seed`.

import { DEFAULT_ACCOUNT_ID, DEFAULT_ACCOUNT_NAME, DEFAULT_USER_ID, DEFAULT_USER_NAME } from "./defaults.js"
import { makePool } from "./pg.js"

async function main(): Promise<void> {
	const pool = makePool()
	try {
		await pool.query("INSERT INTO accounts (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [
			DEFAULT_ACCOUNT_ID,
			DEFAULT_ACCOUNT_NAME,
		])
		await pool.query(
			"INSERT INTO users (id, account_id, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
			[DEFAULT_USER_ID, DEFAULT_ACCOUNT_ID, DEFAULT_USER_NAME],
		)
		console.log(`seeded default account (${DEFAULT_ACCOUNT_ID}) + user (${DEFAULT_USER_ID})`)
	} finally {
		await pool.end()
	}
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
