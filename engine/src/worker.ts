// Engine worker entrypoint — the long-running process. Wires the real adapters (PgStore, claude -p
// runner, stubbed render) and the on-disk type registry, then drains work on every LISTEN wake-up
// with a poll-interval fallback. stdout is free; logs go to stderr.

import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { JsonLogger, makePool, PgStore } from "@core/shared"
import { ClaudeSubagentRunner } from "./adapters/claude-runner.js"
import { StubRenderClient } from "./adapters/render-stub.js"
import { configFromEnv } from "./config.js"
import { Engine } from "./loop.js"
import { TypeRegistry } from "./typereg.js"

const config = configFromEnv()
const typesDir = process.env.AUTONOMY_TYPES_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "types")

const logger = new JsonLogger({ bound: { svc: "engine" } })

async function main(): Promise<void> {
	const pool = makePool()
	const engine = new Engine({
		store: new PgStore(pool),
		runner: new ClaudeSubagentRunner(),
		render: new StubRenderClient(),
		types: TypeRegistry.load(typesDir),
		config,
		logger,
	})
	logger.info("worker.up", { typesDir, pollIntervalMs: config.pollIntervalMs })

	let busy = false
	const drain = async (trigger: string) => {
		if (busy) return // coalesce overlapping wake-ups; v0 is single-worker
		busy = true
		try {
			await engine.runUntilIdle()
		} catch (err) {
			logger.error("worker.drain_error", { trigger, error: err instanceof Error ? err.message : String(err) })
		} finally {
			busy = false
		}
	}

	// push wake-ups (spec 03): a dedicated client holds the LISTENs; the poll loop is the fallback.
	const listener = await pool.connect()
	await listener.query("LISTEN new_job")
	await listener.query("LISTEN presentable")
	listener.on("notification", (msg) => void drain(msg.channel))

	await drain("startup") // catch up on anything queued before we started
	setInterval(() => void drain("poll"), config.pollIntervalMs)
}

main().catch((err) => {
	logger.error("worker.fatal", { error: err instanceof Error ? err.message : String(err) })
	process.exit(1)
})
