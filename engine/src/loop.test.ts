// Engine loop tests — full pipeline on FakeStore + FakeSubagentRunner, no DB, no claude -p. The
// tests drive the human gate (approve/feedback) between ticks, like the client would.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChatOutput, Store, SubagentInput, SubagentResult, SubagentRunner } from "@core/shared"
import { FakeStore, FakeSubagentRunner } from "@core/shared/testing"
import { beforeEach, describe, expect, it } from "vitest"
import type { EngineConfig } from "./config.js"
import { Engine } from "./loop.js"
import { TypeRegistry, type TypeContract } from "./typereg.js"

const CONTRACTS: TypeContract[] = [
	{
		type: "video-project",
		name: "Video project",
		checklist: [
			{ id: "briefing", type: "briefing", deps: [] },
			{ id: "script", type: "script", deps: ["briefing"] },
			{ id: "moodboard", type: "moodboard", deps: ["briefing"] },
			{ id: "storyboard", type: "storyboard", deps: ["script", "moodboard"] },
			{ id: "render", type: "render", deps: ["storyboard"] },
			{ id: "polish", type: "polish", deps: ["render"] },
			{ id: "deliver", type: "deliver", deps: ["polish"] },
		],
	},
	{ type: "briefing", name: "Briefing", produce: "brief", agreement: true, advisoryReview: true, reviews: [{ name: "coverage", kind: "coverage" }] },
	{ type: "script", name: "Script", produce: "script", reviews: [{ name: "craft", kind: "craft" }, { name: "coverage", kind: "coverage" }] },
	{ type: "moodboard", name: "Moodboard", produce: "mood", reviews: [{ name: "craft", kind: "craft" }] },
	{ type: "storyboard", name: "Storyboard", produce: "board", reviews: [{ name: "craft", kind: "craft" }, { name: "consistency", kind: "consistency" }] },
	{ type: "render", name: "Render", rendered: true, reviews: [{ name: "consistency", kind: "consistency" }] },
	{ type: "polish", name: "Polish", produce: "polish", reviews: [{ name: "craft", kind: "craft" }] },
	{ type: "deliver", name: "Deliver", produce: "deliver", reviews: [{ name: "coverage", kind: "coverage" }] },
]

const types = TypeRegistry.fromContracts(CONTRACTS)

function makeConfig(over: Partial<EngineConfig> = {}): EngineConfig {
	return {
		artifactsDir: mkdtempSync(join(tmpdir(), "eng-")),
		maxRedos: 3,
		agreementMaxRoundsHuman: 5,
		agreementMaxRoundsAgent: 2,
		pollIntervalMs: 1000,
		...over,
	}
}

async function newProduction(store: Store, over: { actorKind?: "human" | "agent" } = {}) {
	return store.createProduction({
		accountId: "acc_default",
		userId: "usr_default",
		brief: "a 15s promo about X",
		sessionId: "sess_1",
		autonomyLever: "medium",
		actorKind: over.actorKind ?? "human",
	})
}

// Simulate the client's gate actions directly on the store (no MCP dependency).
async function gateApprove(store: Store, o: ChatOutput) {
	if (o.versionId) await store.updateVersion(o.versionId, { status: "approved" })
	if (o.nodeId) await store.updateNodeStatus(o.nodeId, "approved")
	await store.resolveOutput(o.id)
}
async function gateFeedback(store: Store, o: ChatOutput, body: string) {
	if (o.versionId) await store.updateVersion(o.versionId, { status: "denied", feedback: body })
	if (o.nodeId) await store.updateNodeStatus(o.nodeId, "pending")
	await store.resolveOutput(o.id)
}

let store: FakeStore

beforeEach(() => {
	store = new FakeStore()
})

