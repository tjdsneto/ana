// GeminiSubagentRunner — spawns `gemini -p` (headless, non-interactive) for a producer or reviewer.
// The Google Gemini backend behind the SubagentRunner port; the engine image bakes the `gemini` CLI
// (Dockerfile engine-tools). Auth is GEMINI_API_KEY in the env, never baked (see .engine_env.example).
//
// Craft: gemini has no claude-style `/slash` skill, so the node's SKILL.md is INLINED into the prompt
// (skill-inline.ts). Tools: the craft skills shell out, so gemini runs with `--approval-mode yolo`
// (auto-approve every tool) — the worker container is the sandbox. Output is requested as JSON
// (`-o json`). The full prompt goes on STDIN (E2BIG-safe for a large upstream) and `-p` carries only a
// short tail that both triggers headless mode and points at the stdin content.
//
// NOT YET VERIFIED AGAINST A REAL RUN (no key at build time): the exact JSON shape of `-o json` — the
// parser below tries the likely text fields (`response`/`output`/`result`/`text`) and falls back to
// raw stdout, and leaves token/cost undefined until the `stats` shape is pinned. `resumeSessionId` is
// not mapped: gemini `-r` takes `latest`/an index, not a provider session id. Budget: no spend-cap
// flag; the engine's wall-clock watchdog (signal) kills a runaway. Revisit on the first real run.

import type { SubagentInput, SubagentResult, SubagentRunner } from "@core/shared"
import { composePrompt } from "./skill-inline.js"
import { spawnCollect, stripNull } from "./spawn.js"

// A short instruction passed via `-p` (which switches gemini into headless mode); the full context is
// piped on stdin and, per the CLI, the `-p` text is appended to it.
const HEADLESS_TAIL = "Follow the instructions above exactly and output only the deliverable."

export interface GeminiRunnerOptions {
	bin?: string // the CLI binary (default: GEMINI_BIN env, else "gemini")
	model?: string // default model (GEMINI_MODEL, else SUBAGENT_MODEL); a per-call input.model overrides it
}

export class GeminiSubagentRunner implements SubagentRunner {
	readonly engine = "gemini"
	private readonly bin: string
	private readonly defaultModel?: string

	constructor(opts: GeminiRunnerOptions = {}) {
		this.bin = opts.bin ?? process.env.GEMINI_BIN ?? "gemini"
		this.defaultModel = opts.model ?? process.env.GEMINI_MODEL ?? process.env.SUBAGENT_MODEL
	}

	async run(input: SubagentInput): Promise<SubagentResult> {
		const model = input.model ?? this.defaultModel
		const prompt = composePrompt(input.skill, input.systemPrompt, input.prompt, input.cwd)
		// --skip-trust: gemini refuses headless tool use in an "untrusted" folder and silently downgrades
		// --approval-mode to "default" (verified: rc=55, no output). The worker container is the sandbox,
		// so the workspace is trusted by construction.
		const args = ["-p", HEADLESS_TAIL, "-o", "json", "--approval-mode", "yolo", "--skip-trust"]
		if (model) args.push("-m", model)
		const { stdout, code, stderr } = await spawnCollect("gemini", this.bin, args, input.cwd, stripNull(prompt), input.signal)
		const { output, usage } = parseGeminiJson(stdout)
		if (output === "" && code !== 0) {
			throw new Error(`gemini exited ${code} with no output: ${(stderr || stdout).slice(0, 500)}`)
		}
		return { output, model, usage, raw: { code, stderrTail: stderr.slice(-500) } }
	}
}

// Defensive parse of `gemini -o json`. The field names are best-guesses until a real run pins them;
// any that the installed CLI omits simply stay undefined, and non-JSON stdout falls back to raw text.
export function parseGeminiJson(stdout: string): { output: string; usage?: import("@core/shared").SubagentUsage } {
	let json: Record<string, unknown>
	try {
		json = JSON.parse(stdout) as Record<string, unknown>
	} catch {
		return { output: stdout.trim() } // older / unexpected output — treat stdout as the text
	}
	const text = firstString(json, ["response", "output", "result", "text"]) ?? stdout.trim()
	const stats = (json.stats ?? json.usage) as Record<string, unknown> | undefined
	const usage = stats
		? {
				inputTokens: numOrUndef(stats.inputTokens ?? stats.input_tokens ?? stats.promptTokenCount),
				outputTokens: numOrUndef(stats.outputTokens ?? stats.output_tokens ?? stats.candidatesTokenCount),
				costUsd: numOrUndef(stats.costUsd ?? stats.cost_usd),
			}
		: undefined
	return { output: text.trim(), usage }
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
	for (const k of keys) {
		const v = obj[k]
		if (typeof v === "string" && v !== "") return v
	}
	return undefined
}

function numOrUndef(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined
	return value
}
