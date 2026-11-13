// Engine worker entrypoint — the long-running process. Wires the real adapters (PgStore, claude -p
// runner) and the on-disk type registry, then drains work on every LISTEN wake-up with a
// poll-interval fallback. stdout is free; logs go to stderr.

import { randomUUID } from "node:crypto"
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
// The source git SHA baked at image-build time (docker build --build-arg GIT_SHA=…); "unknown" if the
// image was built without it. Logged at worker.up so a stale (not-rebuilt) worker is visible (0015).
const buildSha = process.env.ENGINE_BUILD_SHA ?? "unknown"

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
		// claude + codex are verified working. gemini is DISABLED by default: the only key on hand returns
		// 402 RESOURCE_EXHAUSTED (prepaid credits depleted) on generateContent, though the key is valid
		// (models.list → 200) and the adapter is correct. Re-enable with SUBAGENT_GEMINI_ENABLED=1 once a
		// credited Gemini key is in .engine_env. While disabled, a node that pins engine "gemini" fails
		// loud in loop.runnerFor (no runner registered) rather than burning a redo loop on 402s.
		const engines = ["claude", "codex"]
		if (process.env.SUBAGENT_GEMINI_ENABLED === "1") engines.push("gemini")
		for (const eng of engines) {
			if (!runners.has(eng)) runners.set(eng, makeRunner({ ...runnerConfig, engine: eng }))
		}
	}
	const types = TypeRegistry.load(typesDir)

	// 0011 self-heal: this worker's per-process id. Stamped on every claim's lease so the reaper can tell
	// a live claim (still heartbeated by a running worker) from one abandoned by a dead/restarted worker.
	const workerId = randomUUID()
	const store = new PgStore(dbPool)

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
		store,
		runner,
		runners,
		types,
		config,
		logger,
		workerId,
	})
	logger.info("worker.up", {
		buildSha,
		workerId,
		typesDir,
		skillsDir: skillsDirFor(config.craftRoot),
		pollIntervalMs: config.pollIntervalMs,
		claimLeaseTtlMs: config.claimLeaseTtlMs,
		claimHeartbeatMs: config.claimHeartbeatMs,
		reaperIntervalMs: config.reaperIntervalMs,
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

	// 0011 self-heal: extend the lease on every node this worker still holds, so a genuinely long produce
	// is never reaped out from under a live worker. Runs well inside the lease TTL.
	const heartbeat = async () => {
		try {
			await store.heartbeatClaims(workerId, config.claimLeaseTtlMs)
		} catch (err) {
			logger.error("worker.heartbeat_error", { error: err instanceof Error ? err.message : String(err) })
		}
	}

	// 0011 self-heal: reclaim nodes stranded by a dead/restarted worker — return each expired in-progress
	// claim to pending (superseding its dead producing version) so the loop re-produces it. Visible as a
	// node.reclaim warn per recovered node. If anything was freed, nudge the loop to pick it up now rather
	// than wait for the next poll.
	const reap = async (trigger: string) => {
		try {
			const reaped = await store.reapExpiredClaims()
			for (const n of reaped) {
				logger.warn("node.reclaim", { trigger, productionId: n.productionId, nodeId: n.id, type: n.type, name: n.name })
			}
			if (reaped.length > 0) void drain("reaper")
		} catch (err) {
			logger.error("worker.reaper_error", { trigger, error: err instanceof Error ? err.message : String(err) })
		}
	}

	// push wake-up (spec 03): a dedicated client parks on the new-production channel. The poll loop is
	// the fallback — and the ONLY path that resumes a production after the human gate (approve /
	// feedback / budget), since those writes NOTIFY production_changed, which the worker does not listen to.
	const listener = await dbPool.connect()
	await listener.query("LISTEN new_production")
	listener.on("notification", (msg) => void drain(msg.channel))

	// Reclaim anything stranded by a previous worker's death BEFORE the first drain, so startup resumes
	// those productions instead of leaving them stuck (the common crash/restart recovery case — 0011).
	await reap("startup")
	await drain("startup") // catch up on anything queued before we started
	setInterval(() => void drain("poll"), config.pollIntervalMs)
	setInterval(() => void heartbeat(), config.claimHeartbeatMs)
	setInterval(() => void reap("interval"), config.reaperIntervalMs)
}

main().catch((err) => {
	logger.error("worker.fatal", { error: err instanceof Error ? err.message : String(err) })
	process.exit(1)
})
