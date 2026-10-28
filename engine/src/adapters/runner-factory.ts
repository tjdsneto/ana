// Subagent engine selection. The worker asks for a SubagentRunner by engine name; this factory
// constructs it. The port is the real abstraction — this just picks the backend and passes config
// (model, bin). codex / openai are reserved: the factory knows their names but throws until an
// adapter lands, so adding one is a single case here, not a worker change.

import type { SubagentRunner } from "@core/shared"
import { FakeSubagentRunner } from "@core/shared/testing"
import { ClaudeSubagentRunner } from "./claude-runner.js"

export interface RunnerConfig {
	engine: string // claude | codex | openai | fake
	model?: string // default model (per-call input.model still overrides)
	bin?: string // CLI binary, for CLI-backed engines
}

export function runnerConfigFromEnv(env = process.env): RunnerConfig {
	// SUBAGENT_ENGINE picks the backend. ENGINE_FAKE_SUBAGENT=1 stays a back-compat alias for "fake"
	// (the Compose stack + older configs set it); default is the real claude runner.
	const engine = env.SUBAGENT_ENGINE ?? (env.ENGINE_FAKE_SUBAGENT === "1" ? "fake" : "claude")
	return { engine, model: env.SUBAGENT_MODEL, bin: env.CLAUDE_BIN }
}

export function makeRunner(config: RunnerConfig): SubagentRunner {
	switch (config.engine) {
		case "fake":
			return new FakeSubagentRunner()
		case "claude":
			return new ClaudeSubagentRunner({ model: config.model, bin: config.bin })
		case "codex":
		case "openai":
			throw new Error(`SubagentRunner engine "${config.engine}" is reserved but not implemented yet`)
		default:
			throw new Error(`unknown SubagentRunner engine "${config.engine}"`)
	}
}
