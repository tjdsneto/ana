// Engine runtime knobs (from .env.example). The redo cap governs the rubric gate; the agreement
// caps govern the briefing back-and-forth, split by actor_kind (spec 02).

export interface EngineConfig {
	artifactsDir: string
	maxRedos: number
	agreementMaxRoundsHuman: number
	agreementMaxRoundsAgent: number
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
}

export function configFromEnv(env = process.env): EngineConfig {
	return {
		artifactsDir: env.ARTIFACTS_DIR ?? "./server/data/artifacts",
		maxRedos: num(env.MAX_REDOS, 3),
		agreementMaxRoundsHuman: num(env.AGREEMENT_MAX_ROUNDS_HUMAN, 5),
		agreementMaxRoundsAgent: num(env.AGREEMENT_MAX_ROUNDS_AGENT, 2),
		pollIntervalMs: num(env.POLL_INTERVAL_MS, 3000),
		maxSubagentCalls: optNum(env.SUBAGENT_MAX_CALLS),
		craftRoot: env.AUTONOMY_CRAFT_ROOT || undefined,
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
