// Engine loop tests — full pipeline on FakeStore + FakeSubagentRunner, no DB, no claude -p. The
// tests drive the human gate (approve/feedback) between ticks, like the client would.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
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
		for (const t of ["briefing", "script", "moodboard", "storyboard", "render", "polish", "final-review"]) {
			expect(disk.has(t)).toBe(true)
		}
		expect(disk.get("render").produces).toBe("file")
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
		// the composed board fan-out: storyboard(planner) → card[] → assemble-board, then build realizes
		const cb = disk.get("video-project").checklist?.map((e) => e.type) ?? []
		expect(cb).toEqual(expect.arrayContaining(["storyboard", "assemble-board", "build"]))
		expect(disk.get("video-project").checklist?.find((e) => e.type === "assemble-board")?.deps).toContain("storyboard")
		expect(disk.get("video-project").checklist?.find((e) => e.type === "build")?.deps).toEqual(["assemble-board"])
		// every step owns its reviewer rubric (no generic lenses): moodboard gets the pair, polish +
		// briefing their single axis. moodboard's conformance axis is what lets revalidation keep it.
		expect(disk.get("moodboard").reviews?.map((r) => r.skill)).toEqual(
			expect.arrayContaining(["review-moodboard-quality", "review-moodboard-conformance"]),
		)
		expect(disk.get("polish").reviews?.[0]?.skill).toBe("review-polish-quality")
		expect(disk.get("briefing").reviews?.[0]?.skill).toBe("review-briefing-coverage")
		// render's consistency gate is an owned pixel-watch (faithful execution of the board)
		expect(disk.get("render").reviews?.find((r) => r.kind === "consistency")?.skill).toBe("review-render-consistency")
		// render also carries a deterministic audio/sync gate (VO matches script, no dup/dropped lines, in sync)
		expect(disk.get("render").reviews?.find((r) => r.kind === "audio")?.skill).toBe("review-render-audio")
		// the unified video-project ends build → assemble → polish → final-review (the scene fan-out tail;
		// the monolithic render node is retired from the pipeline)
		const vp = disk.get("video-project").checklist?.map((e) => e.type) ?? []
		expect(vp).not.toContain("render")
		expect(vp.slice(-4)).toEqual(["build", "assemble", "polish", "final-review"])
		expect(disk.get("video-project").checklist?.find((e) => e.type === "final-review")?.deps).toEqual(["polish"])
	})

	it("wires research + brainstorm as real chain steps before the script", async () => {
		const disk = TypeRegistry.load(new URL("../types", import.meta.url).pathname)
		for (const t of ["research", "brainstorm", "idea", "brainstorm-select"]) expect(disk.has(t)).toBe(true)
		// brainstorm is a planner that fans out idea agents and exposes them to its dependents (the judge)
		expect(disk.get("brainstorm").planner).toBe(true)
		expect(disk.get("brainstorm").childType).toBe("idea")
		expect(disk.get("brainstorm").exposeChildrenToDependents).toBe(true)
		// the chain: briefing → research → brainstorm → brainstorm-select → script, and script no longer
		// hangs straight off briefing (it writes from the winning concept + the dossier)
		const chain = disk.get("video-project").checklist ?? []
		const byId = new Map(chain.map((e) => [e.id, e]))
		expect(chain.map((e) => e.type).slice(0, 5)).toEqual(["briefing", "research", "brainstorm", "brainstorm-select", "script"])
		expect(byId.get("research")?.deps).toEqual(["briefing"])
		expect(byId.get("brainstorm")?.deps).toEqual(["briefing", "research"])
		expect(byId.get("brainstorm-select")?.deps).toEqual(["brainstorm"])
		expect(byId.get("script")?.deps).toEqual(["brainstorm-select", "research"])
	})

	it("loads the unified scene pipeline (build → scene → assemble)", async () => {
		const disk = TypeRegistry.load(new URL("../types", import.meta.url).pathname)
		// the scene fan-out is now video-project's own tail — the separate generative project type is gone
		expect(disk.has("video-project-generative")).toBe(false)
		const vp = disk.get("video-project").checklist?.map((e) => e.type) ?? []
		expect(vp).toEqual(expect.arrayContaining(["storyboard", "build", "assemble"]))
		// build is a sub-project: it expands into asset/voice/soundtrack leaves + the scene planner
		const buildSub = disk.get("build").checklist?.map((e) => e.type) ?? []
		expect(buildSub).toEqual(expect.arrayContaining(["build-assets", "build-voice", "build-soundtrack", "build-scenes"]))
		// build-scenes is the planner that fans out one scene child per storyboard scene
		expect(disk.get("build-scenes").planner).toBe(true)
		expect(disk.get("build-scenes").childType).toBe("scene")
		// assembly is its own rendered step (concatenates scene clips), not a monolithic render
		expect(disk.get("assemble").produces).toBe("file")
		expect(disk.get("assemble").skill).toBe("assemble-scenes")
		// a scene is reviewed on all three axes — quality, conformance, and the consistency gate
		expect(disk.get("scene").reviews?.map((r) => r.skill)).toEqual(
			expect.arrayContaining(["review-scene-quality", "review-scene-conformance", "review-scene-consistency"]),
		)
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

// Convergence: 3 reviewers can oscillate (each round a different one dissents) and never all pass a
// genuinely good leaf. After convergeAfter consecutive all-but-one-pass rounds, the gate accepts it
// instead of grinding to the redo cap. A weak leaf (more than one dissent) never sustains the streak.
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
		let round = 0
		const runner = new FakeSubagentRunner((input) => {
			if (!input.skill?.startsWith("review:")) {
				round++
				return { output: "draft" }
			}
			const kind = input.skill.slice("review:".length)
			const dissenter = ["craft", "coverage", "consistency"][(round - 1) % 3] // rotate the single dissenter each round
			return { output: kind === dissenter ? "VERDICT: revise" : "VERDICT: pass" }
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
})
