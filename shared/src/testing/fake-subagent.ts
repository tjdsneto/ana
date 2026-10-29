// FakeSubagentRunner — canned subagent output so the loop tests with no `claude -p` and no network.
// Default: reviewers pass, producers return a stub draft. Pass a handler to script other behavior
// (e.g. force a reviewer to revise, to exercise the redo cap).
//
// It reports a session id + zeroed usage so the token/session plumbing (interactions log, resume)
// exercises end-to-end at zero cost: resume echoes the passed sessionId back, else a new one is
// minted. A handler that returns a partial result still gets session/usage/model filled in.

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { SubagentInput, SubagentResult, SubagentRunner } from "../ports.js"

export type FakeSubagentHandler = (input: SubagentInput) => SubagentResult | Promise<SubagentResult>

export class FakeSubagentRunner implements SubagentRunner {
	readonly engine = "fake"
	readonly calls: SubagentInput[] = []
	private sessions = 0

	constructor(private readonly handler?: FakeSubagentHandler) {}

	async run(input: SubagentInput): Promise<SubagentResult> {
		this.calls.push(input)
		// A rendered leaf's worker is expected to WRITE an .mp4 into the work dir named in its prompt.
		// The fake stands in for that: drop a placeholder file so the loop (and compose fake-mode) runs
		// end-to-end with no real render. Always for render-film, even with a scripted handler (which
		// only shapes the returned text).
		if (input.skill === "render-film") {
			const m = /Work dir:\s*(\S+)/.exec(input.prompt)
			if (m?.[1]) {
				try {
					mkdirSync(m[1], { recursive: true })
					writeFileSync(join(m[1], "fake-render.mp4"), "fake")
				} catch {
					// best-effort; the loop surfaces a missing .mp4 if this fails
				}
			}
		}
		const base = this.handler
			? await this.handler(input)
			: input.skill?.startsWith("review:")
				? { output: "VERDICT: pass" }
				: input.skill === "render-film"
					? { output: "[stub render-film] wrote fake-render.mp4" }
					: { output: `[stub ${input.skill ?? "producer"}] draft` }
		const sessionId = base.sessionId ?? input.resumeSessionId ?? `fake-sess-${++this.sessions}`
		const usage = base.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 }
		return { ...base, sessionId, model: base.model ?? input.model ?? "fake", usage }
	}
}
