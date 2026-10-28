// Smoke test for the shared contract: the barrel loads, the schema carries the v0 columns, and the
// seeded defaults are stable. Runs with no DB (vitest, zero I/O).

import { describe, expect, it } from "vitest"
import { DEFAULT_ACCOUNT_ID, DEFAULT_USER_ID } from "./defaults.js"
import { budget, chatInput, chatOutput, nodes } from "./schema.js"
import type { ActorKind, AutonomyLever, NewProduction } from "./types.js"

describe("shared contract", () => {
	it("exposes the recursive-node columns, incl. the autonomy + actor seams", () => {
		expect(nodes.actorKind).toBeDefined()
		expect(nodes.autonomyLever).toBeDefined()
		expect(nodes.deps).toBeDefined()
		expect(nodes.productionId).toBeDefined()
	})

	it("exposes the direction-split chat tables + the budget flag", () => {
		expect(chatOutput.type).toBeDefined()
		expect(chatInput.respondsTo).toBeDefined()
		expect(budget.approved).toBeDefined()
	})

	it("keeps the seeded default ids stable (idempotent seed)", () => {
		expect(DEFAULT_ACCOUNT_ID).toBe("acc_default")
		expect(DEFAULT_USER_ID).toBe("usr_default")
	})

	it("accepts a well-formed NewProduction (type-level)", () => {
		const lever: AutonomyLever = "medium"
		const actor: ActorKind = "human"
		const input: NewProduction = {
			accountId: DEFAULT_ACCOUNT_ID,
			userId: DEFAULT_USER_ID,
			brief: "a 15s video about X",
			sessionId: "sess_1",
			autonomyLever: lever,
			actorKind: actor,
		}
		expect(input.actorKind).toBe("human")
	})
})
