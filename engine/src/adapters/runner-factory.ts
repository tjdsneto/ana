// Subagent engine selection. The worker asks for a SubagentRunner by engine name; this factory
// constructs it. The port is the real abstraction — this just picks the backend and passes config
// (model, bin). claude / codex / gemini each back onto a real agent CLI baked into the engine image
// (Dockerfile engine-tools); `fake` returns canned output for tests. Adding another engine is a
// single case here plus registering it in the worker's runners map.

import type { SubagentRunner } from "@core/shared"
import { FakeSubagentRunner } from "@core/shared/testing"
import { ClaudeSubagentRunner } from "./claude-runner.js"
import { CodexSubagentRunner } from "./codex-runner.js"
import { GeminiSubagentRunner } from "./gemini-runner.js"

export interface RunnerConfig {
	engine: string // claude | codex | gemini | fake (openai is an alias for codex)
	model?: string // default model (per-call input.model still overrides)
	bin?: string // CLI binary, for CLI-backed engines (claude; codex/gemini read CODEX_BIN/GEMINI_BIN)
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
		case "openai": // alias — the OpenAI provider is the Codex CLI
			return new CodexSubagentRunner({ model: config.model })
		case "gemini":
			return new GeminiSubagentRunner({ model: config.model })
		default:
			throw new Error(`unknown SubagentRunner engine "${config.engine}"`)
	}
}
