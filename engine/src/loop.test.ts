// Engine loop tests — full pipeline on FakeStore + FakeSubagentRunner, no DB, no claude -p. The
// tests drive the human gate (approve/feedback) between ticks, like the client would.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
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
			{ id: "final-review", type: "final-review", deps: ["polish"] },
		],
	},
	{ type: "briefing", name: "Briefing", produce: "brief", agreement: true, advisoryReview: true, reviews: [{ name: "coverage", kind: "coverage" }] },
	{ type: "script", name: "Script", produce: "script", reviews: [{ name: "craft", kind: "craft" }, { name: "coverage", kind: "coverage" }] },
	{ type: "moodboard", name: "Moodboard", produce: "mood", reviews: [{ name: "craft", kind: "craft" }] },
	{ type: "storyboard", name: "Storyboard", produce: "board", reviews: [{ name: "craft", kind: "craft" }, { name: "consistency", kind: "consistency" }] },
	{ type: "render", name: "Render", produces: "file", skill: "render-film", reviews: [{ name: "consistency", kind: "consistency" }] },
	{ type: "polish", name: "Polish", produce: "polish", reviews: [{ name: "craft", kind: "craft" }] },
	{ type: "final-review", name: "Final review", holisticReview: true },
]

const types = TypeRegistry.fromContracts(CONTRACTS)

