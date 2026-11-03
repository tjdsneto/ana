// Engine worker entrypoint — the long-running process. Wires the real adapters (PgStore, claude -p
// runner) and the on-disk type registry, then drains work on every LISTEN wake-up with a
// poll-interval fallback. stdout is free; logs go to stderr.

import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { JsonLogger, makeDbPool, PgStore } from "@core/shared"
import { makeRunner, runnerConfigFromEnv } from "../adapters/runner-factory.js"
import { configFromEnv } from "../config.js"
import { Engine } from "../loop.js"
import { TypeRegistry } from "../typereg.js"

const config = configFromEnv()
// This module lives at dist/worker/index.js; the bundled types/ sits at the engine root, two levels up.
const typesDir = process.env.AUTONOMY_TYPES_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "types")

const logger = new JsonLogger({ bound: { svc: "engine" } })

// Subagent adapter is a port: the factory selects the backend (SUBAGENT_ENGINE: claude | fake, with
// codex/openai reserved) and model (SUBAGENT_MODEL). The Compose stack sets the "fake" engine so it
// runs end-to-end with no `claude` binary and no network. Same seam as MCP_FAKE_STORE.
//
// Rendering is NOT an engine concern: a render leaf is produced by a worker running the render-film
// skill, which drives the craft tools in craft/tools (vo / build / mix / render) and writes the .mp4
// (loop.ts). So the engine wires no render/voice client — there is none; the craft layer owns it.
const runnerConfig = runnerConfigFromEnv()

async function main(): Promise<void> {
	const dbPool = makeDbPool()
	// The default runner (SUBAGENT_ENGINE). A node type may pin a different backend (TypeContract.engine);
	// register each such backend here by name and the loop routes that node to it. Only the default is
	// wired for now — a non-default pin throws until its runner is added to this map.
	const runner = makeRunner(runnerConfig)
	const engine = new Engine({
		store: new PgStore(dbPool),
		runner,
		runners: new Map([[runner.engine, runner]]),
		types: TypeRegistry.load(typesDir),
		config,
		logger,
	})
	logger.info("worker.up", {
		typesDir,
		pollIntervalMs: config.pollIntervalMs,
		engine: runnerConfig.engine,
		model: runnerConfig.model ?? null,
	})

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

	// push wake-up (spec 03): a dedicated client parks on the new-production channel. The poll loop is
	// the fallback — and the ONLY path that resumes a production after the human gate (approve /
	// feedback / budget), since those writes NOTIFY production_changed, which the worker does not listen to.
	const listener = await dbPool.connect()
	await listener.query("LISTEN new_production")
	listener.on("notification", (msg) => void drain(msg.channel))

	await drain("startup") // catch up on anything queued before we started
	setInterval(() => void drain("poll"), config.pollIntervalMs)
}

main().catch((err) => {
	logger.error("worker.fatal", { error: err instanceof Error ? err.message : String(err) })
	process.exit(1)
})
