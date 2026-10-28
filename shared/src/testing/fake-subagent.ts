// FakeSubagentRunner — canned subagent output so the loop tests with no `claude -p` and no network.
// Default: reviewers pass, producers return a stub draft. Pass a handler to script other behavior
// (e.g. force a reviewer to revise, to exercise the redo cap).
//
// It reports a session id + zeroed usage so the token/session plumbing (interactions log, resume)
// exercises end-to-end at zero cost: resume echoes the passed sessionId back, else a new one is
// minted. A handler that returns a partial result still gets session/usage/model filled in.

import type { SubagentInput, SubagentResult, SubagentRunner } from "../ports.js"

export type FakeSubagentHandler = (input: SubagentInput) => SubagentResult | Promise<SubagentResult>

export class FakeSubagentRunner implements SubagentRunner {
	readonly engine = "fake"
	readonly calls: SubagentInput[] = []
	private sessions = 0

	constructor(private readonly handler?: FakeSubagentHandler) {}

	async run(input: SubagentInput): Promise<SubagentResult> {
		this.calls.push(input)
		const base = this.handler
			? await this.handler(input)
			: input.skill?.startsWith("review:")
				? { output: "VERDICT: pass" }
				: { output: `[stub ${input.skill ?? "producer"}] draft` }
		const sessionId = base.sessionId ?? input.resumeSessionId ?? `fake-sess-${++this.sessions}`
		const usage = base.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 }
		return { ...base, sessionId, model: base.model ?? input.model ?? "fake", usage }
	}
}
