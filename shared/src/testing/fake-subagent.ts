// FakeSubagentRunner — canned subagent output so the loop tests with no `claude -p` and no network.
// Default: reviewers pass, producers return a stub draft. Pass a handler to script other behavior
// (e.g. force a reviewer to revise, to exercise the redo cap).

import type { SubagentInput, SubagentResult, SubagentRunner } from "../ports.js"

export type FakeSubagentHandler = (input: SubagentInput) => SubagentResult | Promise<SubagentResult>

export class FakeSubagentRunner implements SubagentRunner {
	readonly calls: SubagentInput[] = []

	constructor(private readonly handler?: FakeSubagentHandler) {}

	async run(input: SubagentInput): Promise<SubagentResult> {
		this.calls.push(input)
		if (this.handler) return this.handler(input)
		if (input.skill?.startsWith("review:")) return { output: "VERDICT: pass" }
		return { output: `[stub ${input.skill ?? "producer"}] draft` }
	}
}
