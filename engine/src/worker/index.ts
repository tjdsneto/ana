// Engine worker entrypoint — the long-running process. Wires the real adapters (PgStore, claude -p
// runner) and the on-disk type registry, then drains work on every LISTEN wake-up with a
// poll-interval fallback. stdout is free; logs go to stderr.

import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { JsonLogger, makeDbPool, PgStore } from "@core/shared"
import type { SubagentRunner } from "@core/shared"
import { makeRunner, runnerConfigFromEnv } from "../adapters/runner-factory.js"
import { configFromEnv } from "../config.js"
import { Engine } from "../loop.js"
import { TypeRegistry } from "../typereg.js"
import { missingSkills, skillsDirFor } from "./skills-check.js"

const config = configFromEnv()
// This module lives at dist/worker/index.js; the bundled types/ sits at the engine root, two levels up.
const typesDir = process.env.AUTONOMY_TYPES_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "types")

const logger = new JsonLogger({ bound: { svc: "engine" } })

// Subagent adapter is a port: the factory selects the backend (SUBAGENT_ENGINE: claude | fake, with
// codex/openai reserved) and model (SUBAGENT_MODEL). The Compose stack sets the "fake" engine so it
// runs end-to-end with no `claude` binary and no network. Same seam as MCP_FAKE_STORE.
//
// Rendering is NOT an engine concern: a render leaf is produced by a worker running the render-film
// skill, which drives the craft tools in craft/video-production/tools (vo / build / mix / render) and writes the .mp4
// (loop.ts). So the engine wires no render/voice client — there is none; the craft layer owns it.
const runnerConfig = runnerConfigFromEnv()

async function main(): Promise<void> {
	const dbPool = makeDbPool()
	// The default runner (SUBAGENT_ENGINE), plus every other real engine registered by name so a node
	// that pins a non-default backend (TypeContract.engine: claude | codex | gemini) routes to it
	// (loop.runnerFor). Constructing a runner only reads env/bin — no key, no network — so building all
	// of them is cheap; a key-less engine fails at call time only if a node actually uses it. The fake
	// engine runs alone (fake mode bakes no CLIs).
	const runner = makeRunner(runnerConfig)
	const runners = new Map<string, SubagentRunner>([[runner.engine, runner]])
	if (runnerConfig.engine !== "fake") {
		for (const eng of ["claude", "codex", "gemini"]) {
			if (!runners.has(eng)) runners.set(eng, makeRunner({ ...runnerConfig, engine: eng }))
		}
	}
	const types = TypeRegistry.load(typesDir)

	// 0008: a real `claude -p` subagent resolves craft skills from <craftRoot>/.claude/skills. A stale or
	// empty bind mount serves an empty dir, so a skill-required node (e.g. brainstorm) would fail three
	// layers down with "Unknown skill" and strand the production. Assert every referenced skill resolves
	// and fail loud at boot instead. The fake engine runs no skills, so the check is real-engine only.
	if (runnerConfig.engine !== "fake") {
		const skillsDir = skillsDirFor(config.craftRoot)
		const missing = missingSkills(types, skillsDir)
		if (missing.length > 0) {
			logger.error("worker.skills_missing", { skillsDir, missing })
			throw new Error(
				`craft skills unresolvable at ${skillsDir} — ${missing.length} missing: ${missing.join(", ")}. ` +
					"Usual cause: a stale/empty bind mount on a not-recreated container. Recreate the worker: docker compose up -d --force-recreate engine-worker",
			)
		}
	}

	const engine = new Engine({
		store: new PgStore(dbPool),
		runner,
		runners,
		types,
		config,
		logger,
	})
	logger.info("worker.up", {
		typesDir,
		skillsDir: skillsDirFor(config.craftRoot),
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