function makeConfig(over: Partial<EngineConfig> = {}): EngineConfig {
	return {
		artifactsDir: mkdtempSync(join(tmpdir(), "eng-")),
		maxRedos: 3,
		agreementMaxRoundsHuman: 5,
		agreementMaxRoundsAgent: 2,
		maxGlobalRevisions: 2,
		convergeAfter: 99, // off by default; the convergence test sets it low
		maxParallel: 1, // serial by default; the parallelism test raises it
		noProgressAfter: 99, // off by default; the no-progress test sets it low
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

describe("boardDir file producer — the engine captures the written file, not the producer's prose (4b regression)", () => {
	it("records <board>/<output> as the artifact when the skill writes the file and returns prose", async () => {
		// The 18bc362 failure: assemble-board was a TEXT producer, so the engine recorded the subagent's
		// chat reply as the artifact while the real structured film.json it wrote went uncaptured — and a
		// downstream render then got the prose and refused. produces:"file" + output must capture the FILE.
		const C: TypeContract[] = [
			{ type: "video-project", name: "VP", checklist: [{ id: "board", type: "assemble-board", deps: [] }] },
			{ type: "assemble-board", name: "Assemble board", produces: "file", output: "film.json", boardDir: true, skill: "assemble-board" },
		]
		const t = TypeRegistry.fromContracts(C)
		const PROSE = "I've assembled film.json and saved it to the board directory. I didn't render it."
		const runner: SubagentRunner = {
			engine: "fake",
			async run(input: SubagentInput): Promise<SubagentResult> {
				// Mirror the assemble-board skill: write the structured film.json into the shared board dir,
				// reply with prose only. The engine must capture the file, never this stdout.
				const m = /Shared board dir:\s*(\S+)/.exec(input.prompt)
				if (m?.[1]) {
					mkdirSync(m[1], { recursive: true })
					writeFileSync(join(m[1], "film.json"), JSON.stringify({ script: ["one line"], plates: {}, camera: [] }), "utf8")
				}
				return { output: PROSE, sessionId: "s1" }
			},
		}
		const engine = new Engine({ store, runner, types: t, config: makeConfig() })
		const root = await newProduction(store)
		for (let guard = 0; guard < 50; guard++) {
			const did = await engine.tick()
			const pending = await store.pendingOutputs(root.id)
			for (const o of pending) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && pending.length === 0) break
		}
		const board = (await store.nodesFor(root.id)).find((n) => n.type === "assemble-board")!
		const v = await store.latestVersion(board.id)
		expect(v?.artifactPath?.endsWith("/board/film.json")).toBe(true) // the FILE, in the board dir
		const captured = readFileSync(v!.artifactPath!, "utf8")
		expect(captured).not.toContain("I've assembled") // never the producer's prose
		expect(JSON.parse(captured).script).toEqual(["one line"]) // the structured spec
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
		// 7 producers (all 7 leaves — render runs the render skill, final-review runs the critique, both
		// subagents logged as producers) + 8 reviewers (final-review is holistic: no specialist reviewers).
		expect(ints.filter((i) => i.role === "producer")).toHaveLength(7)
		expect(ints.filter((i) => i.role.startsWith("review:"))).toHaveLength(8)
		expect(ints.every((i) => i.engine === "fake")).toBe(true)
		expect(ints.every((i) => typeof i.sessionId === "string")).toBe(true)
		expect(ints.every((i) => i.inputTokens === 0 && i.costUsd === 0)).toBe(true) // usage plumbed, fake = zero
		expect(ints.every((i) => typeof i.prompt === "string" && i.prompt.length > 0)).toBe(true) // the prompt sent to each subagent is persisted
	})

	it("runs each producer attempt FRESH across redo rounds (no resumed session — avoids the resume trap)", async () => {
		// every reviewer says revise → the script producer redoes up to the cap. Each redo must start a
		// fresh provider session (no resumeSessionId) so it re-reads the current skill and acts on the
		// reviewers' feedback, rather than resuming a stale session and re-emitting its old output.
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
		// no producer attempt resumes a prior session — every redo is cold, so an edited skill and the
		// reviewer feedback reach each attempt.
		const producerResumes = runner.calls.filter((c) => !c.skill?.startsWith("review:") && c.resumeSessionId)
		expect(producerResumes.length).toBe(0)
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
		return { output: input.skill?.startsWith("review:") || input.skill === "review-render" ? "VERDICT: pass" : "a draft", sessionId: `sess-${this.calls}` }
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
		for (const t of ["briefing", "script", "moodboard", "storyboard", "polish", "final-review"]) {
			expect(disk.has(t)).toBe(true)
		}
		// the monolithic render type is removed entirely — assembly is the sole rendered composite step
		expect(disk.has("render")).toBe(false)
		expect(disk.get("briefing").agreement).toBe(true)
		expect(disk.get("final-review").holisticReview).toBe(true)
		// storyboard is now a PLANNER that fans out one `card` per beat and exposes the cards to its
		// dependents (assemble-board); the per-card craft reviewers live on the `card` type.
		expect(disk.get("storyboard").planner).toBe(true)
		expect(disk.get("storyboard").childType).toBe("card")
		expect(disk.get("storyboard").exposeChildrenToDependents).toBe(true)
		expect(disk.get("card").reviews?.map((r) => r.skill)).toEqual(
			expect.arrayContaining(["review-card-quality", "review-card-conformance", "review-card-consistency"]),
		)
		// the composed board fan-out: storyboard(planner) → card[] → assemble-board, then build realizes.
		// These are no longer STATIC checklist steps — brainstorm-how-select (plansProduction) materializes
		// them as siblings — but the types still load and keep their structure (fan-out + deps now ride in
		// the materialized DAG, asserted by the two-phase + production-plan tests).
		for (const t of ["storyboard", "assemble-board", "build"]) expect(disk.has(t)).toBe(true)
		// every step owns its reviewer rubric (no generic lenses): moodboard gets the pair, polish +
		// briefing their single axis. moodboard's conformance axis is what lets revalidation keep it.
		expect(disk.get("moodboard").reviews?.map((r) => r.skill)).toEqual(
			expect.arrayContaining(["review-moodboard-quality", "review-moodboard-conformance"]),
		)
		expect(disk.get("polish").reviews?.[0]?.skill).toBe("review-polish-quality")
		expect(disk.get("briefing").reviews?.[0]?.skill).toBe("review-briefing-coverage")
		// the whole-film audio/sync gate the retired render node carried now lives on assemble
		expect(disk.get("assemble").reviews?.find((r) => r.kind === "audio")?.skill).toBe("review-render-audio")
		// the monolithic render node stays retired — in neither the static checklist nor the type set
		const vp = disk.get("video-project").checklist?.map((e) => e.type) ?? []
		expect(vp).not.toContain("render")
		// the spine tail (build → assemble → polish → final-review) is materialized by the HOW winner now,
		// not static — but the types still load (final-review's holistic flag is asserted above)
		for (const t of ["build", "assemble", "polish", "final-review"]) expect(disk.has(t)).toBe(true)
	})

	it("wires research + brainstorm as real chain steps before the script", async () => {
		const disk = TypeRegistry.load(new URL("../types", import.meta.url).pathname)
		for (const t of ["research", "brainstorm", "idea", "brainstorm-select"]) expect(disk.has(t)).toBe(true)
		// brainstorm is a planner that fans out idea agents and exposes them to its dependents (the judge)
		expect(disk.get("brainstorm").planner).toBe(true)
		expect(disk.get("brainstorm").childType).toBe("idea")
		expect(disk.get("brainstorm").exposeChildrenToDependents).toBe(true)
		// the chain: briefing → research → brainstorm → brainstorm-select, then the winning concept flows
		// into the HOW brainstorm (brainstorm-how → brainstorm-how-select) rather than straight into a
		// static script — the script is materialized by the HOW winner now, not a checklist step.
		const chain = disk.get("video-project").checklist ?? []
		const byId = new Map(chain.map((e) => [e.id, e]))
		expect(chain.map((e) => e.type).slice(0, 6)).toEqual(["briefing", "research", "brainstorm", "brainstorm-select", "brainstorm-how", "brainstorm-how-select"])
		expect(byId.get("research")?.deps).toEqual(["briefing"])
		expect(byId.get("brainstorm")?.deps).toEqual(["briefing", "research"])
		expect(byId.get("brainstorm-select")?.deps).toEqual(["brainstorm"])
		expect(byId.get("brainstorm-how")?.deps).toEqual(["brainstorm-select"])
		// brainstorm-how-select also deps on brainstorm-select (not just brainstorm-how): the winning concept
		// must be in the plan node's upstream so the materialized spine's entry stages can inherit it (0012).
		expect(byId.get("brainstorm-how-select")?.deps).toEqual(["brainstorm-how", "brainstorm-select"])
	})

	it("loads the unified scene pipeline (build → scene → assemble)", async () => {
		const disk = TypeRegistry.load(new URL("../types", import.meta.url).pathname)
		// the scene fan-out is video-project's tail — the separate generative project type is gone. These
		// spine stages are materialized by the HOW winner now, not static checklist steps, but the types
		// still load with their structure intact (asserted below).
		expect(disk.has("video-project-generative")).toBe(false)
		for (const t of ["storyboard", "build", "assemble"]) expect(disk.has(t)).toBe(true)
		// build is a sub-project: it expands into asset/voice/soundtrack leaves + the scene planner
		const buildSub = disk.get("build").checklist?.map((e) => e.type) ?? []
		expect(buildSub).toEqual(expect.arrayContaining(["build-assets", "build-voice", "build-soundtrack", "build-scenes"]))
		// build-scenes is the planner that fans out one scene child per storyboard scene
		expect(disk.get("build-scenes").planner).toBe(true)
		expect(disk.get("build-scenes").childType).toBe("scene")
		// assembly is its own rendered step (concatenates scene clips), not a monolithic render
		expect(disk.get("assemble").produces).toBe("file")
		expect(disk.get("assemble").skill).toBe("assemble-scenes")
		// assemble carries the whole-film audio gate (relocated from the retired render node)
		expect(disk.get("assemble").reviews?.some((r) => r.kind === "audio")).toBe(true)
		// the build leaves are no longer ungated — each carries a quality gate
		for (const t of ["build-assets", "build-voice", "build-soundtrack"]) expect((disk.get(t).reviews ?? []).length).toBeGreaterThan(0)
		// a scene realizes its beat into a clip — a file-output leaf (authored render, or keyless spec)
		expect(disk.get("scene").produces).toBe("file")
		// a scene is reviewed on all three axes — quality, conformance, and the consistency gate
		expect(disk.get("scene").reviews?.map((r) => r.skill)).toEqual(
			expect.arrayContaining(["review-scene-quality", "review-scene-conformance", "review-scene-consistency"]),
		)
	})

	it("video-project is briefing → WHAT brainstorm → HOW brainstorm (spine materialized by the HOW winner)", async () => {
		const disk = TypeRegistry.load(new URL("../types", import.meta.url).pathname)
		const vp = disk.get("video-project").checklist?.map((e) => e.type) ?? []
		// the static checklist stops at the two brainstorms; the spine stages (script/moodboard/storyboard/
		// assemble-board/build/assemble/polish/final-review) are NO LONGER static — brainstorm-how-select
		// (plansProduction) materializes them as siblings under the root.
		expect(vp).toEqual(["briefing", "research", "brainstorm", "brainstorm-select", "brainstorm-how", "brainstorm-how-select"])
		expect(disk.get("brainstorm-how").planner).toBe(true)
		expect(disk.get("brainstorm-how").childType).toBe("how-idea")
		expect(disk.get("brainstorm-how-select").plansProduction).toBe(true)
	})
})

describe("reviewer skills — two axes (quality + conformance)", () => {
	it("dispatches each declared reviewer skill to the runner (per-step rubric owns the axis)", async () => {
		const contracts: TypeContract[] = [
			{ type: "video-project", name: "Mini", checklist: [{ id: "script", type: "script", deps: [] }] },
			{
				type: "script",
				name: "Script",
				produce: "script",
				reviews: [
					{ name: "quality", kind: "craft", skill: "review-script-quality" },
					{ name: "conformance", kind: "coverage", skill: "review-script-conformance" },
				],
			},
		]
		const runner = new FakeSubagentRunner()
		const engine = new Engine({ store, runner, types: TypeRegistry.fromContracts(contracts), config: makeConfig() })
		const root = await newProduction(store)

		for (let guard = 0; guard < 50; guard++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}

		const skills = runner.calls.map((c) => c.skill)
		// each axis dispatched its declared reviewer skill (not the generic review:<kind> label)
		expect(skills).toContain("review-script-quality")
		expect(skills).toContain("review-script-conformance")
		expect(skills).toContain("script") // the producer still ran under the script producer skill
		// reviewer skills pass via the fake default (review-* ⇒ VERDICT: pass), so the leaf rolled up
		expect((await store.getProduction(root.id))?.status).toBe("approved")
	})
})

describe("holistic final review — reopen + revalidation cascade (rebuild only what the change breaks)", () => {
	// Drive a production to done while the final review reopens `moodboard` once. `verdictFor` lets each
	// test decide what the storyboard's consistency reviewer says WHEN REVALIDATING (the changed-upstream
	// re-check) — pass = storyboard still holds, revise = the change broke it.
	async function runReopen(verdictForStoryboardRevalidation: "pass" | "revise") {
		let critiques = 0
		let draftN = 0
		const runner = new FakeSubagentRunner((input) => {
			if (input.skill === "final-review") {
				critiques++
				return critiques === 1 ? { output: "VERDICT: revise\nREOPEN: moodboard — tone too cold" } : { output: "VERDICT: pass" }
			}
			// the storyboard consistency reviewer, only on a revalidation pass, returns the test's verdict
			if (input.skill === "review:consistency" && input.prompt.includes("REVALIDATING")) {
				return { output: `VERDICT: ${verdictForStoryboardRevalidation}` }
			}
			if (/^review[:-]/.test(input.skill ?? "")) return { output: "VERDICT: pass" }
			// unique per call so a re-produced node genuinely changes (otherwise revalidation keeps it)
			return { output: `draft ${++draftN}` }
		})
		const engine = new Engine({ store, runner, types, config: makeConfig({ maxGlobalRevisions: 2 }) })
		const root = await newProduction(store)
		for (let guard = 0; guard < 400; guard++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}
		expect((await store.getProduction(root.id))?.status).toBe("approved")
		expect(critiques).toBeGreaterThanOrEqual(2) // revised once, then passed
		const nodes = await store.nodesFor(root.id)
		return (type: string) => store.versionsFor(nodes.find((n) => n.type === type)!.id).then((v) => v.length)
	}

	it("keeps downstream when it still holds — the change does not propagate past what it affects", async () => {
		const versionsOf = await runReopen("pass") // storyboard's consistency re-check passes
		expect(await versionsOf("moodboard")).toBeGreaterThanOrEqual(2) // named target → re-produced
		expect(await versionsOf("storyboard")).toBe(1) // revalidated against the new moodboard, still holds → KEPT
		expect(await versionsOf("render")).toBe(1) // storyboard unchanged → render kept, cascade stopped
		expect(await versionsOf("script")).toBe(1) // not downstream of moodboard → never touched
	})

	it("rebuilds downstream when the change breaks it — and propagates to its dependents", async () => {
		const versionsOf = await runReopen("revise") // storyboard's consistency re-check fails
		expect(await versionsOf("moodboard")).toBeGreaterThanOrEqual(2) // named target → re-produced
		expect(await versionsOf("storyboard")).toBeGreaterThanOrEqual(2) // revalidation failed → rebuilt
		expect(await versionsOf("render")).toBeGreaterThanOrEqual(2) // storyboard changed → render rebuilt (propagated)
		expect(await versionsOf("script")).toBe(1) // still not downstream of moodboard → untouched
	})
})

// A video-project whose `build` step is a PLANNER that fans out one `scene` leaf per unit, then an
// `assemble` leaf depends on the whole build. Exercises the three recursion primitives at once:
// non-root dispatch of a plan node, dynamic fan-out, and rollup from scene → build → root.
const RECURSIVE_CONTRACTS: TypeContract[] = [
	{
		type: "video-project",
		name: "Video project",
		checklist: [
			{ id: "storyboard", type: "storyboard", deps: [] },
			{ id: "build", type: "build", deps: ["storyboard"] },
			{ id: "assemble", type: "assemble", deps: ["build"] },
		],
	},
	{ type: "storyboard", name: "Storyboard", produce: "board" },
	{ type: "build", name: "Build", planner: true, childType: "scene", skill: "plan-scenes", produce: "plan scenes" },
	{ type: "scene", name: "Scene", produce: "scene", reviews: [{ name: "craft", kind: "craft" }, { name: "consistency", kind: "consistency" }] },
	{ type: "assemble", name: "Assemble", produce: "assemble" },
]
const recursiveTypes = TypeRegistry.fromContracts(RECURSIVE_CONTRACTS)

describe("recursive fan-out — plan node, dynamic children, rollup at depth", () => {
	it("fans a planner into scene children, each reviewed, rolling up build → root", async () => {
		const runner = new FakeSubagentRunner((input) => {
			if (input.skill === "plan-scenes") {
				return { output: '```json\n[{"name":"Hook","brief":"the hook scene"},{"name":"CTA","brief":"the cta scene"}]\n```' }
			}
			if (input.skill?.startsWith("review:")) return { output: "VERDICT: pass" }
			return { output: `[stub ${input.skill}] draft` }
		})
		const engine = new Engine({ store, runner, types: recursiveTypes, config: makeConfig() })
		const root = await newProduction(store)

		for (let guard = 0; guard < 200; guard++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}

		expect((await store.getProduction(root.id))?.status).toBe("approved")
		const all = await store.nodesFor(root.id)
		const build = all.find((n) => n.type === "build")!
		const scenes = all.filter((n) => n.type === "scene")
		expect(scenes).toHaveLength(2) // the planner fanned out one child per plan entry
		expect(scenes.every((s) => s.parentId === build.id)).toBe(true) // children of the build node
		expect(scenes.every((s) => s.status === "approved")).toBe(true)
		expect(build.status).toBe("approved") // rolled up from its scene children, not a leaf
		// each scene inherited the build node's upstream deps (the storyboard), so it saw the same approved work
		const storyboard = all.find((n) => n.type === "storyboard")!
		expect(scenes.every((s) => s.deps.includes(storyboard.id))).toBe(true)
		// the per-unit brief from the plan rode into the scene node's description
		expect(scenes.map((s) => s.description).sort()).toEqual(["the cta scene", "the hook scene"])
	})
})

// Brainstorm phase: a planner fans out N `idea` candidates, then a `brainstorm-select` judge that
// depends on the brainstorm node must SEE the developed ideas (not just the plan) — the
// exposeChildrenToDependents path. Proves the fresh-judge gets the fanned-out units as upstream.
const BRAINSTORM_CONTRACTS: TypeContract[] = [
	{
		type: "video-project",
		name: "Video project",
		checklist: [
			{ id: "brainstorm", type: "brainstorm", deps: [] },
			{ id: "select", type: "brainstorm-select", deps: ["brainstorm"] },
			{ id: "script", type: "script", deps: ["select"] },
		],
	},
	{ type: "brainstorm", name: "Brainstorm", planner: true, childType: "idea", exposeChildrenToDependents: true, skill: "brainstorm", produce: "seed concepts" },
	{ type: "idea", name: "Idea", produce: "develop", skill: "idea" },
	{ type: "brainstorm-select", name: "Select", produce: "pick the winner", skill: "brainstorm-select" },
	{ type: "script", name: "Script", produce: "script", reviews: [{ name: "craft", kind: "craft" }] },
]
const brainstormTypes = TypeRegistry.fromContracts(BRAINSTORM_CONTRACTS)

describe("brainstorm phase — fan out ideas, fresh judge sees the developed ideas", () => {
	it("fans out 3 idea candidates and hands all three to the select judge's upstream", async () => {
		const runner = new FakeSubagentRunner((input) => {
			if (input.skill === "brainstorm") {
				return { output: '```json\n[{"name":"Angle A","brief":"ALPHA"},{"name":"Angle B","brief":"BRAVO"},{"name":"Angle C","brief":"CHARLIE"}]\n```' }
			}
			if (input.skill === "idea") {
				// Echo the one seed this fanned-out idea node was handed, so each sibling's developed
				// treatment is genuinely distinct — a collision would make them clobber to one.
				const seed = ["ALPHA", "BRAVO", "CHARLIE"].find((s) => input.prompt.includes(s)) ?? "?"
				return { output: `IDEA TREATMENT for ${seed}` }
			}
			if (input.skill?.startsWith("review:")) return { output: "VERDICT: pass" }
			return { output: `draft ${input.skill}` }
		})
		const engine = new Engine({ store, runner, types: brainstormTypes, config: makeConfig() })
		const root = await newProduction(store)

		for (let guard = 0; guard < 200; guard++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}

		expect((await store.getProduction(root.id))?.status).toBe("approved")
		const all = await store.nodesFor(root.id)
		const brainstorm = all.find((n) => n.type === "brainstorm")!
		const ideas = all.filter((n) => n.type === "idea")
		expect(ideas).toHaveLength(3) // fanned out one candidate per seed
		expect(ideas.every((i) => i.parentId === brainstorm.id && i.status === "approved")).toBe(true)
		// the select judge's producer call saw every developed idea in its upstream (exposeChildrenToDependents)
		const selectCall = runner.calls.find((c) => c.skill === "brainstorm-select")!
		expect(selectCall).toBeDefined()
		const ideaMentions = (selectCall.prompt.match(/### idea/g) ?? []).length
		expect(ideaMentions).toBe(3) // all three idea artifacts handed to the judge, not just the plan
		// …and the three are genuinely distinct — fanned siblings must not share an artifact path or
		// clobber one another on disk (the type-keyed filename bug that collapsed them to one).
		const ideaVersions = await Promise.all(ideas.map((i) => store.latestVersion(i.id)))
		const ideaPaths = ideaVersions.map((v) => v!.artifactPath!)
		expect(new Set(ideaPaths).size).toBe(3)
		const ideaContents = ideaPaths.map((p) => readFileSync(p, "utf8"))
		expect(new Set(ideaContents).size).toBe(3)
	})
})

// A plansProduction node (the HOW judge) does NOT fan childType children under itself — it MATERIALIZES
// the production's spine as SIBLING nodes under the root, then the ordinary loop runs them to approved.
// The frozen DAG's deps are stage KEYS the engine resolves to the created siblings' real node ids. This
// proves the sibling-under-root parenting and the dep-resolution, end to end on a materialized pipeline.
const PRODUCTION_PLAN_CONTRACTS: TypeContract[] = [
	{
		type: "video-project",
		name: "VP",
		rootCapable: true,
		inputs: [{ name: "brief", required: true }],
		checklist: [
			{ id: "briefing", type: "briefing", deps: [] },
			{ id: "plan", type: "production-plan", deps: ["briefing"] },
		],
	},
	{ type: "briefing", name: "Briefing", produce: "brief", agreement: true, advisoryReview: true, reviews: [{ name: "coverage", kind: "coverage" }] },
	{ type: "production-plan", name: "Plan", plansProduction: true, skill: "production-plan" },
	{ type: "script", name: "Script", produce: "script" },
	{ type: "final-review", name: "Final review", holisticReview: true },
]
const productionPlanTypes = TypeRegistry.fromContracts(PRODUCTION_PLAN_CONTRACTS)

describe("production-plan — materializes the frozen DAG as siblings under the root", () => {
	it("materializes its stages as sibling nodes under the root, then runs them to approved", async () => {
		const runner = new FakeSubagentRunner((input) =>
			input.skill === "production-plan"
				? { output: '```json\n{"stages":[{"id":"script","type":"script","deps":[]},{"id":"final-review","type":"final-review","deps":["script"]}]}\n```' }
				: input.skill?.startsWith("review:") || input.skill === "final-review"
					? { output: "VERDICT: pass" }
					: { output: "draft" },
		)
		const engine = new Engine({ store, runner, types: productionPlanTypes, config: makeConfig() })
		const root = await newProduction(store)

		for (let guard = 0; guard < 200; guard++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}

		const all = await store.nodesFor(root.id)
		const plan = all.find((n) => n.type === "production-plan")!
		const script = all.find((n) => n.type === "script")
		expect(script).toBeDefined()
		expect(script?.parentId).toBe(root.id) // a SIBLING under the root, not a child of the plan node
		expect(script?.parentId).not.toBe(plan.id)
		// deps are stage keys resolved to real node ids: final-review builds on the script's own node id
		const finalReview = all.find((n) => n.type === "final-review")!
		expect(finalReview.parentId).toBe(root.id)
		expect(finalReview.deps).toEqual([script!.id])
		expect((await store.getProduction(root.id))?.status).toBe("approved")
	})

	it("seeds spine entry stages with the plan node's upstream, so they are not cut off from it (0012)", async () => {
		const runner = new FakeSubagentRunner((input) =>
			input.skill === "production-plan"
				? { output: '```json\n{"stages":[{"id":"script","type":"script","deps":[]},{"id":"final-review","type":"final-review","deps":["script"]}]}\n```' }
				: input.skill?.startsWith("review:") || input.skill === "final-review"
					? { output: "VERDICT: pass" }
					: { output: "draft" },
		)
		const engine = new Engine({ store, runner, types: productionPlanTypes, config: makeConfig() })
		const root = await newProduction(store)

		for (let guard = 0; guard < 200; guard++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}

		const all = await store.nodesFor(root.id)
		const plan = all.find((n) => n.type === "production-plan")!
		const briefing = all.find((n) => n.type === "briefing")!
		const script = all.find((n) => n.type === "script")!
		// script is a spine ENTRY stage (its frozen DAG deps are []). It must inherit the plan node's own
		// upstream (here: briefing) so it is NOT cut off from what the plan was built from — otherwise it
		// runs on the bare brief, never seeing the winning concept the brainstorm produced (0012).
		expect(script.deps).toEqual(plan.deps)
		expect(script.deps).toContain(briefing.id)
		// a non-entry stage keeps its spine-local deps, not the plan node's
		const finalReview = all.find((n) => n.type === "final-review")!
		expect(finalReview.deps).toEqual([script.id])
	})
})

// Phase E — the autonomy lever gates whether production planning ASKS the client about a paid/tier
// capability fork before freezing the DAG, or DECIDES. A plansProduction planner may emit, INSTEAD of
// the stages, an {"ask":{prompt,options}} block. On low/medium the engine PRESENTS it (an `options`
// chat_output) and HOLDS the node — no spine materializes until the client answers; the answer rides
// back as version feedback (submitFeedback), re-dispatching the node with the answer in its prompt, and
// the planner then emits the stages. On high an ask is a contract violation — the planner must decide —
// so the engine throws rather than hanging.
describe("Phase-2 autonomy — autonomyLever gates whether production planning asks or decides", () => {
	it("low autonomy: a paid-capability fork is presented as options and holds; the answer resumes it into the frozen spine", async () => {
		// The production-plan skill asks on the first pass; once the client's answer is in its prompt
		// (feedback), it emits the stages. The fake keys off the answer text the engine threads through.
		const runner = new FakeSubagentRunner((input) => {
			if (input.skill === "production-plan") {
				return input.prompt.includes("screen-only")
					? { output: '```json\n{"stages":[{"id":"script","type":"script","deps":[]},{"id":"final-review","type":"final-review","deps":["script"]}]}\n```' }
					: { output: '```json\n{"ask":{"prompt":"Avatar presenter costs a tier — include it?","options":["yes","no"]}}\n```' }
			}
			return input.skill?.startsWith("review:") || input.skill === "final-review" ? { output: "VERDICT: pass" } : { output: "draft" }
		})
		const engine = new Engine({ store, runner, types: productionPlanTypes, config: makeConfig() })
		const root = await store.createProduction({ accountId: "acc_default", userId: "usr_default", brief: "b", sessionId: "s", autonomyLever: "low", actorKind: "human" })

		// tick until the plan node PRESENTS its paid-capability options (approving the briefing present on the way)
		let ask: ChatOutput | undefined
		for (let guard = 0; guard < 50; guard++) {
			await engine.tick()
			const pending = await store.pendingOutputs(root.id)
			ask = pending.find((o) => o.type === "options")
			if (ask) break
			for (const o of pending) await gateApprove(store, o)
		}
		expect(ask).toBeDefined()
		expect(ask?.options).toEqual(["yes", "no"])
		expect(ask?.prompt).toMatch(/tier/i)
		const plan = (await store.nodesFor(root.id)).find((n) => n.type === "production-plan")!
		expect(plan.status).toBe("needs-presentation") // the plan node HOLDS — it is not approved
		const held = await store.nodesFor(root.id)
		expect(held.some((n) => n.type === "script")).toBe(false) // NO spine sibling materialized while it holds
		expect(held.some((n) => n.type === "final-review")).toBe(false)

		// the client answers → the node re-dispatches, the planner (now fed the answer) emits the stages
		await gateFeedback(store, ask!, "no — keep it screen-only, skip the avatar")
		for (let guard = 0; guard < 200; guard++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}
		const after = await store.nodesFor(root.id)
		const script = after.find((n) => n.type === "script")
		expect(script?.parentId).toBe(root.id) // now a SIBLING under the root
		const finalReview = after.find((n) => n.type === "final-review")!
		expect(finalReview.deps).toEqual([script!.id])
		expect(after.find((n) => n.type === "production-plan")?.status).toBe("approved")
		expect((await store.getProduction(root.id))?.status).toBe("approved")
	})

	it("high autonomy: an ask is a contract violation — the planner must decide, so the engine throws (no hang)", async () => {
		const runner = new FakeSubagentRunner((input) =>
			input.skill === "production-plan"
				? { output: '```json\n{"ask":{"prompt":"Avatar presenter costs a tier — include it?","options":["yes","no"]}}\n```' }
				: input.skill?.startsWith("review:") || input.skill === "final-review"
					? { output: "VERDICT: pass" }
					: { output: "draft" },
		)
		const engine = new Engine({ store, runner, types: productionPlanTypes, config: makeConfig() })
		const root = await store.createProduction({ accountId: "acc_default", userId: "usr_default", brief: "b", sessionId: "s", autonomyLever: "high", actorKind: "agent" })

		await expect(
			(async () => {
				for (let guard = 0; guard < 50; guard++) {
					await engine.tick()
					for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
					if ((await store.getProduction(root.id))?.status === "approved") break
				}
			})(),
		).rejects.toThrow(/autonomy|ask|decide/i)
	})
})

// The headline capability: the final review reopens ONE fanned-out scene, and only that scene's own
// re-production + everything downstream rebuilds — its sibling scenes and the upstream are left alone.
const SURGICAL_CONTRACTS: TypeContract[] = [
	{
		type: "video-project",
		name: "Video project",
		checklist: [
			{ id: "storyboard", type: "storyboard", deps: [] },
			{ id: "build", type: "build", deps: ["storyboard"] },
			{ id: "render", type: "render", deps: ["build"] },
			{ id: "polish", type: "polish", deps: ["render"] },
			{ id: "final-review", type: "final-review", deps: ["polish"] },
		],
	},
	{ type: "storyboard", name: "Storyboard", produce: "board" },
	{ type: "build", name: "Build", planner: true, childType: "scene", skill: "plan-scenes", produce: "plan scenes" },
	{ type: "scene", name: "Scene", produce: "scene", reviews: [{ name: "craft", kind: "craft" }, { name: "consistency", kind: "consistency" }] },
	{ type: "render", name: "Render", produce: "render" },
	{ type: "polish", name: "Polish", produce: "polish" },
	{ type: "final-review", name: "Final review", holisticReview: true },
]
const surgicalTypes = TypeRegistry.fromContracts(SURGICAL_CONTRACTS)

describe("surgical reopen — one fanned-out scene, siblings untouched", () => {
	it("reopens scene[2] alone, rebuilds downstream, leaves scenes 1 & 3 and the upstream intact", async () => {
		let critiques = 0
		let draftN = 0
		const runner = new FakeSubagentRunner((input) => {
			if (input.skill === "plan-scenes") {
				return { output: '```json\n[{"name":"Hook","brief":"hook"},{"name":"Problem","brief":"problem"},{"name":"CTA","brief":"cta"}]\n```' }
			}
			if (input.skill === "final-review") {
				critiques++
				return critiques === 1
					? { output: "VERDICT: revise\nREOPEN: scene[2] — too much empty space, text too small" }
					: { output: "VERDICT: pass" }
			}
			if (input.skill?.startsWith("review:")) return { output: "VERDICT: pass" }
			// unique per call so a re-produced node genuinely changes (otherwise revalidation keeps it)
			return { output: `draft ${++draftN}` }
		})
		const engine = new Engine({ store, runner, types: surgicalTypes, config: makeConfig({ maxGlobalRevisions: 2 }) })
		const root = await newProduction(store)

		for (let guard = 0; guard < 400; guard++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}

		expect((await store.getProduction(root.id))?.status).toBe("approved")
		const all = await store.nodesFor(root.id)
		const vcount = async (id: string) => (await store.versionsFor(id)).length
		const scenes = all.filter((n) => n.type === "scene").sort((a, b) => a.position - b.position)
		expect(scenes).toHaveLength(3)
		expect(await vcount(scenes[1]!.id)).toBeGreaterThanOrEqual(2) // scene[2] (position 1) reopened → re-produced
		expect(await vcount(scenes[0]!.id)).toBe(1) // sibling — untouched
		expect(await vcount(scenes[2]!.id)).toBe(1) // sibling — untouched
		const build = all.find((n) => n.type === "build")!
		expect(build.status).toBe("approved") // re-rolled-up after the one scene re-approved
		expect(await vcount(build.id)).toBe(1) // NOT re-planned — the fan-out stood; only the bad scene redid
		expect(await vcount(all.find((n) => n.type === "render")!.id)).toBeGreaterThanOrEqual(2) // downstream of build → rebuilt
		expect(await vcount(all.find((n) => n.type === "storyboard")!.id)).toBe(1) // upstream of build → untouched
	})
})

// When the storyboard itself changes under a planner, the planner must RE-PLAN and reconcile its
// children — not blindly re-fan (losing approved scenes) and not merely re-roll-up (missing a scene the
// new plan adds/removes).
const REPLAN_CONTRACTS: TypeContract[] = [
	{
		type: "video-project",
		name: "Video project",
		checklist: [
			{ id: "storyboard", type: "storyboard", deps: [] },
			{ id: "build", type: "build", deps: ["storyboard"] },
			{ id: "assemble", type: "assemble", deps: ["build"] },
			{ id: "final-review", type: "final-review", deps: ["assemble"] },
		],
	},
	{ type: "storyboard", name: "Storyboard", produce: "board" },
	{ type: "build", name: "Build", planner: true, childType: "scene", skill: "plan-scenes", produce: "plan scenes" },
	{ type: "scene", name: "Scene", produce: "scene", reviews: [{ name: "quality", kind: "craft" }, { name: "consistency", kind: "consistency" }] },
	{ type: "assemble", name: "Assemble", produce: "assemble" },
	{ type: "final-review", name: "Final review", holisticReview: true },
]
const replanTypes = TypeRegistry.fromContracts(REPLAN_CONTRACTS)

describe("planner re-plan — reopen the storyboard, reconcile scenes by name", () => {
	it("keeps matching scenes, adds the new one, skips the dropped one", async () => {
		let plans = 0
		let critiques = 0
		let draftN = 0
		const runner = new FakeSubagentRunner((input) => {
			if (input.skill === "plan-scenes") {
				plans++
				// first plan: A, B, C — after the storyboard reopen, the new plan drops C and adds D
				return plans === 1
					? { output: '```json\n[{"name":"A","brief":"a"},{"name":"B","brief":"b"},{"name":"C","brief":"c"}]\n```' }
					: { output: '```json\n[{"name":"A","brief":"a"},{"name":"B","brief":"b"},{"name":"D","brief":"d"}]\n```' }
			}
			if (input.skill === "final-review") {
				critiques++
				return critiques === 1 ? { output: "VERDICT: revise\nREOPEN: storyboard — restructure the beats" } : { output: "VERDICT: pass" }
			}
			if (input.skill?.startsWith("review:")) return { output: "VERDICT: pass" }
			return { output: `draft ${++draftN}` }
		})
		const engine = new Engine({ store, runner, types: replanTypes, config: makeConfig({ maxGlobalRevisions: 2 }) })
		const root = await newProduction(store)

		for (let guard = 0; guard < 400; guard++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}

		expect((await store.getProduction(root.id))?.status).toBe("approved")
		expect(plans).toBe(2) // planned once, re-planned once after the storyboard reopen
		const all = await store.nodesFor(root.id)
		const scene = (name: string) => all.find((n) => n.type === "scene" && n.name === name)
		expect(scene("A")?.status).toBe("approved") // still in the new plan → kept
		expect(scene("B")?.status).toBe("approved") // still in the new plan → kept
		expect(scene("C")?.status).toBe("skipped") // dropped from the new plan → skipped, not rebuilt
		expect(scene("D")?.status).toBe("approved") // new in the plan → created + built
		const build = all.find((n) => n.type === "build")!
		expect(build.status).toBe("approved") // re-rolled-up over {A,B,D approved, C skipped}
		expect((await store.versionsFor(build.id)).length).toBe(2) // re-planned once
	})
})

// Convergence: a leaf can sit at all-but-one-pass round after round and never get a unanimous pass.
// After convergeAfter consecutive all-but-one-pass rounds, the gate accepts it instead of grinding to
// the redo cap. A weak leaf (more than one dissent) never sustains the streak. (Under carry-forward,
// 0021, a passed axis is not re-run — so the reachable near-pass is a single axis that keeps dissenting
// while the carried ones pass; convergence absorbs exactly that. convergeAfter defaults to 99 = off.)
const CONVERGE_CONTRACTS: TypeContract[] = [
	{ type: "video-project", name: "Root", checklist: [{ id: "leaf", type: "leaf", deps: [] }] },
	{
		type: "leaf",
		name: "Leaf",
		produce: "make it",
		reviews: [
			{ name: "a", kind: "craft" },
			{ name: "b", kind: "coverage" },
			{ name: "c", kind: "consistency" },
		],
	},
]
const convergeTypes = TypeRegistry.fromContracts(CONVERGE_CONTRACTS)

describe("convergence — accept an oscillating near-pass instead of grinding to the cap", () => {
	it("accepts a leaf that passes all-but-one reviewer for convergeAfter consecutive rounds", async () => {
		const runner = new FakeSubagentRunner((input) => {
			if (!input.skill?.startsWith("review:")) return { output: "draft" }
			const kind = input.skill.slice("review:".length)
			// One axis keeps dissenting; the other two pass on v1 and are carried forward (0021), so each
			// redo is all-but-one-pass ([revise, pass, pass]) — the streak the convergence gate absorbs.
			return { output: kind === "craft" ? "VERDICT: revise" : "VERDICT: pass" }
		})
		const engine = new Engine({ store, runner, types: convergeTypes, config: makeConfig({ convergeAfter: 3, maxRedos: 20 }) })
		const root = await newProduction(store)

		for (let guard = 0; guard < 200; guard++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}

		expect((await store.getProduction(root.id))?.status).toBe("approved")
		const leaf = (await store.nodesFor(root.id)).find((n) => n.type === "leaf")!
		expect(leaf.status).toBe("approved") // converged — accepted though no version ever got a unanimous pass
		expect((await store.versionsFor(leaf.id)).length).toBe(3) // 3 near-pass rounds, then converge (not 20)
	})

	it("does NOT converge a weak leaf — more than one dissent resets the streak, and it escalates at the cap", async () => {
		const runner = new FakeSubagentRunner((input) => (input.skill?.startsWith("review:") ? { output: "VERDICT: revise" } : { output: "draft" }))
		const engine = new Engine({ store, runner, types: convergeTypes, config: makeConfig({ convergeAfter: 3, maxRedos: 4 }) })
		const root = await newProduction(store)

		for (let guard = 0; guard < 100; guard++) {
			const did = await engine.tick()
			const pending = await store.pendingOutputs(root.id)
			const leaf = (await store.nodesFor(root.id)).find((n) => n.type === "leaf")
			if (pending.some((o) => o.nodeId === leaf?.id)) break // escalated to the gate
			for (const o of pending) await gateApprove(store, o)
			if (!did && pending.length === 0) throw new Error("stuck")
		}

		const leaf = (await store.nodesFor(root.id)).find((n) => n.type === "leaf")!
		const versions = await store.versionsFor(leaf.id)
		expect(versions.length).toBe(4) // ground to the cap (never converged), then escalated
	})
})

// build as a nested sub-project: an EXPAND node whose checklist mixes leaves (assets, voice) with a
// PLANNER child (build-scenes) that itself fans out scenes. Verifies the recursive typed-project model
// runs a planner nested inside a non-root expand node, with deps across the sub-checklist.
const NESTED_BUILD_CONTRACTS: TypeContract[] = [
	{
		type: "video-project",
		name: "Video project",
		checklist: [
			{ id: "storyboard", type: "storyboard", deps: [] },
			{ id: "build", type: "build", deps: ["storyboard"] },
			{ id: "assemble", type: "assemble", deps: ["build"] },
		],
	},
	{ type: "storyboard", name: "Storyboard", produce: "board" },
	{
		type: "build",
		name: "Build",
		checklist: [
			{ id: "assets", type: "build-assets", deps: [] },
			{ id: "voice", type: "build-voice", deps: [] },
			{ id: "scenes", type: "build-scenes", deps: ["assets", "voice"] },
		],
	},
	{ type: "build-assets", name: "Build assets", produce: "assets" },
	{ type: "build-voice", name: "Build voice", produce: "voice" },
	{ type: "build-scenes", name: "Build scenes", planner: true, childType: "scene", skill: "plan-scenes", produce: "plan scenes" },
	{ type: "scene", name: "Scene", produce: "scene", reviews: [{ name: "craft", kind: "craft" }] },
	{ type: "assemble", name: "Assemble", produce: "assemble" },
]

describe("recursive build — a planner nested inside a non-root expand node", () => {
	it("expands build into asset/voice leaves + a scene planner, fans out scenes, rolls up build → root", async () => {
		const runner = new FakeSubagentRunner((input) => {
			if (input.skill === "plan-scenes") {
				return { output: '```json\n[{"name":"Hook","brief":"hook","method":"authored-continuous"},{"name":"CTA","brief":"cta","method":"authored-composite"}]\n```' }
			}
			if (input.skill?.startsWith("review:")) return { output: "VERDICT: pass" }
			return { output: `[stub ${input.skill}] draft` }
		})
		const engine = new Engine({ store, runner, types: TypeRegistry.fromContracts(NESTED_BUILD_CONTRACTS), config: makeConfig() })
		const root = await newProduction(store)

		for (let guard = 0; guard < 300; guard++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}

		expect((await store.getProduction(root.id))?.status).toBe("approved")
		const all = await store.nodesFor(root.id)
		const build = all.find((n) => n.type === "build")!
		const sub = all.filter((n) => n.parentId === build.id).map((n) => n.type).sort()
		expect(sub).toEqual(["build-assets", "build-scenes", "build-voice"]) // build expanded into its checklist
		const buildScenes = all.find((n) => n.type === "build-scenes")!
		const scenes = all.filter((n) => n.type === "scene")
		expect(scenes).toHaveLength(2) // the nested planner fanned out
		expect(scenes.every((s) => s.parentId === buildScenes.id)).toBe(true)
		expect(build.status).toBe("approved") // rolled up through the nested planner
	})
})

describe("file-leaf output contract (produces: file)", () => {
	// A produces:"file" leaf whose skill writes NO file (e.g. a keyless generative scene that can only
	// emit a spec) must record the skill's TEXT output as the artifact, not fail the whole production.
	it("records the skill's text when the leaf produces no file (keyless), instead of throwing", async () => {
		const C: TypeContract[] = [
			{
				type: "video-project",
				name: "VP",
				checklist: [
					{ id: "briefing", type: "briefing", deps: [] },
					{ id: "spec", type: "spec", deps: ["briefing"] },
					{ id: "final-review", type: "final-review", deps: ["spec"] },
				],
			},
			{ type: "briefing", name: "Briefing", produce: "brief", agreement: true, advisoryReview: true, reviews: [{ name: "coverage", kind: "coverage" }] },
			// produces:"file", but skill "generate-scene" — the fake only writes a file for "render-film",
			// so this leaf produces no file and must fall back to recording its text (the keyless path).
			{ type: "spec", name: "Spec", produces: "file", skill: "generate-scene", reviews: [{ name: "craft", kind: "craft" }] },
			{ type: "final-review", name: "Final review", holisticReview: true },
		]
		const t2 = TypeRegistry.fromContracts(C)
		const engine = new Engine({ store, runner: new FakeSubagentRunner(), types: t2, config: makeConfig() })
		const root = await newProduction(store)
		for (let guard = 0; guard < 200; guard++) {
			await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
		}
		expect((await store.getProduction(root.id))?.status).toBe("approved")
		const spec = (await store.nodesFor(root.id)).find((n) => n.type === "spec")!
		const v = await store.latestVersion(spec.id)
		expect(v?.artifactPath?.endsWith(".mp4")).toBeFalsy() // no file was produced
		expect(readFileSync(v!.artifactPath!, "utf8")).toContain("generate-scene") // the skill's text recorded
	})

	// The flow-closing wiring: assemble composes the production's approved scene clips. The engine
	// stages each approved scene's file-artifact into the assemble work dir, in order, so the skill
	// stitches them. Scenes render via the render-film fake (writes an .mp4); assemble collects them.
	it("stages each approved scene's clip into the assemble work dir in storyboard order", async () => {
		const C: TypeContract[] = [
			{
				type: "video-project",
				name: "VP",
				checklist: [
					{ id: "storyboard", type: "storyboard", deps: [] },
					{ id: "build", type: "build", deps: ["storyboard"] },
					{ id: "assemble", type: "assemble", deps: ["build"] },
				],
			},
			{ type: "storyboard", name: "Storyboard", produce: "board" },
			{ type: "build", name: "Build", checklist: [{ id: "scenes", type: "build-scenes", deps: [] }] },
			{ type: "build-scenes", name: "Build scenes", planner: true, childType: "scene", skill: "plan-scenes", produce: "plan" },
			// scenes render to a real clip (render-film fake writes an .mp4) so assemble has files to collect
			{ type: "scene", name: "Scene", produces: "file", skill: "render-film", reviews: [{ name: "craft", kind: "craft" }] },
			{ type: "assemble", name: "Assemble", produces: "file", skill: "assemble-scenes", collectArtifacts: { type: "scene", into: "scenes" } },
		]
		const runner = new FakeSubagentRunner((input) => {
			if (input.skill === "plan-scenes") return { output: '```json\n[{"name":"Hook","brief":"h","method":"authored-continuous"},{"name":"CTA","brief":"c","method":"authored-composite"}]\n```' }
			if (input.skill?.startsWith("review:")) return { output: "VERDICT: pass" }
			return { output: `[stub ${input.skill}] draft` }
		})
		const config = makeConfig()
		const engine = new Engine({ store, runner, types: TypeRegistry.fromContracts(C), config })
		const root = await newProduction(store)
		for (let guard = 0; guard < 300; guard++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}
		expect((await store.getProduction(root.id))?.status).toBe("approved")
		const assemble = (await store.nodesFor(root.id)).find((n) => n.type === "assemble")!
		const scenesDir = join(config.artifactsDir, root.id, `assemble-${assemble.id}-v1`, "scenes")
		expect(readdirSync(scenesDir).sort()).toEqual(["01-Hook.mp4", "02-CTA.mp4"])
	})
})

describe("root as capability — a production rooted at any type", () => {
	// A production is just a root node of some type. Rooting at a leaf capability (e.g. a one-shot sfx)
	// must run end to end: produce → review → approve → roll up, with no video-project wrapper.
	it("roots at a non-video-project leaf type and runs it to approved", async () => {
		const C: TypeContract[] = [{ type: "sfx", name: "SFX", produce: "a synthesized sound effect", reviews: [{ name: "quality", kind: "craft" }] }]
		const engine = new Engine({ store, runner: new FakeSubagentRunner(), types: TypeRegistry.fromContracts(C), config: makeConfig() })
		const root = await store.createProduction({ accountId: "acc_default", userId: "usr_default", brief: "a short whoosh", sessionId: "sess_1", autonomyLever: "medium", actorKind: "human", type: "sfx" })
		expect(root.type).toBe("sfx") // the root type is honored, not hardcoded video-project
		for (let guard = 0; guard < 50; guard++) {
			await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
		}
		expect((await store.getProduction(root.id))?.status).toBe("approved") // a leaf root rolls up to done
	})

	it("holds the production and asks when a required intake param is missing; proceeds once provided", async () => {
		const C: TypeContract[] = [{ type: "cap", name: "Capability", produce: "do the thing", rootCapable: true, inputs: [{ name: "topic", required: true, description: "the subject" }], reviews: [{ name: "quality", kind: "craft" }] }]
		const engine = new Engine({ store, runner: new FakeSubagentRunner(), types: TypeRegistry.fromContracts(C), config: makeConfig() })

		// A — required param absent: the engine asks and HOLDS (never starts producing)
		const a = await store.createProduction({ accountId: "acc_default", userId: "usr_default", brief: "", sessionId: "s", autonomyLever: "medium", actorKind: "human", type: "cap" })
		await engine.tick()
		const qs = (await store.pendingOutputs(a.id)).filter((o) => o.type === "question")
		expect(qs).toHaveLength(1)
		expect(qs[0]?.prompt).toContain("topic")
		expect((await store.getProduction(a.id))?.status).toBe("queued") // held, not producing
		await engine.tick() // a re-tick must not duplicate the question
		expect((await store.pendingOutputs(a.id)).filter((o) => o.type === "question")).toHaveLength(1)

		// B — param provided: runs to approved
		const b = await store.createProduction({ accountId: "acc_default", userId: "usr_default", brief: "", sessionId: "s", autonomyLever: "medium", actorKind: "human", type: "cap", params: { topic: "launch" } })
		for (let guard = 0; guard < 50; guard++) {
			await engine.tick()
			for (const o of await store.pendingOutputs(b.id)) await gateApprove(store, o)
			if ((await store.getProduction(b.id))?.status === "approved") break
		}
		expect((await store.getProduction(b.id))?.status).toBe("approved")
	})

	it("folds the native brief into params so a required brief input is satisfied (no intake question)", async () => {
		const C: TypeContract[] = [
			{ type: "video-project", name: "VP", rootCapable: true, inputs: [{ name: "brief", required: true }], checklist: [{ id: "leaf", type: "leaf", deps: [] }] },
			{ type: "leaf", name: "Leaf", produce: "x" },
		]
		const engine = new Engine({ store, runner: new FakeSubagentRunner(), types: TypeRegistry.fromContracts(C), config: makeConfig() })
		const root = await store.createProduction({ accountId: "acc_default", userId: "usr_default", brief: "a real brief", sessionId: "s", autonomyLever: "medium", actorKind: "human" })
		expect(root.params?.brief).toBe("a real brief") // seedParams folded the first-class brief in
		await engine.tick()
		expect((await store.pendingOutputs(root.id)).filter((o) => o.type === "question")).toHaveLength(0) // brief satisfied — not asked
	})

	it("does not spin runUntilIdle when a production is held for a missing required input", async () => {
		// Regression: a held-for-intake production must not report progress, or runUntilIdle never idles
		// and trips the tick safety valve every poll.
		const C: TypeContract[] = [{ type: "cap", name: "Cap", produce: "x", rootCapable: true, inputs: [{ name: "topic", required: true }] }]
		const engine = new Engine({ store, runner: new FakeSubagentRunner(), types: TypeRegistry.fromContracts(C), config: makeConfig() })
		await store.createProduction({ accountId: "acc_default", userId: "usr_default", brief: "", sessionId: "s", autonomyLever: "medium", actorKind: "human", type: "cap" }) // no topic → held
		await expect(engine.runUntilIdle()).resolves.toBeUndefined() // terminates (idles), never throws the safety valve
	})

	it("flags exactly the root-capable capabilities, not the internal plumbing", async () => {
		const disk = TypeRegistry.load(new URL("../types", import.meta.url).pathname)
		for (const t of ["video-project", "scene", "clip", "card"]) {
			expect(disk.get(t).rootCapable).toBe(true)
			expect((disk.get(t).inputs ?? []).some((i) => i.required)).toBe(true) // each declares at least one required param
		}
		for (const t of ["briefing", "moodboard", "storyboard", "build", "build-scenes", "assemble", "polish", "final-review"]) {
			expect(disk.get(t).rootCapable ?? false).toBe(false) // plumbing is never offerable as a standalone root
		}
	})

	it("video-project declares the Phase-1 brief property set as inputs", async () => {
		const disk = TypeRegistry.load(new URL("../types", import.meta.url).pathname)
		const names = (disk.get("video-project").inputs ?? []).map((i) => i.name)
		for (const p of ["brief", "goal", "audience", "structure", "aspect", "cta-intent", "proof-intent"]) {
			expect(names).toContain(p)
		}
		expect(disk.get("video-project").inputs?.find((i) => i.name === "brief")?.required).toBe(true)
	})
})

describe("expand is idempotent — a re-routed checklist node does not duplicate its children", () => {
	it("does not create a second child set when a checklist node is expanded again", async () => {
		const engine = new Engine({ store, runner: new FakeSubagentRunner(), types, config: makeConfig() })
		const root = await newProduction(store)

		// First tick: startQueuedProductions expands the root into its checklist children.
		await engine.tick()
		const vp = CONTRACTS.find((c) => c.type === "video-project")!
		const checklistLen = vp.checklist!.length
		const after1 = (await store.nodesFor(root.productionId)).filter((n) => n.parentId === root.id)
		expect(after1.length).toBe(checklistLen)

		// A worker restart / a critic REOPEN naming the root / a manual orphan reset all route the root
		// back through dispatch as a claimable node. Re-expanding MUST NOT create a second child set.
		await store.updateNodeStatus(root.id, "pending")
		await engine.tick() // claims the root → dispatch → checklist → expandNode

		const after2 = (await store.nodesFor(root.productionId)).filter((n) => n.parentId === root.id)
		expect(after2.length).toBe(checklistLen) // no duplicates
		expect((await store.getProduction(root.id))!.status).toBe("in-progress") // re-expand leaves it producing
	})
})

describe("the loop never claims work for a cancelled production", () => {
	it("claimReadyNode skips a ready node whose production root is cancelled, even deep in the tree", async () => {
		const root = await newProduction(store)
		await store.updateNodeStatus(root.id, "in-progress")
		// A mid node still in-progress, with a ready (pending, no-dep) grandchild under it. This is the
		// case the parent-active readiness check does NOT catch: the shot's immediate parent (the scene)
		// stays in-progress when only the root is cancelled, so without the production-root guard the deep
		// shot would still be claimed.
		const [scene] = await store.createChildNodes(root.id, [{ type: "scene", name: "Scene 1" }])
		await store.updateNodeStatus(scene!.id, "in-progress")
		const [shot] = await store.createChildNodes(scene!.id, [{ type: "shot", name: "Shot 1" }])

		// Active production: the deep ready shot is claimable.
		const claimed = await store.claimReadyNode()
		expect(claimed?.id).toBe(shot!.id)
		await store.updateNodeStatus(shot!.id, "pending") // undo the claim for the cancelled case

		// Cancel the production. The scene is still in-progress, so only the production-root guard stops
		// the shot being picked up.
		await store.updateNodeStatus(root.id, "cancelled")
		expect(await store.claimReadyNode()).toBeNull()
	})
})

describe("per-type subagent overrides — model + maxBudgetUsd flow to the node's producer and reviewers", () => {
	it("passes a type's model/maxBudgetUsd on every subagent call for its node, and leaves them unset for a type that declares none", async () => {
		// script declares overrides; moodboard declares none. Distinct reviewer kinds so the two nodes'
		// reviewer calls are tellable apart from the SubagentInput alone (which carries no node id).
		const C: TypeContract[] = [
			{ type: "video-project", name: "VP", checklist: [{ id: "script", type: "script", deps: [] }, { id: "moodboard", type: "moodboard", deps: [] }] },
			{ type: "script", name: "Script", produce: "script", model: "opus", maxBudgetUsd: 2, reviews: [{ name: "coverage", kind: "coverage" }] },
			{ type: "moodboard", name: "Moodboard", produce: "mood", reviews: [{ name: "craft", kind: "craft" }] },
		]
		const runner = new FakeSubagentRunner()
		const engine = new Engine({ store, runner, types: TypeRegistry.fromContracts(C), config: makeConfig() })
		const root = await newProduction(store)

		for (let guard = 0; guard < 200; guard++) {
			const did = await engine.tick()
			const pending = await store.pendingOutputs(root.id)
			for (const o of pending) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && pending.length === 0) throw new Error("stuck before done")
		}

		const call = (skill: string) => runner.calls.find((c) => c.skill === skill)
		// script's node (producer + its coverage reviewer) carries the type's overrides
		expect(call("script")).toMatchObject({ model: "opus", maxBudgetUsd: 2 })
		expect(call("review:coverage")).toMatchObject({ model: "opus", maxBudgetUsd: 2 })
		// moodboard declares none → the loop leaves them unset (the runner applies the env default)
		expect(call("moodboard")?.model).toBeUndefined()
		expect(call("moodboard")?.maxBudgetUsd).toBeUndefined()
		expect(call("review:craft")?.model).toBeUndefined()
		expect(call("review:craft")?.maxBudgetUsd).toBeUndefined()
	})
})

describe("per-type subagent engine — a type pins a backend; the loop routes its node there", () => {
	it("routes a node whose type pins an engine to that runner (producer + reviewers), others to the default", async () => {
		const C: TypeContract[] = [
			{ type: "video-project", name: "VP", checklist: [{ id: "script", type: "script", deps: [] }, { id: "moodboard", type: "moodboard", deps: [] }] },
			{ type: "script", name: "Script", produce: "script", engine: "alt", reviews: [{ name: "coverage", kind: "coverage" }] },
			{ type: "moodboard", name: "Moodboard", produce: "mood", reviews: [{ name: "craft", kind: "craft" }] },
		]
		const base = new FakeSubagentRunner()
		const altCalls: SubagentInput[] = []
		const alt: SubagentRunner = {
			engine: "alt",
			async run(input: SubagentInput): Promise<SubagentResult> {
				altCalls.push(input)
				const pass = /^review[:-]/.test(input.skill ?? "")
				return { output: pass ? "VERDICT: pass" : "a draft", sessionId: "alt-1", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }
			},
		}
		const engine = new Engine({ store, runner: base, runners: new Map([["alt", alt]]), types: TypeRegistry.fromContracts(C), config: makeConfig() })
		const root = await newProduction(store)

		for (let guard = 0; guard < 200; guard++) {
			const did = await engine.tick()
			const pending = await store.pendingOutputs(root.id)
			for (const o of pending) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && pending.length === 0) throw new Error("stuck before done")
		}

		// the script node (producer + its coverage reviewer) ran on the pinned "alt" backend
		expect(altCalls.map((c) => c.skill).sort()).toEqual(["review:coverage", "script"])
		// moodboard ran on the default runner; script never touched it
		expect(base.calls.some((c) => c.skill === "moodboard")).toBe(true)
		expect(base.calls.some((c) => c.skill === "script")).toBe(false)
		// the interaction log records the per-node engine, not the default
		const ints = await store.interactionsFor(root.id)
		expect(ints.filter((i) => i.engine === "alt").map((i) => i.role).sort()).toEqual(["producer", "review:coverage"])
	})

	it("throws a clear error when a type pins an engine with no registered runner", async () => {
		const C: TypeContract[] = [
			{ type: "video-project", name: "VP", checklist: [{ id: "script", type: "script", deps: [] }] },
			{ type: "script", name: "Script", produce: "script", engine: "nope" },
		]
		const engine = new Engine({ store, runner: new FakeSubagentRunner(), types: TypeRegistry.fromContracts(C), config: makeConfig() })
		await newProduction(store)
		await expect(
			(async () => {
				for (let guard = 0; guard < 10; guard++) await engine.tick()
			})(),
		).rejects.toThrow(/pins subagent engine "nope"/)
	})
})

describe("0001 — a dispatch that throws must not strand the node", () => {
	class ThrowingRunner implements SubagentRunner {
		engine = "fake"
		async run(): Promise<SubagentResult> {
			throw new Error("boom: producer crashed")
		}
	}

	it("retries a throwing dispatch then fails the production instead of hanging in-progress", async () => {
		const engine = new Engine({ store, runner: new ThrowingRunner(), types, config: makeConfig() })
		const root = await newProduction(store)

		// tick must never throw, and the production must reach a terminal state (not spin forever).
		let reachedTerminal = false
		for (let guard = 0; guard < 30; guard++) {
			await engine.tick() // must NOT throw out of the loop
			const r = await store.getProduction(root.id)
			if (r?.status === "failed") {
				reachedTerminal = true
				break
			}
		}

		expect(reachedTerminal).toBe(true)
		// the production is retired, not stuck
		expect((await store.getProduction(root.id))?.status).toBe("failed")
		// the node that kept throwing is marked failed, never left in-progress
		const briefing = (await store.nodesFor(root.id)).find((n) => n.type === "briefing")
		expect(briefing?.status).toBe("failed")
		// the client is told the production died (not a silent hang)
		const outs = await store.pendingOutputs(root.id)
		expect(outs.some((o) => o.type === "notify")).toBe(true)
	})
})

describe("0009 — a per-subagent wall-clock watchdog aborts a runaway produce", () => {
	class HangingRunner implements SubagentRunner {
		engine = "fake"
		aborted = false
		run(input: SubagentInput): Promise<SubagentResult> {
			return new Promise<SubagentResult>((_resolve, reject) => {
				input.signal?.addEventListener("abort", () => {
					this.aborted = true
					reject(new Error("aborted by watchdog"))
				})
				// otherwise never resolves — simulates a produce that does not terminate
			})
		}
	}

	it("aborts a call that exceeds subagentTimeoutMs and fails the production instead of hanging", async () => {
		const runner = new HangingRunner()
		const engine = new Engine({ store, runner, types, config: makeConfig({ subagentTimeoutMs: 20 }) })
		const root = await newProduction(store)

		for (let guard = 0; guard < 40; guard++) {
			await engine.tick()
			if ((await store.getProduction(root.id))?.status === "failed") break
		}

		expect(runner.aborted).toBe(true) // the watchdog aborted the hung call (did not wait on it forever)
		expect((await store.getProduction(root.id))?.status).toBe("failed") // retried then failed, not hung
	}, 4000)
})

describe("0010 — high autonomy auto-approves leaf gates but keeps final-review human", () => {
	it("walks the whole pipeline with NO human approvals, then stops only at the final-review gate", async () => {
		const engine = new Engine({ store, runner: new FakeSubagentRunner(), types, config: makeConfig() })
		const root = await store.createProduction({
			accountId: "acc_default",
			userId: "usr_default",
			brief: "a 15s promo about X",
			sessionId: "sess_1",
			autonomyLever: "high",
			actorKind: "agent",
		})

		// Deliberately approve NOTHING. On high the engine must auto-approve every leaf gate and advance
		// on its own, until it reaches the one hard human gate (final-review), where it stops.
		for (let guard = 0; guard < 200; guard++) {
			if (!(await engine.tick())) break
		}

		const all = await store.nodesFor(root.id)
		// every produced leaf except final-review auto-approved without a human present
		for (const n of all) {
			if (n.parentId !== null && n.type !== "final-review") expect(n.status).toBe("approved")
		}
		// final-review is the sole gate: it presented and is holding for a human
		const fr = all.find((n) => n.type === "final-review")
		expect(fr?.status).toBe("needs-presentation")
		const outs = await store.pendingOutputs(root.id)
		expect(outs.length).toBe(1)
		expect(outs[0]?.type).toBe("present")
		expect(outs[0]?.nodeId).toBe(fr?.id)
	})
})

describe("0019 — independent fan-out leaves dispatch concurrently with maxParallel > 1", () => {
	it("runs sibling leaves in parallel within one worker (peak in-flight > 1)", async () => {
		let inFlight = 0
		let peak = 0
		const runner = new FakeSubagentRunner(async () => {
			inFlight++
			peak = Math.max(peak, inFlight)
			await new Promise((r) => setTimeout(r, 5))
			inFlight--
			return { output: "draft" }
		})
		const T = TypeRegistry.fromContracts([
			{
				type: "video-project",
				name: "Root",
				checklist: [
					{ id: "a", type: "leaf", deps: [] },
					{ id: "b", type: "leaf", deps: [] },
					{ id: "c", type: "leaf", deps: [] },
				],
			},
			{ type: "leaf", name: "Leaf", produce: "make it" }, // no reviewers → auto-present
		])
		const engine = new Engine({ store, runner, types: T, config: makeConfig({ maxParallel: 3 }) })
		const root = await newProduction(store)
		for (let g = 0; g < 50; g++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}
		expect((await store.getProduction(root.id))?.status).toBe("approved")
		expect(peak).toBeGreaterThanOrEqual(2) // the three independent leaves overlapped in-flight — not serialized one-per-tick
	})
})

describe("0020 — no-progress escape: a repeated unfixable finding escalates instead of grinding to the cap", () => {
	it("escalates early when the same finding repeats, not at MAX_REDOS", async () => {
		const runner = new FakeSubagentRunner((input) =>
			input.skill?.startsWith("review:")
				? { output: "VERDICT: revise — the licensed font is not staged in plates/fonts; this node cannot add it" }
				: { output: "draft" },
		)
		const T = TypeRegistry.fromContracts([
			{ type: "video-project", name: "Root", checklist: [{ id: "leaf", type: "leaf", deps: [] }] },
			{ type: "leaf", name: "Leaf", produce: "make it", reviews: [{ name: "q", kind: "craft" }] },
		])
		const engine = new Engine({ store, runner, types: T, config: makeConfig({ noProgressAfter: 2, maxRedos: 10 }) })
		const root = await newProduction(store)
		for (let g = 0; g < 100; g++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}
		const leaf = (await store.nodesFor(root.id)).find((n) => n.type === "leaf")!
		expect(leaf.status).toBe("approved") // escalated-presented at the no-progress threshold, then approved by the gate
		expect((await store.versionsFor(leaf.id)).length).toBe(2) // v1, v2 → escalated at v2, NOT ground to maxRedos=10
	})
})

describe("0027 — per-node model diversity across a diverseChildren planner's fan-out", () => {
	it("rotates fanoutModelMix across the children; each child's producer runs on its assigned model", async () => {
		const runner = new FakeSubagentRunner((input) => {
			if (input.skill === "brainstorm") return { output: '```json\n[{"name":"A","brief":"AAA"},{"name":"B","brief":"BBB"},{"name":"C","brief":"CCC"}]\n```' }
			if (input.skill?.startsWith("review:")) return { output: "VERDICT: pass" }
			return { output: `draft ${input.skill}` }
		})
		const T = TypeRegistry.fromContracts([
			{ type: "video-project", name: "Root", checklist: [{ id: "brainstorm", type: "brainstorm", deps: [] }] },
			{ type: "brainstorm", name: "Brainstorm", planner: true, childType: "idea", diverseChildren: true, skill: "brainstorm" },
			{ type: "idea", name: "Idea", skill: "idea", produce: "develop" }, // no reviewers → auto-present
		])
		const engine = new Engine({ store, runner, types: T, config: makeConfig({ fanoutModelMix: ["model-A", "model-B", "model-C"] }) })
		const root = await newProduction(store)
		for (let g = 0; g < 200; g++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}
		const ideas = (await store.nodesFor(root.id)).filter((n) => n.type === "idea").sort((a, b) => a.position - b.position)
		expect(ideas).toHaveLength(3)
		expect(ideas.map((i) => i.model)).toEqual(["model-A", "model-B", "model-C"]) // mix rotated across the fan-out
		// each idea producer ran on ITS assigned model (node.model threaded into the subagent call)
		const ideaModels = runner.calls.filter((c) => c.skill === "idea").map((c) => c.model).sort()
		expect(ideaModels).toEqual(["model-A", "model-B", "model-C"])
	})

	it("leaves children's model undefined when the planner is not diverseChildren (unchanged behaviour)", async () => {
		const runner = new FakeSubagentRunner((input) => {
			if (input.skill === "brainstorm") return { output: '```json\n[{"name":"A","brief":"AAA"},{"name":"B","brief":"BBB"}]\n```' }
			if (input.skill?.startsWith("review:")) return { output: "VERDICT: pass" }
			return { output: `draft ${input.skill}` }
		})
		const T = TypeRegistry.fromContracts([
			{ type: "video-project", name: "Root", checklist: [{ id: "brainstorm", type: "brainstorm", deps: [] }] },
			{ type: "brainstorm", name: "Brainstorm", planner: true, childType: "idea", skill: "brainstorm" }, // no diverseChildren
			{ type: "idea", name: "Idea", skill: "idea", produce: "develop" },
		])
		const engine = new Engine({ store, runner, types: T, config: makeConfig({ fanoutModelMix: ["model-A", "model-B"] }) })
		const root = await newProduction(store)
		for (let g = 0; g < 200; g++) {
			const did = await engine.tick()
			for (const o of await store.pendingOutputs(root.id)) await gateApprove(store, o)
			if ((await store.getProduction(root.id))?.status === "approved") break
			if (!did && (await store.pendingOutputs(root.id)).length === 0) throw new Error("stuck before done")
		}
		const ideas = (await store.nodesFor(root.id)).filter((n) => n.type === "idea")
		expect(ideas.every((i) => i.model === null)).toBe(true) // no mix applied → inherit the type's model
	})
})
