// ClaudeSubagentRunner — spawns `claude -p` (headless, one-shot) for a producer or reviewer. The
// real SubagentRunner adapter; tests use FakeSubagentRunner instead.
//
// Runs with `--output-format json`, so one call returns the text output AND the session id + token
// usage + cost together (no second probe). `--model` selects the model; `--resume <session_id>`
// continues a prior session (the producer's, across redo rounds). The exact flags/field names are
// the seam to verify against the installed CLI when first exercised — parsing is defensive.

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { SubagentInput, SubagentResult, SubagentRunner, SubagentUsage } from "@core/shared"

const run = promisify(execFile)

// Shape of `claude -p --output-format json`. Every field optional: ones the installed CLI omits are
// simply left undefined, and non-JSON stdout falls back to the raw text as the output.
interface ClaudeJson {
	result?: string
	session_id?: string
	total_cost_usd?: number
	usage?: {
		input_tokens?: number
		output_tokens?: number
		cache_creation_input_tokens?: number
		cache_read_input_tokens?: number
	}
	modelUsage?: Record<string, unknown>
	is_error?: boolean
}

export interface ClaudeRunnerOptions {
	bin?: string // the CLI binary (default: CLAUDE_BIN env, else "claude")
	model?: string // default model (SUBAGENT_MODEL); a per-call input.model overrides it
	maxBudgetUsd?: number // per-call client-side spend cap (SUBAGENT_MAX_BUDGET_USD); undefined = uncapped
}

export class ClaudeSubagentRunner implements SubagentRunner {
	readonly engine = "claude"
	private readonly bin: string
	private readonly defaultModel?: string
	private readonly maxBudgetUsd?: number

	constructor(opts: ClaudeRunnerOptions = {}) {
		this.bin = opts.bin ?? process.env.CLAUDE_BIN ?? "claude"
		this.defaultModel = opts.model ?? process.env.SUBAGENT_MODEL
		this.maxBudgetUsd = opts.maxBudgetUsd ?? numOrUndef(process.env.SUBAGENT_MAX_BUDGET_USD)
	}

	async run(input: SubagentInput): Promise<SubagentResult> {
		const model = input.model ?? this.defaultModel
		const args = ["-p", "--output-format", "json"]
		// The craft lives in a skill (spec 09): the worker must be able to invoke the Skill tool and the
		// tools that skill runs (Bash for video-gen/tts/site-capture, Read/Write for artifacts). So it
		// runs with an autonomous permission mode — it never waits on a prompt, but unlike the old
		// text-only deny it is ALLOWED to use tools. The worker runs in a sandboxed container, so the
		// default is bypassPermissions; override with SUBAGENT_PERMISSION_MODE.
		args.push("--permission-mode", process.env.SUBAGENT_PERMISSION_MODE ?? "bypassPermissions")
		if (this.maxBudgetUsd !== undefined) args.push("--max-budget-usd", String(this.maxBudgetUsd))
		if (model) args.push("--model", model)
		if (input.resumeSessionId) args.push("--resume", input.resumeSessionId)
		// Direct the worker to the node's skill. Skill names map to slash commands (`review:craft` →
		// `/review-craft`); the skill resolves from the craft root's `.claude/skills/` (input.cwd). "self"
		// means produce inline with no skill. Reviewers (review:<kind>) are a label only — they judge
		// from the rubric prompt, so no skill directive either. Combined with any caller systemPrompt.
		const skillSlug = input.skill && input.skill !== "self" && !input.skill.startsWith("review:") ? input.skill.replace(/:/g, "-") : undefined
		const sys = [
			skillSlug ? `Complete this task by invoking the /${skillSlug} skill and following it exactly. Do not produce the deliverable any other way.` : undefined,
			input.systemPrompt,
		].filter(Boolean) as string[]
		// Strip null bytes: execFile rejects argv with embedded \0 (e.g. if a prompt ever carries binary
		// artifact content). Belt — the loop also avoids feeding binary into prompts.
		if (sys.length > 0) args.push("--append-system-prompt", stripNull(sys.join("\n\n")))
		args.push(stripNull(input.prompt)) // positional query
		const { stdout } = await run(this.bin, args, { cwd: input.cwd, maxBuffer: 10 * 1024 * 1024 })
		const json = parse(stdout)
		return {
			output: (json.result ?? stdout).trim(),
			sessionId: json.session_id,
			model: modelOf(json) ?? model,
			usage: toUsage(json),
			raw: json,
		}
	}
}

function parse(stdout: string): ClaudeJson {
	try {
		return JSON.parse(stdout) as ClaudeJson
	} catch {
		return { result: stdout } // older CLI / unexpected output — treat stdout as the raw text
	}
}

function toUsage(json: ClaudeJson): SubagentUsage | undefined {
	const u = json.usage
	if (!u && json.total_cost_usd === undefined) return undefined
	return {
		inputTokens: u?.input_tokens,
		outputTokens: u?.output_tokens,
		cacheReadTokens: u?.cache_read_input_tokens,
		cacheCreationTokens: u?.cache_creation_input_tokens,
		costUsd: json.total_cost_usd,
	}
}

function modelOf(json: ClaudeJson): string | undefined {
	return json.modelUsage ? Object.keys(json.modelUsage)[0] : undefined
}

function stripNull(s: string): string {
	return s.replace(/\0/g, "")
}

function numOrUndef(value: string | undefined): number | undefined {
	if (value === undefined || value === "") return undefined
	const n = Number(value)
	return Number.isFinite(n) ? n : undefined
}
