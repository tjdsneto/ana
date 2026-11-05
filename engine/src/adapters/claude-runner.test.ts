import { describe, expect, test } from "vitest"
import { runMetaOf } from "./claude-runner.js"

// runMetaOf pulls the per-run shape out of `claude -p --output-format json` — how many agent turns the
// run took and how much of its wall time was spent in API calls. The engine already stores the wall
// duration it measures; wall − api is the time the run spent NOT calling the model (tool execution, and
// crucially rate-limit backoff), which is what made one brainstorm-how run take 31 minutes.
describe("runMetaOf", () => {
	test("extracts num_turns and duration_api_ms", () => {
		expect(runMetaOf({ num_turns: 8, duration_api_ms: 54000 })).toEqual({
			numTurns: 8,
			apiDurationMs: 54000,
		})
	})

	test("missing fields are undefined, not zero", () => {
		expect(runMetaOf({})).toEqual({ numTurns: undefined, apiDurationMs: undefined })
	})

	test("ignores non-numeric values", () => {
		expect(runMetaOf({ num_turns: "8" as unknown as number, duration_api_ms: null as unknown as number })).toEqual({
			numTurns: undefined,
			apiDurationMs: undefined,
		})
	})
})
