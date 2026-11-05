// CodexSubagentRunner — spawns `codex exec` (headless, non-interactive) for a producer or reviewer.
// The OpenAI Codex backend behind the SubagentRunner port; the engine image bakes the `codex` CLI
// (Dockerfile engine-tools). Auth is OPENAI_API_KEY in the env, never baked (see .engine_env.example).
//
// Craft: codex has no claude-style `/slash` skill, so the node's SKILL.md is INLINED into the prompt
// (skill-inline.ts) — the same cross-engine delivery the competition harness uses. Tools: the craft
// skills shell out (video-gen / tts / render), so codex runs with
// `--dangerously-bypass-approvals-and-sandbox` — fully autonomous, no approval prompts; the worker
// container IS the sandbox that flag would otherwise provide. The clean final message is captured via
// `--output-last-message <file>` (stdout otherwise carries progress/log spew). Prompt on STDIN
// (E2BIG-safe for a large upstream), like the claude adapter.
//
// NOT YET VERIFIED AGAINST A REAL RUN (no key at build time): token/cost/session are left undefined —
// `codex exec --json` emits a JSONL event stream that carries them, but the event schema must be
// pinned against a real run before parsing it, so v0 reads only the final message. `resumeSessionId`
// is therefore not wired either (codex `exec resume <id>` needs the id, which needs the JSONL parse).
// Budget: codex exec has no spend-cap flag; the engine's wall-clock watchdog (signal) still kills a
// runaway. Revisit all of this the first time a real OPENAI_API_KEY exercises it.

import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SubagentInput, SubagentResult, SubagentRunner } from "@core/shared"
import { composePrompt } from "./skill-inline.js"
import { spawnCollect, stripNull } from "./spawn.js"

export interface CodexRunnerOptions {
	bin?: string // the CLI binary (default: CODEX_BIN env, else "codex")
	model?: string // default model (CODEX_MODEL, else SUBAGENT_MODEL); a per-call input.model overrides it
}

export class CodexSubagentRunner implements SubagentRunner {
	readonly engine = "codex"
	private readonly bin: string
	private readonly defaultModel?: string

	constructor(opts: CodexRunnerOptions = {}) {
		this.bin = opts.bin ?? process.env.CODEX_BIN ?? "codex"
		this.defaultModel = opts.model ?? process.env.CODEX_MODEL ?? process.env.SUBAGENT_MODEL
	}

	async run(input: SubagentInput): Promise<SubagentResult> {
		const model = input.model ?? this.defaultModel
		const prompt = composePrompt(input.skill, input.systemPrompt, input.prompt, input.cwd)
		// Capture the clean final message in a temp file rather than scraping it out of the logs on stdout.
		const dir = mkdtempSync(join(tmpdir(), "codex-"))
		const lastMessageFile = join(dir, "last-message.txt")
		const args = ["exec", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-o", lastMessageFile]
		if (model) args.push("-m", model)
		try {
			const { stdout, code, stderr } = await spawnCollect("codex", this.bin, args, input.cwd, stripNull(prompt), input.signal)
			const output = readLastMessage(lastMessageFile) ?? stdout.trim()
			if (output === "" && code !== 0) {
				throw new Error(`codex exited ${code} with no output: ${(stderr || stdout).slice(0, 500)}`)
			}
			return {
				output,
				model,
				// usage/sessionId: pinned once `--json` event parsing is verified against a real run.
				raw: { code, stderrTail: stderr.slice(-500) },
			}
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	}
}

function readLastMessage(file: string): string | undefined {
	try {
		const s = readFileSync(file, "utf8").trim()
		return s === "" ? undefined : s
	} catch {
		return undefined
	}
}
