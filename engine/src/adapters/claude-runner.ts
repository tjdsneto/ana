// ClaudeSubagentRunner — spawns `claude -p` (headless, one-shot) for a producer or reviewer. The
// real SubagentRunner adapter; tests use FakeSubagentRunner instead.
//
// Runs with `--output-format json`, so one call returns the text output AND the session id + token
// usage + cost together (no second probe). `--model` selects the model; `--resume <session_id>`
// continues a prior session (the producer's, across redo rounds). The exact flags/field names are
// the seam to verify against the installed CLI when first exercised — parsing is defensive.

import { spawn } from "node:child_process"
import type { SubagentInput, SubagentResult, SubagentRunner, SubagentUsage } from "@core/shared"

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
		const budget = input.maxBudgetUsd ?? this.maxBudgetUsd // per-call override wins; else the runner default (SUBAGENT_MAX_BUDGET_USD)
		const args = ["-p", "--output-format", "json"]
		// The craft lives in a skill (spec 09): the worker must be able to invoke the Skill tool and the
		// tools that skill runs (Bash for video-gen/tts/site-capture, Read/Write for artifacts). So it
		// runs with an autonomous permission mode — it never waits on a prompt, but unlike the old
		// text-only deny it is ALLOWED to use tools. The worker runs in a sandboxed container, so the
		// default is bypassPermissions; override with SUBAGENT_PERMISSION_MODE.
		args.push("--permission-mode", process.env.SUBAGENT_PERMISSION_MODE ?? "bypassPermissions")
		if (budget !== undefined) args.push("--max-budget-usd", String(budget))
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
		// The prompt goes on STDIN, never argv: a large upstream (e.g. a storyboard whose film.json
		// embeds a font, or data-URL plates) makes the prompt megabytes, and a positional argv arg of
		// that size throws spawn E2BIG (OS arg-list limit). `claude -p` reads the query from stdin.
		const { stdout, code, stderr } = await spawnCollect(this.bin, args, input.cwd, stripNull(input.prompt), input.signal)
		const json = parse(stdout)
		const result = (json.result ?? stdout).trim()
		// A non-zero exit / is_error does NOT discard produced work when the CLI actually returned a
		// result. `claude -p` prints its result, THEN runs SessionEnd hooks; a flaky host hook (e.g. an
		// agent-registry SessionEnd hook, "Hook cancelled") fails and makes the CLI exit 1 and set
		// is_error AFTER the artifact is on stdout. The engine must not let the host's session hooks
		// discard a produced artifact. Treat it as a failure ONLY when the CLI returned no result field
		// at all and exited non-zero (a genuine mid-run failure with no output).
		const producedResult = typeof json.result === "string" && json.result.trim() !== ""
		if (!producedResult && code !== 0) {
			throw new Error(`claude exited ${code}${json.is_error ? " (is_error)" : ""} with no result: ${(stderr || stdout).slice(0, 500)}`)
		}
		return {
			output: result,
			sessionId: json.session_id,
			model: modelOf(json) ?? model,
			usage: toUsage(json),
			raw: json,
		}
	}
}

// Spawn `claude -p` with the query piped to stdin (not argv — see the call site). Collects stdout,
// rejects on a non-zero exit or a stdout that blows the buffer cap.
function spawnCollect(bin: string, args: string[], cwd: string | undefined, stdinData: string, signal?: AbortSignal): Promise<{ stdout: string; code: number | null; stderr: string }> {
	return new Promise((resolve, reject) => {
		const MAX = 32 * 1024 * 1024
		const child = spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "pipe"] })
		let out = ""
		let err = ""
		let killed = false
		// 0009: the engine's wall-clock watchdog aborts a runaway call — kill the child so a non-terminating
		// `claude -p` doesn't keep running (and spending) after the engine has stopped waiting on it.
		const onAbort = () => {
			if (killed) return
			killed = true
			child.kill("SIGKILL")
			reject(new Error("claude aborted by wall-clock watchdog"))
		}
		if (signal) {
			if (signal.aborted) {
				onAbort()
				return
			}
			signal.addEventListener("abort", onAbort, { once: true })
		}
		child.stdout.on("data", (d) => {
			out += d
			if (out.length > MAX && !killed) {
				killed = true
				child.kill()
				reject(new Error("claude stdout exceeded 32MB buffer"))
			}
		})
		child.stderr.on("data", (d) => {
			err += d
		})
		child.on("error", reject)
		// Resolve with the exit code (don't reject on non-zero): the caller decides, so a post-output
		// hook failure doesn't discard a produced result.
		child.on("close", (code) => {
			if (signal) signal.removeEventListener("abort", onAbort)
			if (!killed) resolve({ stdout: out, code, stderr: err })
		})
		child.stdin.on("error", () => {}) // ignore EPIPE if the CLI closes stdin early
		child.stdin.end(stdinData)
	})
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
