// Engine runtime knobs (from .env.example). The redo cap governs the rubric gate; the agreement
// caps govern the briefing back-and-forth, split by actor_kind (spec 02).

export interface EngineConfig {
	artifactsDir: string
	maxRedos: number
	agreementMaxRoundsHuman: number
	agreementMaxRoundsAgent: number
	pollIntervalMs: number
}

export function configFromEnv(env = process.env): EngineConfig {
	return {
		artifactsDir: env.ARTIFACTS_DIR ?? "./server/data/artifacts",
		maxRedos: num(env.MAX_REDOS, 3),
		agreementMaxRoundsHuman: num(env.AGREEMENT_MAX_ROUNDS_HUMAN, 5),
		agreementMaxRoundsAgent: num(env.AGREEMENT_MAX_ROUNDS_AGENT, 2),
		pollIntervalMs: num(env.POLL_INTERVAL_MS, 3000),
	}
}

function num(value: string | undefined, fallback: number): number {
	const n = value === undefined ? Number.NaN : Number(value)
	return Number.isFinite(n) ? n : fallback
}
