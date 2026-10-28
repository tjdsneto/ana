// ClaudeSubagentRunner — spawns `claude -p` (headless, one-shot) for a producer or reviewer. The
// real SubagentRunner adapter; tests use FakeSubagentRunner instead. The exact flags are the seam
// to verify when first exercised against the installed CLI — kept minimal here.

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { SubagentInput, SubagentResult, SubagentRunner } from "@core/shared"

const run = promisify(execFile)

export class ClaudeSubagentRunner implements SubagentRunner {
	constructor(private readonly bin = process.env.CLAUDE_BIN ?? "claude") {}

	async run(input: SubagentInput): Promise<SubagentResult> {
		const args = ["-p", input.prompt]
		if (input.systemPrompt) args.push("--append-system-prompt", input.systemPrompt)
		const { stdout } = await run(this.bin, args, { cwd: input.cwd, maxBuffer: 10 * 1024 * 1024 })
		return { output: stdout.trim(), raw: { stdout } }
	}
}
