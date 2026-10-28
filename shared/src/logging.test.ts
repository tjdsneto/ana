// Logger adapter tests — level filtering, bound context, child merge, JSON shape. Captures lines
// via an injected sink (no real stderr).

import { describe, expect, it } from "vitest"
import { JsonLogger, NoopLogger } from "./logging.js"

function capture(level: "debug" | "info" | "warn" | "error" = "info") {
	const lines: string[] = []
	const log = new JsonLogger({
		level,
		sink: (l) => lines.push(l),
		now: () => new Date("2026-01-01T00:00:00.000Z"),
		bound: { svc: "test" },
	})
	return { log, parsed: () => lines.map((l) => JSON.parse(l)) }
}

describe("JsonLogger", () => {
	it("filters below the configured level", () => {
		const { log, parsed } = capture("info")
		log.debug("dropped")
		log.info("kept")
		expect(parsed()).toHaveLength(1)
		expect(parsed()[0]).toMatchObject({ level: "info", event: "kept", svc: "test", ts: "2026-01-01T00:00:00.000Z" })
	})

	it("merges bound + child + per-call fields", () => {
		const { log, parsed } = capture()
		log.child({ productionId: "p1" }).warn("node.present", { versionId: "v1" })
		expect(parsed()[0]).toMatchObject({ level: "warn", event: "node.present", svc: "test", productionId: "p1", versionId: "v1" })
	})

	it("NoopLogger emits nothing and child() returns a logger", () => {
		const noop = new NoopLogger()
		expect(() => noop.info("x")).not.toThrow()
		expect(typeof noop.child({}).info).toBe("function")
	})
})
