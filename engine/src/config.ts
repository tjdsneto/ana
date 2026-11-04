// Engine runtime knobs (from .env.example). The redo cap governs the rubric gate; the agreement
// caps govern the briefing back-and-forth, split by actor_kind (spec 02).

export interface EngineConfig {
	artifactsDir: string
	maxRedos: number
	agreementMaxRoundsHuman: number
	agreementMaxRoundsAgent: number
	// Production-wide cap on holistic-review reopen cycles (the final-review node sending approved
	// upstream work back to revise). Analogous to maxRedos but global, so the whole-video loop can't
	// thrash: once hit, final-review presents to the human with a caveat instead of reopening again.
	maxGlobalRevisions: number
	// Convergence: a leaf with 3+ reviewers can oscillate — each redo one reviewer dissents, the
	// dissenter rotating — and never get a unanimous pass on a genuinely good deliverable. When a
	// version passes all-but-one reviewer for this many CONSECUTIVE rounds, the gate accepts it
	// instead of grinding to the redo cap. A weaker result (more than one dissent) resets the streak,
	// so weak work still never converges — it escalates.
	convergeAfter: number
	pollIntervalMs: number
	// Process-lifetime ceiling on REAL (non-fake) subagent calls, a spend guardrail. Once the worker
	// has made this many real calls, it stops claiming new leaves (the in-flight one finishes) and
	// parks idle until restart. Guards against a worker draining a backlog of stale queued work on a
	// retained volume and spending far more than intended. undefined = uncapped (fake is always free).
	maxSubagentCalls?: number
	// The directory a worker subagent runs in (its cwd). It must carry `.claude/skills/` so the node's
	// skill resolves as `/skill-name` in headless `claude -p`, and the craft tools on PATH. This is the
	// ONLY place the generic engine touches the craft: it hands the worker a working directory, then the
	// skill does the video work. undefined = run in the engine's own cwd (fake runner ignores it).
	craftRoot?: string
	// 0009: per-call wall-clock budget for a single subagent run (ms). A runaway produce once ran ~32 min
	// and silently blocked the whole production; when set, the engine aborts a call that exceeds this and
	// treats it as a dispatch failure (retried, then fails). undefined = no watchdog.
	subagentTimeoutMs?: number
	// 0009: soft threshold (ms) — a call that COMPLETES but takes longer than this is logged (subagent.slow)
	// so a slow produce is visible, not buried in timing. undefined = no slow-call warning.
	subagentWarnMs?: number
}

export function configFromEnv(env = process.env): EngineConfig {
	return {
		artifactsDir: env.ARTIFACTS_DIR ?? "./server/data/artifacts",
		maxRedos: num(env.MAX_REDOS, 3),
		agreementMaxRoundsHuman: num(env.AGREEMENT_MAX_ROUNDS_HUMAN, 5),
		agreementMaxRoundsAgent: num(env.AGREEMENT_MAX_ROUNDS_AGENT, 2),
		maxGlobalRevisions: num(env.MAX_GLOBAL_REVISIONS, 2),
		convergeAfter: num(env.CONVERGE_AFTER, 3),
		pollIntervalMs: num(env.POLL_INTERVAL_MS, 3000),
		maxSubagentCalls: optNum(env.SUBAGENT_MAX_CALLS),
		craftRoot: env.AUTONOMY_CRAFT_ROOT || undefined,
		subagentTimeoutMs: optNum(env.SUBAGENT_TIMEOUT_MS),
		subagentWarnMs: optNum(env.SUBAGENT_WARN_MS),
	}
}

function num(value: string | undefined, fallback: number): number {
	const n = value === undefined ? Number.NaN : Number(value)
	return Number.isFinite(n) ? n : fallback
}

// Optional positive integer; unset/blank/non-finite/<=0 all mean "no cap".
function optNum(value: string | undefined): number | undefined {
	if (value === undefined || value === "") return undefined
	const n = Number(value)
	return Number.isFinite(n) && n > 0 ? n : undefined
}