describe("happy path — produce → present → approve, end to end", () => {
	it("walks the whole pipeline to a done production, approving each present", async () => {
		const engine = new Engine({ store, runner: new FakeSubagentRunner(), types, config: makeConfig() })
		const root = await newProduction(store)

		for (let guard = 0; guard < 200; guard++) {
			const did = await engine.tick()
			const pending = await store.pendingOutputs(root.id)
			for (const o of pending) await gateApprove(store, o)
			const r = await store.getProduction(root.id)
			if (r?.status === "approved") break
			if (!did && pending.length === 0) throw new Error("stuck before done")
		}

		expect((await store.getProduction(root.id))?.status).toBe("approved")
		const children = (await store.nodesFor(root.id)).filter((n) => n.parentId === root.id)
		expect(children).toHaveLength(7)
		expect(children.every((c) => c.status === "approved")).toBe(true)
		// the render node is produced by a WORKER running the render skill, which writes an .mp4 the
		// loop records (the fake runner drops a placeholder file — spec 09 skills+tools, no stub client)
		const render = children.find((c) => c.type === "render")!
		expect((await store.latestVersion(render.id))?.artifactPath?.endsWith(".mp4")).toBe(true)
	})
})

describe("internal review fail → redo cap → escalate (F3)", () => {
	it("redoes up to maxRedos then presents with a caveat, never spinning", async () => {
		// every reviewer says revise; producers still return drafts
		const runner = new FakeSubagentRunner((input) =>
			input.skill?.startsWith("review:") ? { output: "VERDICT: revise\nfix the tone" } : { output: "a draft" },
		)
		const engine = new Engine({ store, runner, types, config: makeConfig({ maxRedos: 3 }) })
		const root = await newProduction(store)

		// advance until the script node escalates (briefing is advisory, so it presents immediately)
		let escalation: ChatOutput | undefined
		for (let guard = 0; guard < 200 && !escalation; guard++) {
			await engine.tick()
			const pending = await store.pendingOutputs(root.id)
			for (const o of pending) {
				const node = await store.getNode(o.nodeId ?? "")
				if (node?.type === "script") escalation = o
				else await gateApprove(store, o) // approve everything else to keep moving
			}
		}

		expect(escalation).toBeDefined()
		expect(escalation?.prompt).toContain("couldn't fully satisfy")
		const script = (await store.nodesFor(root.id)).find((n) => n.type === "script")!
		const versions = await store.versionsFor(script.id)
		expect(versions).toHaveLength(3) // maxRedos attempts
		expect(versions.filter((v) => v.status === "needs-work")).toHaveLength(2)
		expect(versions.at(-1)?.status).toBe("presentable") // the escalated one is still presented
	})
})

describe("agreement cap (F5)", () => {
	it("escalates the briefing after the actor's cap instead of looping forever", async () => {
		const engine = new Engine({ store, runner: new FakeSubagentRunner(), types, config: makeConfig({ agreementMaxRoundsAgent: 2 }) })
		const root = await newProduction(store, { actorKind: "agent" }) // cap = 2

		await engine.tick() // present briefing v1
		let o = (await store.pendingOutputs(root.id))[0]!
		expect(o.prompt).not.toContain("rounds of refinement")
		await gateFeedback(store, o, "add the pricing angle") // round 1

		await engine.tick() // present v2
		o = (await store.pendingOutputs(root.id))[0]!
		expect(o.prompt).not.toContain("rounds of refinement")
		await gateFeedback(store, o, "shorter") // round 2

		await engine.tick() // present v3 — cap reached
		o = (await store.pendingOutputs(root.id))[0]!
		expect(o.prompt).toContain("rounds of refinement reached")
	})
})

describe("interaction log + session capture", () => {
	it("records one interaction per subagent run (producers + reviewers), with engine/session/usage", async () => {
		const engine = new Engine({ store, runner: new FakeSubagentRunner(), types, config: makeConfig() })
		const root = await newProduction(store)

		for (let guard = 0; guard < 200; guard++) {
			const did = await engine.tick()
			const pending = await store.pendingOutputs(root.id)
			for (const o of pending) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && pending.length === 0) throw new Error("stuck before done")
		}

		const ints = await store.interactionsFor(root.id)
		// 7 producers (all 7 leaves — render is now a worker running the render skill, a subagent too) +
		// 9 reviewers (reviews across the leaves, render's consistency reviewer included).
		expect(ints.filter((i) => i.role === "producer")).toHaveLength(7)
		expect(ints.filter((i) => i.role.startsWith("review:"))).toHaveLength(9)
		expect(ints.every((i) => i.engine === "fake")).toBe(true)
		expect(ints.every((i) => typeof i.sessionId === "string")).toBe(true)
		expect(ints.every((i) => i.inputTokens === 0 && i.costUsd === 0)).toBe(true) // usage plumbed, fake = zero
	})

	it("resumes the producer's session across redo rounds (one session per leaf producer)", async () => {
		// every reviewer says revise → the script producer redoes up to the cap, resuming its session.
		const runner = new FakeSubagentRunner((input) =>
			input.skill?.startsWith("review:") ? { output: "VERDICT: revise" } : { output: "a draft" },
		)
		const engine = new Engine({ store, runner, types, config: makeConfig({ maxRedos: 3 }) })
		const root = await newProduction(store)

		for (let guard = 0; guard < 200; guard++) {
			await engine.tick()
			const pending = await store.pendingOutputs(root.id)
			const script = (await store.nodesFor(root.id)).find((n) => n.type === "script")
			const scriptEscalated = pending.some((o) => o.nodeId === script?.id)
			if (scriptEscalated) break
			for (const o of pending) await gateApprove(store, o)
		}

		const script = (await store.nodesFor(root.id)).find((n) => n.type === "script")!
		const versions = await store.versionsFor(script.id)
		expect(versions).toHaveLength(3) // producer ran 3 times
		const sessionIds = new Set(versions.map((v) => v.subagent?.sessionId))
		expect(sessionIds.size).toBe(1) // all three redo rounds share ONE session
		expect([...sessionIds][0]).toBeDefined()
		// the 2nd and 3rd producer attempts carried a resumeSessionId (the 1st started cold)
		const scriptResumes = runner.calls.filter((c) => !c.skill?.startsWith("review:") && c.resumeSessionId)
		expect(scriptResumes.length).toBeGreaterThanOrEqual(2)
	})
})

// A non-fake runner double: it spends no real quota but reports engine="claude" so the engine counts
// its calls against the spend budget (the FakeSubagentRunner reports "fake" and is always free).
class CountingRunner implements SubagentRunner {
	readonly engine = "claude"
	calls = 0
	async run(input: SubagentInput): Promise<SubagentResult> {
		this.calls++
		if (input.skill === "render-film") {
			const m = /Work dir:\s*(\S+)/.exec(input.prompt)
			if (m?.[1]) {
				mkdirSync(m[1], { recursive: true })
				writeFileSync(join(m[1], "fake-render.mp4"), "fake")
			}
		}
		return { output: input.skill?.startsWith("review:") ? "VERDICT: pass" : "a draft", sessionId: `sess-${this.calls}` }
	}
}

describe("spend guard — real-call budget parks the worker", () => {
	it("stops claiming new leaves once the real-call budget is spent (fake never counts)", async () => {
		const runner = new CountingRunner()
		const engine = new Engine({ store, runner, types, config: makeConfig({ maxSubagentCalls: 2 }) })
		const root = await newProduction(store)

		let parked = false
		for (let guard = 0; guard < 50; guard++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if (!did) {
				parked = true
				break
			}
		}

		expect(parked).toBe(true)
		// briefing = 1 producer + 1 advisory reviewer = 2 real calls, hitting the cap; the worker parks
		// before claiming the next leaf, so script is never produced and the production never completes.
		expect(runner.calls).toBe(2)
		expect((await store.getProduction(root.id))?.status).not.toBe("approved")
		const script = (await store.nodesFor(root.id)).find((n) => n.type === "script")!
		expect(await store.versionsFor(script.id)).toHaveLength(0)
	})

	it("is uncapped when maxSubagentCalls is unset (walks the whole pipeline)", async () => {
		const runner = new CountingRunner()
		const engine = new Engine({ store, runner, types, config: makeConfig() })
		const root = await newProduction(store)

		for (let guard = 0; guard < 200; guard++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}

		expect((await store.getProduction(root.id))?.status).toBe("approved")
	})
})

describe("type registry", () => {
	it("loads the on-disk pipeline", async () => {
		const disk = TypeRegistry.load(new URL("../types", import.meta.url).pathname)
		expect(disk.has("video-project")).toBe(true)
		for (const t of ["briefing", "script", "moodboard", "storyboard", "render", "polish", "deliver"]) {
			expect(disk.has(t)).toBe(true)
		}
		expect(disk.get("render").rendered).toBe(true)
		expect(disk.get("briefing").agreement).toBe(true)
	})
})
