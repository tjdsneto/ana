// The engine loop — what the worker runs. It produces, reviews internally, and marks the data; it
// never presents and never approves (the client does, via chat_input). Derived from spec 02.
//
// One tick: start any queued productions (expand the root), roll up any node whose children are all
// approved, then claim one ready node and run a single dispatch step. A node dispatches by type:
// expand (static checklist children), plan (dynamic fan-out), holistic review, or leaf (produce an
// artifact). Completion rolls up by approval from leaves to the root, at any depth.

import { createHash, randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { NoopLogger } from "@core/shared"
import type { InteractionRole, Logger, Node, Store, SubagentInput, SubagentResult, SubagentRunner, Version } from "@core/shared"
import type { EngineConfig } from "./config.js"
import { buildHolisticPrompt, buildPlannerPrompt, buildProducerPrompt, buildReviewerPrompt, parsePlan, parseReopen, parseVerdict, type ReopenTarget, type UpstreamArtifact } from "./prompts.js"
import type { TypeContract, TypeRegistry } from "./typereg.js"

const MAX_TICKS_PER_DRAIN = 10_000 // safety valve; redo caps bound real work well below this

export interface EngineDeps {
	store: Store
	runner: SubagentRunner
	types: TypeRegistry
	config: EngineConfig
	logger?: Logger // default: quiet (NoopLogger). Entrypoints inject a JsonLogger.
}

export class Engine {
	private readonly store: Store
	private readonly runner: SubagentRunner
	private readonly types: TypeRegistry
	private readonly config: EngineConfig
	private readonly log: Logger
	private realCalls = 0 // real (non-fake) subagent calls made this process — the spend-guard counter
	private parkedWarned = false // so the park guard logs once, not on every poll wake-up
	private readonly globalRevisions = new Map<string, number>() // productionId → holistic-reopen passes used (per-process; v0 single worker)

	constructor(deps: EngineDeps) {
		this.store = deps.store
		this.runner = deps.runner
		this.types = deps.types
		this.config = deps.config
		this.log = deps.logger ?? new NoopLogger()
	}

	// One unit of work. Returns whether anything advanced (false = idle: nothing queued/ready and
	// nothing to roll up — the loop is waiting on the human gate or genuinely done).
	async tick(): Promise<boolean> {
		// Spend guard: once the worker has made its budget of real subagent calls this process, stop
		// claiming new work and park idle (the in-flight leaf already finished). Protects against a
		// worker draining a backlog of stale queued nodes on a retained volume. fake calls never count.
		if (this.callBudgetSpent()) {
			if (!this.parkedWarned) {
				this.log.warn("worker.parked_budget", { realCalls: this.realCalls, maxSubagentCalls: this.config.maxSubagentCalls })
				this.parkedWarned = true
			}
			return false
		}
		const started = await this.startQueuedProductions()
		const rolled = await this.rollupNodes()
		const node = await this.store.claimReadyNode()
		if (node) {
			await this.dispatch(node)
			return true
		}
		return started || rolled
	}

	private callBudgetSpent(): boolean {
		return this.config.maxSubagentCalls !== undefined && this.realCalls >= this.config.maxSubagentCalls
	}

	// Single seam for every subagent call, so the real-spend counter can never be bypassed. fake is
	// free, so it does not count against the budget.
	private async runSubagent(input: SubagentInput): Promise<SubagentResult> {
		const result = await this.runner.run(input)
		if (this.runner.engine !== "fake") this.realCalls++
		return result
	}

	// Drain all currently-actionable work (stops when idle). The live worker calls this each wake-up;
	// tests call tick() directly so they can drive the gate between steps.
	async runUntilIdle(): Promise<void> {
		for (let i = 0; i < MAX_TICKS_PER_DRAIN; i++) {
			if (!(await this.tick())) return
		}
		throw new Error("engine: runUntilIdle exceeded the tick safety valve — likely a non-terminating loop")
	}

	// ── queued → producing (expand the root's static checklist into leaf children) ────────────────

	private async startQueuedProductions(): Promise<boolean> {
		const queued = (await this.store.listProductions()).filter((r) => r.status === "queued")
		for (const root of queued) await this.expandNode(root)
		return queued.length > 0
	}

	// Expand a node's static checklist into child nodes (the root at startup, or any claimed node whose
	// type declares a checklist — e.g. a scene fanning into shots). Children's deps are resolved within
	// the checklist. The node goes in-progress and rolls up when its children are approved.
	private async expandNode(node: Node): Promise<void> {
		const contract = this.types.get(node.type)
		if (!contract.checklist || contract.checklist.length === 0) {
			throw new Error(`expandNode: type "${node.type}" has no checklist to expand`)
		}
		const idByKey = new Map<string, string>() // checklist-local key → created node id
		let position = 0
		for (const entry of contract.checklist) {
			const deps = (entry.deps ?? []).map((k) => {
				const id = idByKey.get(k)
				if (!id) throw new Error(`expandNode: dep "${k}" referenced before it was declared`)
				return id
			})
			const name = this.types.has(entry.type) ? (this.types.get(entry.type).name ?? entry.type) : entry.type
			const [child] = await this.store.createChildNodes(node.id, [{ type: entry.type, name, deps, position }])
			if (!child) throw new Error("expandNode: createChildNodes returned no row")
			idByKey.set(entry.id, child.id)
			position++
		}
		await this.store.updateNodeStatus(node.id, "in-progress")
		this.log.info(node.parentId === null ? "production.start" : "node.expand", {
			productionId: node.productionId,
			nodeId: node.id,
			children: contract.checklist.length,
		})
	}

	// ── children all approved → parent approved, at any depth (root rolling up = production done) ────

	private async rollupNodes(): Promise<boolean> {
		let rolled = false
		for (const root of (await this.store.listProductions()).filter((r) => r.status === "in-progress")) {
			const tree = await this.store.nodesFor(root.productionId)
			const childrenOf = new Map<string, Node[]>()
			for (const n of tree) {
				if (!n.parentId) continue
				const arr = childrenOf.get(n.parentId) ?? []
				arr.push(n)
				childrenOf.set(n.parentId, arr)
			}
			// Approve any in-progress node whose children are all approved. Leaves (no children) are
			// approved by the leaf/gate path, not here. A node and its parent can both become approvable
			// against this one snapshot; the parent then approves on a later tick — the loop keeps ticking
			// while anything rolled, so the tree converges bottom-up.
			for (const n of tree) {
				if (n.status !== "in-progress") continue
				const kids = childrenOf.get(n.id)
				if (!kids || kids.length === 0) continue
				// a skipped child (dropped by a re-plan) counts as settled, not blocking
				if (kids.every((c) => c.status === "approved" || c.status === "skipped")) {
					await this.store.updateNodeStatus(n.id, "approved")
					this.log.info(n.parentId === null ? "production.done" : "node.rollup", { productionId: root.productionId, nodeId: n.id, type: n.type })
					rolled = true
				}
			}
		}
		return rolled
	}

	// ── dispatch one ready node ────────────────────────────────────────────────────────────────────

	private async dispatch(node: Node): Promise<void> {
		const contract = this.types.get(node.type)
		// A node reopened as a cascade dependent is STALE: revalidate before anything else. If it still
		// holds, revalidate approves it in place and we're done; if the upstream change broke it, we fall
		// through to the normal produce path below and rebuild it.
		const latest = await this.store.latestVersion(node.id)
		if (latest?.status === "stale" && (await this.revalidate(node, contract, latest))) return
		if (contract.checklist) {
			await this.expandNode(node)
			return
		}
		if (contract.planner) {
			await this.dispatchPlan(node, contract)
			return
		}
		if (contract.router) throw new Error(`dispatch: router "${node.type}" not supported yet`)
		if (contract.holisticReview) {
			await this.dispatchHolisticReview(node, contract)
			return
		}
		await this.dispatchLeaf(node, contract)
	}

	// Plan dispatch (dynamic fan-out): a planner node runs a planner subagent over its approved upstream,
	// which returns the independent units to produce as a generic {name, brief} list. The engine creates
	// one child of childType per unit — children inherit this node's deps (so they see the same upstream
	// and are immediately ready) and carry their unit spec in `description`. The node stays in-progress
	// and rolls up when every child is approved. The engine never parses the upstream's own schema; the
	// planner skill does. (Reopen later re-runs this node, re-planning against the revised upstream.)
	private async dispatchPlan(node: Node, contract: TypeContract): Promise<void> {
		const root = await this.store.getProduction(node.productionId)
		if (!root) throw new Error(`dispatchPlan: production ${node.productionId} missing`)
		if (!contract.childType) throw new Error(`dispatchPlan: planner "${node.type}" declares no childType to fan out`)
		const log = this.log.child({ productionId: node.productionId, nodeId: node.id, type: node.type })
		log.info("node.dispatch")

		const upstream = await this.collectUpstream(node)
		const priorVersions = await this.store.versionsFor(node.id)
		const latest = priorVersions.at(-1)
		const n = (latest?.n ?? 0) + 1

		const t0 = Date.now()
		const plannerPrompt = buildPlannerPrompt(contract, { brief: root.description ?? "", upstream })
		const result = await this.runSubagent({
			prompt: plannerPrompt,
			skill: contract.skill ?? node.type,
			cwd: this.config.craftRoot,
			resumeSessionId: latest?.subagent?.sessionId,
		})
		const planned = parsePlan(result.output)
		if (planned.length === 0) throw new Error(`dispatchPlan: planner "${node.type}" returned no children — ${result.output.slice(0, 200)}`)

		// Record the plan as a version (the fan-out decision is auditable); its children carry the gate,
		// so the plan version is accepted on fan-out rather than reviewed.
		const artifactPath = writeArtifact(this.config.artifactsDir, node.productionId, node.type, n, result.output)
		const version = await this.store.createVersion({
			nodeId: node.id,
			n,
			prevVersionId: latest?.id,
			status: "approved",
			artifactPath,
			builtFrom: await this.computeBuiltFrom(node),
			subagent: { runId: randomUUID(), status: "done", sessionId: result.sessionId, engine: this.runner.engine, model: result.model },
		})
		await this.logInteraction(node, version.id, "producer", result, Date.now() - t0, plannerPrompt)

		const childType = contract.childType
		const childName = this.types.has(childType) ? (this.types.get(childType).name ?? childType) : childType
		await this.store.createChildNodes(
			node.id,
			planned.map((c, i) => ({ type: childType, name: c.name || `${childName} ${i + 1}`, description: c.brief, deps: node.deps, position: i })),
		)
		await this.store.updateNodeStatus(node.id, "in-progress")
		log.info("node.plan", { versionId: version.id, children: planned.length })
	}

	// Artifact filename base for a node. Fanned-out children of a planner share a type, so a
	// type-keyed filename (`idea-v1.md`) would make siblings clobber one another (and race, since they
	// run in parallel). Give each fanned child a node-scoped name so its artifact is its own.
	private async artifactBase(node: Node): Promise<string> {
		if (node.parentId) {
			const parent = (await this.store.nodesFor(node.productionId)).find((s) => s.id === node.parentId)
			if (parent && this.types.has(parent.type) && this.types.get(parent.type).planner) {
				return `${node.type}-${node.id.slice(-6)}`
			}
		}
		return node.type
	}

	// The leaf path: produce → specialist reviewer set → gate. A failing review redoes (fed the
	// reviewers' feedback) up to maxRedos, then escalates. Agreement leaves (briefing) never block on
	// review; they present and loop on human feedback, capped by actor_kind (spec 02).
	private async dispatchLeaf(node: Node, contract: TypeContract): Promise<void> {
		const root = await this.store.getProduction(node.productionId)
		if (!root) throw new Error(`dispatchLeaf: production ${node.productionId} missing`)
		const log = this.log.child({ productionId: node.productionId, nodeId: node.id, type: node.type })
		log.info("node.dispatch")

		const priorVersions = await this.store.versionsFor(node.id)
		const latest = priorVersions.at(-1)
		const n = (latest?.n ?? 0) + 1

		// revision context: user feedback (denied) or the failing reviewers' union (needs-work)
		let priorContent: string | undefined
		let feedback: string | undefined
		if (latest) {
			priorContent = readArtifact(latest.artifactPath)
			if (latest.status === "denied") {
				feedback = latest.feedback ?? undefined
			} else if (latest.status === "needs-work") {
				const reviews = await this.store.reviewsFor(latest.id)
				feedback = reviews.filter((r) => r.verdict === "revise").map((r) => r.body ?? "").filter(Boolean).join("\n\n") || undefined
			}
		}

		const upstream = await this.collectUpstream(node)

		// produce — always via a subagent: a rendered leaf runs the render-film skill (which owns its
		// own TTS/ffmpeg tools and writes the .mp4), every other leaf runs its producer skill. A redo
		// does NOT resume the prior provider session: the producer prompt already carries the prior
		// draft + the reviewers' feedback, and resuming a stale session meant an edited skill never
		// reached a redo and the producer re-emitted its old output instead of acting on the feedback
		// (the "resume trap"). Each produce runs fresh so it re-reads the current skill and the feedback.
		let draft: string
		let artifactPath: string
		let producerResult: SubagentResult | undefined
		let producerPrompt = ""
		const t0 = Date.now()
		if (contract.rendered) {
			// A rendered leaf is produced by a WORKER running the render skill (skills + tools, spec 09),
			// not by engine code. Stage the upstream (the storyboard film.json) into a work dir, dispatch a
			// worker that runs the craft tools and writes an .mp4 there, then record that file as the
			// artifact. The engine owns no renderer — craft/tools does. The worker runs from craftRoot (its .claude/skills), and
			// the work dir is passed in the prompt.
			const workDir = join(this.config.artifactsDir, node.productionId, `${node.type}-v${n}`)
			mkdirSync(workDir, { recursive: true })
			stageRenderInputs(workDir, upstream)
			producerPrompt = buildRenderPrompt(contract, { brief: root.description ?? "", workDir, feedback })
			producerResult = await this.runSubagent({
				prompt: producerPrompt,
				skill: contract.skill ?? "render-film",
				cwd: this.config.craftRoot,
			})
			const mp4 = newestMp4(workDir)
			if (!mp4) throw new Error(`render: the skill produced no .mp4 in ${workDir} — ${producerResult.output.slice(0, 200)}`)
			artifactPath = mp4
			// Binary artifact: never read into a reviewer prompt. A text descriptor stands in.
			draft = `[rendered ${node.type}] file: ${mp4}`
		} else {
			let boardOut: string | undefined
			if (contract.emitsBoard) {
				const base = await this.artifactBase(node)
				boardOut = join(this.config.artifactsDir, node.productionId, "boards", `${base}-v${n}.jpg`)
				mkdirSync(join(this.config.artifactsDir, node.productionId, "boards"), { recursive: true })
			}
			producerPrompt = buildProducerPrompt(contract, { brief: root.description ?? "", upstream, nodeBrief: node.description ?? undefined, priorContent, feedback, boardOut })
			producerResult = await this.runSubagent({
				prompt: producerPrompt,
				skill: contract.skill ?? node.type,
				cwd: this.config.craftRoot,
			})
			draft = producerResult.output
			artifactPath = writeArtifact(this.config.artifactsDir, node.productionId, await this.artifactBase(node), n, draft)
		}
		const producerMs = Date.now() - t0
		const version = await this.store.createVersion({
			nodeId: node.id,
			n,
			prevVersionId: latest?.id,
			status: "producing",
			artifactPath,
			builtFrom: await this.computeBuiltFrom(node),
			subagent: {
				runId: randomUUID(),
				status: "done",
				...(producerResult ? { sessionId: producerResult.sessionId, engine: this.runner.engine, model: producerResult.model } : {}),
			},
		})
		if (producerResult) await this.logInteraction(node, version.id, "producer", producerResult, producerMs, producerPrompt)
		log.info("node.produce", { versionId: version.id, n, rendered: Boolean(contract.rendered), ms: producerMs })

		// internal quality gate — independent specialist reviewers
		const verdicts: ("pass" | "revise")[] = []
		for (const rv of contract.reviews ?? []) {
			const rt0 = Date.now()
			const reviewPrompt = buildReviewerPrompt(contract, rv, { draft, brief: root.description ?? "", upstream })
			const rres = await this.runSubagent({
				prompt: reviewPrompt,
				skill: rv.skill ?? `review:${rv.kind}`, // a reviewer skill (per-step rubric) if declared, else the kind label (generic lens, no directive)
				cwd: this.config.craftRoot,
			})
			await this.logInteraction(node, version.id, `review:${rv.kind}`, rres, Date.now() - rt0, reviewPrompt)
			const verdict = parseVerdict(rres.output)
			await this.store.addReview({ nodeId: node.id, versionId: version.id, name: rv.name, kind: rv.kind, verdict, body: rres.output })
			verdicts.push(verdict)
			log.debug("review.verdict", { versionId: version.id, reviewer: rv.name, kind: rv.kind, verdict })
		}

		const advisory = contract.advisoryReview === true
		if (advisory || verdicts.every((v) => v === "pass")) {
			await this.present(node, contract, version.id, root, log)
			return
		}

		// a reviewer said revise — never shown to the user
		await this.store.updateVersion(version.id, { status: "needs-work" })
		const redosSoFar = priorVersions.filter((v) => v.status === "needs-work").length + 1
		if (redosSoFar >= this.config.maxRedos) {
			const reason = `couldn't fully satisfy the review set after ${this.config.maxRedos} attempts`
			log.warn("node.escalate", { versionId: version.id, reason, attempt: redosSoFar })
			await this.present(node, contract, version.id, root, log, reason)
		} else {
			log.info("node.redo", { versionId: version.id, attempt: redosSoFar })
			await this.store.updateNodeStatus(node.id, "pending") // redo next tick, fed the reviewer feedback
		}
	}

	// The holistic final review (holisticReview types, e.g. final-review): the critic judges the finished
	// video as a whole and either passes it (present → human) or names upstream steps to redo. A reopen
	// sends those approved nodes — and everything downstream of them — back to pending and re-produces,
	// capped by maxGlobalRevisions so the whole-video loop can't thrash. This node is itself a dependent
	// of the steps it reopens, so it re-runs once the reopened subtree rolls back up. The root stays
	// in-progress throughout (this terminal node is never approved during a reopen), so rollup is untouched.
	private async dispatchHolisticReview(node: Node, contract: TypeContract): Promise<void> {
		const root = await this.store.getProduction(node.productionId)
		if (!root) throw new Error(`dispatchHolisticReview: production ${node.productionId} missing`)
		const log = this.log.child({ productionId: node.productionId, nodeId: node.id, type: node.type })
		log.info("node.dispatch")

		const priorVersions = await this.store.versionsFor(node.id)
		const latest = priorVersions.at(-1)
		const n = (latest?.n ?? 0) + 1
		const upstream = await this.collectUpstream(node)

		const t0 = Date.now()
		const holisticPrompt = buildHolisticPrompt(contract, { brief: root.description ?? "", upstream })
		const result = await this.runSubagent({
			prompt: holisticPrompt,
			skill: contract.skill ?? "final-review",
			cwd: this.config.craftRoot,
			resumeSessionId: latest?.subagent?.sessionId,
		})
		const draft = result.output
		const artifactPath = writeArtifact(this.config.artifactsDir, node.productionId, node.type, n, draft)
		const version = await this.store.createVersion({
			nodeId: node.id,
			n,
			prevVersionId: latest?.id,
			status: "producing",
			artifactPath,
			builtFrom: await this.computeBuiltFrom(node),
			subagent: { runId: randomUUID(), status: "done", sessionId: result.sessionId, engine: this.runner.engine, model: result.model },
		})
		await this.logInteraction(node, version.id, "producer", result, Date.now() - t0, holisticPrompt)

		if (parseVerdict(draft) === "pass") {
			log.info("review.holistic", { versionId: version.id, verdict: "pass" })
			await this.present(node, contract, version.id, root, log)
			return
		}

		// revise — reopen the named upstream steps, within the global budget; else escalate to the human
		const targets = parseReopen(draft)
		const used = this.globalRevisions.get(node.productionId) ?? 0
		if (targets.length === 0 || used >= this.config.maxGlobalRevisions) {
			const reason =
				targets.length === 0
					? "flagged whole-video issues but named no step to redo"
					: `couldn't resolve the whole-video notes after ${this.config.maxGlobalRevisions} revision passes`
			log.warn("review.holistic_escalate", { versionId: version.id, used, targets: targets.map((t) => t.type) })
			await this.store.updateVersion(version.id, { status: "needs-work" })
			await this.present(node, contract, version.id, root, log, reason)
			return
		}
		this.globalRevisions.set(node.productionId, used + 1)
		const reopened = await this.reopenWithCascade(node, targets)
		log.info("review.holistic_reopen", { versionId: version.id, pass: used + 1, reopened })
	}

	// Send the named upstream node(s) back to revise and cascade. Surgical by design: reopening one
	// fanned-out instance (e.g. scene[2]) must NOT disturb its siblings (scenes 1, 3). Three effects,
	// taken together over a fixpoint:
	//   • forward — any node transitively downstream via deps edges is stale (built on the old version),
	//     so it reopens too;
	//   • ancestor — a node with a reopened child is no longer fully approved, so it drops back to
	//     in-progress to re-roll-up (it does NOT re-produce — a reopened scene doesn't re-plan its build);
	//     that un-approval then cascades forward to the ancestor's own dependents (render deps build).
	// Named targets carry the critic's reason as denial feedback (re-produced to address it). Cascaded
	// dependents are marked STALE, not rebuilt: each revalidates against the changed upstream and is kept
	// if it still holds, rebuilt only if it doesn't (see revalidate). The final-review node is the
	// exception — it always re-runs once the cascade settles. Ancestors keep their version and only
	// re-roll-up. Returns a readable label per directly-reopened node.
	private async reopenWithCascade(reviewNode: Node, targets: ReopenTarget[]): Promise<string[]> {
		const tree = await this.store.nodesFor(reviewNode.productionId)
		const childrenOf = new Map<string, Node[]>()
		for (const n of tree) {
			if (!n.parentId) continue
			const arr = childrenOf.get(n.parentId) ?? []
			arr.push(n)
			childrenOf.set(n.parentId, arr)
		}

		// resolve each target to specific node(s): an index picks one instance (1-based, by position
		// among that type's siblings); no index reopens every node of that type.
		const named = new Map<string, string>() // node id → reason
		for (const t of targets) {
			const pool = tree.filter((n) => n.parentId !== null && n.type === t.type).sort((a, b) => a.position - b.position)
			const picks = t.index != null ? [pool[t.index - 1]] : pool
			for (const p of picks) if (p) named.set(p.id, t.reason)
		}
		if (named.size === 0) return []

		// invalid = named ∪ forward-deps-closure ∪ ancestor-closure (to fixpoint)
		const invalid = new Set(named.keys())
		for (let changed = true; changed; ) {
			changed = false
			for (const node of tree) {
				if (invalid.has(node.id)) continue
				const dependsOnInvalid = node.deps.some((d) => invalid.has(d))
				const hasInvalidChild = (childrenOf.get(node.id) ?? []).some((c) => invalid.has(c.id))
				if (dependsOnInvalid || hasInvalidChild) {
					invalid.add(node.id)
					changed = true
				}
			}
		}

		for (const node of tree) {
			if (!invalid.has(node.id)) continue
			const v = await this.store.latestVersion(node.id)
			if (named.has(node.id)) {
				// the critic named it — re-produce to address the reason
				if (v) await this.store.updateVersion(v.id, { status: "denied", feedback: named.get(node.id) })
				await this.store.updateNodeStatus(node.id, "pending")
				continue
			}
			const c = this.types.get(node.type)
			const depsChanged = node.deps.some((d) => invalid.has(d))
			const hasChildren = (childrenOf.get(node.id)?.length ?? 0) > 0
			if (c.planner && depsChanged) {
				// the planner's OWN upstream changed — re-plan + reconcile its children (not just re-roll-up)
				if (v) await this.store.updateVersion(v.id, { status: "stale" })
				await this.store.updateNodeStatus(node.id, "pending")
				continue
			}
			if (hasChildren) {
				// an ancestor whose own deps are intact — only a child reopened, so just re-roll-up; keep its version
				await this.store.updateNodeStatus(node.id, "in-progress")
				continue
			}
			if (v) await this.store.updateVersion(v.id, c.holisticReview ? { status: "superseded" } : { status: "stale" })
			await this.store.updateNodeStatus(node.id, "pending")
		}
		return [...named.keys()].map((id) => {
			const n = tree.find((x) => x.id === id)
			if (!n) return "?"
			const siblings = tree.filter((x) => x.parentId === n.parentId && x.type === n.type)
			return siblings.length > 1 ? `${n.type}[${siblings.findIndex((x) => x.id === id) + 1}]` : n.type
		})
	}

	private async present(node: Node, contract: TypeContract, versionId: string, root: Node, log: Logger, caveat?: string): Promise<void> {
		await this.store.updateVersion(versionId, { status: "presentable" })

		let prompt = `${node.name} is ready for review.`
		let agreementCapped = false
		if (contract.agreement) {
			const rounds = (await this.store.versionsFor(node.id)).filter((v) => v.status === "denied").length
			const cap = root.actorKind === "agent" ? this.config.agreementMaxRoundsAgent : this.config.agreementMaxRoundsHuman
			if (rounds >= cap) {
				// agreement cap (F5): escalate — do not force. The actor decides: approve = proceed, feedback = keep refining.
				prompt = `${node.name}: ${rounds} rounds of refinement reached. Approve to proceed as-is, or give feedback to keep refining.`
				agreementCapped = true
				log.warn("agreement.cap", { versionId, rounds, cap })
			}
		}
		if (caveat) prompt = `${node.name}: ${caveat}. Presenting anyway — approve or give feedback.`

		await this.store.emitOutput({
			productionId: node.productionId,
			nodeId: node.id,
			versionId,
			accountId: root.accountId ?? undefined,
			userId: root.userId ?? undefined,
			type: "present",
			prompt,
		})
		await this.store.updateNodeStatus(node.id, "needs-presentation")
		log.info("node.present", { versionId, escalation: Boolean(caveat), agreementCapped })
	}

	// Log one subagent interaction (a producer draft or one reviewer pass): engine/model/session +
	// token usage + timing. Per-call row; whole-session usage is SUM(...) GROUP BY session_id.
	private async logInteraction(node: Node, versionId: string, role: InteractionRole, result: SubagentResult, durationMs: number, prompt: string): Promise<void> {
		await this.store.recordInteraction({
			productionId: node.productionId,
			nodeId: node.id,
			versionId,
			role,
			prompt,
			engine: this.runner.engine,
			model: result.model,
			sessionId: result.sessionId,
			inputTokens: result.usage?.inputTokens,
			outputTokens: result.usage?.outputTokens,
			cacheReadTokens: result.usage?.cacheReadTokens,
			cacheCreationTokens: result.usage?.cacheCreationTokens,
			costUsd: result.usage?.costUsd,
			durationMs,
			status: "done",
		})
	}

	private async collectUpstream(node: Node): Promise<UpstreamArtifact[]> {
		const out: UpstreamArtifact[] = []
		// A dep's artifact may be binary (a rendered .mp4). Never put raw bytes in a subagent prompt
		// (null bytes crash the CLI); hand down a descriptor instead. Text artifacts pass through.
		const push = (type: string, path: string | null | undefined, content: string) =>
			out.push({ type, content: content.includes("\0") ? `[binary ${type} artifact: ${path ?? "?"}]` : content })
		for (const depId of node.deps) {
			const dep = await this.store.getNode(depId)
			if (!dep) continue
			const version = await this.store.latestVersion(dep.id)
			const content = readArtifact(version?.artifactPath ?? null)
			if (content) push(dep.type, version?.artifactPath, content)
			// If the dep fanned out and opts in (exposeChildrenToDependents, e.g. brainstorm), also hand
			// down each approved child's artifact, so a node depending on the fan-out sees the produced
			// units (the developed ideas), not just the plan. Off by default — a planner like `build`
			// is unaffected, so the B-branch (build → assemble) keeps its current upstream.
			if (this.types.has(dep.type) && this.types.get(dep.type).exposeChildrenToDependents) {
				const kids = (await this.store.nodesFor(node.productionId))
					.filter((n) => n.parentId === dep.id && n.status === "approved")
					.sort((a, b) => a.position - b.position)
				for (const kid of kids) {
					const kv = await this.store.latestVersion(kid.id)
					const kc = readArtifact(kv?.artifactPath ?? null)
					if (kc) push(kid.type, kv?.artifactPath, kc)
				}
			}
		}
		return out
	}

	// A version records what it was produced from: per upstream dep, that dep's EFFECTIVE content hash.
	// "Effective" rolls a parent's children up (a fanned-out build's hash is the hash of its scene
	// children), so changing one scene changes the build's hash while a kept upstream does not. Reopen
	// revalidation compares these against the current upstream: unchanged hash = a no-op, changed = a
	// real change the dependent must react to.
	private async computeBuiltFrom(node: Node): Promise<Record<string, string>> {
		if (node.deps.length === 0) return {}
		const tree = await this.store.nodesFor(node.productionId)
		const childrenOf = new Map<string, Node[]>()
		for (const n of tree) {
			if (!n.parentId) continue
			const arr = childrenOf.get(n.parentId) ?? []
			arr.push(n)
			childrenOf.set(n.parentId, arr)
		}
		const out: Record<string, string> = {}
		for (const depId of node.deps) {
			const dep = tree.find((n) => n.id === depId)
			if (dep) out[depId] = await this.effectiveHash(dep, childrenOf)
		}
		return out
	}

	private async effectiveHash(node: Node, childrenOf: Map<string, Node[]>): Promise<string> {
		// a skipped child (dropped by a re-plan) is not part of the output, so it must not sway the hash
		const kids = (childrenOf.get(node.id) ?? []).filter((c) => c.status !== "skipped")
		if (kids.length > 0) {
			const parts: string[] = []
			for (const c of [...kids].sort((a, b) => a.position - b.position)) parts.push(`${c.position}:${await this.effectiveHash(c, childrenOf)}`)
			return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16)
		}
		const v = await this.store.latestVersion(node.id)
		const content = v?.artifactPath ? readArtifact(v.artifactPath) : null
		return createHash("sha256").update(content ?? "∅").digest("hex").slice(0, 16)
	}

	// Decide a STALE node's fate against its now-changed upstream. Returns true if the existing artifact
	// is KEPT (approved in place — the cascade stops here because this node's output did not change), or
	// false if it must be REBUILT (the caller falls through to the produce path). Three cases:
	//   • upstream hash unchanged  → keep (a no-op reopen reached this node);
	//   • mechanical (rendered) node, or one with no upstream-sensitive reviewer → rebuild (can't cheaply
	//     judge that the change is harmless, so re-produce against the new upstream);
	//   • authoring node → re-run its coverage/consistency reviewers on the EXISTING artifact: all pass =>
	//     keep (still holds despite the change); any revise => rebuild, fed the reviewers' notes.
	// Quality (craft) is never re-checked — it is intrinsic and an upstream change can't lower it.
	private async revalidate(node: Node, contract: TypeContract, latest: Version): Promise<boolean> {
		const log = this.log.child({ productionId: node.productionId, nodeId: node.id, type: node.type })
		if (contract.planner) return this.replan(node, contract, latest)
		const current = await this.computeBuiltFrom(node)
		if (builtFromEqual(current, latest.builtFrom ?? {})) {
			await this.store.updateVersion(latest.id, { status: "approved" })
			await this.store.updateNodeStatus(node.id, "approved")
			log.info("node.revalidate_keep", { reason: "upstream-unchanged" })
			return true
		}

		const sensitive = (contract.reviews ?? []).filter((r) => r.kind === "coverage" || r.kind === "consistency")
		if (contract.rendered || sensitive.length === 0) {
			await this.store.updateVersion(latest.id, { status: "superseded" })
			log.info("node.revalidate_rebuild", { reason: contract.rendered ? "mechanical" : "no-upstream-reviewer" })
			return false
		}

		const root = await this.store.getProduction(node.productionId)
		const draft = readArtifact(latest.artifactPath ?? null) ?? ""
		const upstream = await this.collectUpstream(node)
		const revise: string[] = []
		for (const rv of sensitive) {
			const rt0 = Date.now()
			const reviewPrompt = buildReviewerPrompt(contract, rv, { draft, brief: root?.description ?? "", upstream, revalidation: true })
			const rres = await this.runSubagent({
				prompt: reviewPrompt,
				skill: rv.skill ?? `review:${rv.kind}`,
				cwd: this.config.craftRoot,
			})
			await this.logInteraction(node, latest.id, `review:${rv.kind}`, rres, Date.now() - rt0, reviewPrompt)
			const verdict = parseVerdict(rres.output)
			await this.store.addReview({ nodeId: node.id, versionId: latest.id, name: rv.name, kind: rv.kind, verdict, body: rres.output })
			if (verdict === "revise") revise.push(rres.output)
		}
		if (revise.length === 0) {
			// still holds — keep the artifact, but record that it is now validated against the new upstream
			await this.store.updateVersion(latest.id, { status: "approved", builtFrom: current })
			await this.store.updateNodeStatus(node.id, "approved")
			log.info("node.revalidate_keep", { reason: "reviewers-pass" })
			return true
		}
		await this.store.updateVersion(latest.id, { status: "denied", feedback: revise.join("\n\n") })
		log.info("node.revalidate_rebuild", { reason: "reviewers-revise" })
		return false
	}

	// Re-plan a stale planner whose own upstream changed, reconciling its children by name instead of
	// blindly re-fanning: scenes still in the new plan are KEPT (they revalidate individually against the
	// changed upstream via their own stale mark), scenes no longer in it are SKIPPED, genuinely new ones
	// are created. The planner stays in-progress and re-rolls-up once the reconciled set settles. Always
	// returns true (the re-plan is the handling — never falls through to a blind re-fan).
	private async replan(node: Node, contract: TypeContract, latest: Version): Promise<boolean> {
		const log = this.log.child({ productionId: node.productionId, nodeId: node.id, type: node.type })
		if (!contract.childType) throw new Error(`replan: planner "${node.type}" declares no childType`)
		const root = await this.store.getProduction(node.productionId)
		const upstream = await this.collectUpstream(node)
		const t0 = Date.now()
		const plannerPrompt = buildPlannerPrompt(contract, { brief: root?.description ?? "", upstream })
		const result = await this.runSubagent({
			prompt: plannerPrompt,
			skill: contract.skill ?? node.type,
			cwd: this.config.craftRoot,
			resumeSessionId: latest.subagent?.sessionId,
		})
		const planned = parsePlan(result.output)
		if (planned.length === 0) throw new Error(`replan: planner "${node.type}" returned no children — ${result.output.slice(0, 200)}`)

		const children = (await this.store.nodesFor(node.productionId)).filter((n) => n.parentId === node.id)
		const byName = new Map(children.map((c) => [c.name, c]))
		const childName = this.types.has(contract.childType) ? (this.types.get(contract.childType).name ?? contract.childType) : contract.childType
		const wantNames = planned.map((p, i) => p.name || `${childName} ${i + 1}`)
		const wantSet = new Set(wantNames)

		// skip children no longer planned (excluded from the planner's rollup)
		for (const c of children) if (!wantSet.has(c.name)) await this.store.updateNodeStatus(c.id, "skipped")
		// create genuinely-new scenes (kept ones stay and revalidate individually)
		let position = children.reduce((m, c) => Math.max(m, c.position), -1) + 1
		const toCreate = planned
			.map((p, i) => ({ p, name: wantNames[i]! }))
			.filter(({ name }) => !byName.has(name))
			.map(({ p, name }) => ({ type: contract.childType!, name, description: p.brief, deps: node.deps, position: position++ }))
		if (toCreate.length > 0) await this.store.createChildNodes(node.id, toCreate)

		// record the re-plan as a new version, validated against the current upstream
		const n = latest.n + 1
		const artifactPath = writeArtifact(this.config.artifactsDir, node.productionId, node.type, n, result.output)
		const version = await this.store.createVersion({
			nodeId: node.id,
			n,
			prevVersionId: latest.id,
			status: "approved",
			artifactPath,
			builtFrom: await this.computeBuiltFrom(node),
			subagent: { runId: randomUUID(), status: "done", sessionId: result.sessionId, engine: this.runner.engine, model: result.model },
		})
		await this.store.updateVersion(latest.id, { status: "superseded" })
		await this.logInteraction(node, version.id, "producer", result, Date.now() - t0, plannerPrompt)
		await this.store.updateNodeStatus(node.id, "in-progress") // re-rolls-up once the reconciled children settle
		log.info("node.replan", { versionId: version.id, kept: children.length - toCreate.length, added: toCreate.length, skipped: children.filter((c) => !wantSet.has(c.name)).length })
		return true
	}
}

// Two builtFrom maps are equal when they carry the same deps at the same effective hashes. Used by
// revalidation to tell a real upstream change from a no-op reopen that happened to reach this node.
function builtFromEqual(a: Record<string, string>, b: Record<string, string>): boolean {
	const ak = Object.keys(a)
	if (ak.length !== Object.keys(b).length) return false
	for (const k of ak) if (a[k] !== b[k]) return false
	return true
}

// ── artifact files (on the shared volume; the DB only references the path) ─────────────────────────

function writeArtifact(artifactsDir: string, productionId: string, name: string, n: number, content: string): string {
	const dir = join(artifactsDir, productionId)
	mkdirSync(dir, { recursive: true })
	const path = join(dir, `${name}-v${n}.md`)
	writeFileSync(path, content, "utf8")
	return path
}

function readArtifact(path: string | null | undefined): string | undefined {
	if (!path) return undefined
	try {
		return readFileSync(path, "utf8")
	} catch {
		return undefined
	}
}

// Stage a rendered leaf's upstream artifacts as files the render skill reads: the storyboard artifact
// becomes film.json (the worker's make-film input); any other text upstream is written beside it.
function stageRenderInputs(workDir: string, upstream: UpstreamArtifact[]): void {
	for (const u of upstream) {
		if (u.content.includes("\0")) continue // never stage binary
		const name = /storyboard|film/i.test(u.type) ? "film.json" : `${u.type}.txt`
		writeFileSync(join(workDir, name), u.content, "utf8")
	}
}

// The most-recently-written .mp4 under a work dir — what the render skill produced.
function newestMp4(dir: string): string | null {
	let bestPath: string | null = null
	let bestT = -1
	const walk = (d: string): void => {
		let entries: Dirent[]
		try {
			entries = readdirSync(d, { withFileTypes: true })
		} catch {
			return
		}
		for (const e of entries) {
			const p = join(d, e.name)
			if (e.isDirectory()) walk(p)
			else if (e.name.toLowerCase().endsWith(".mp4")) {
				const t = statSync(p).mtimeMs
				if (t > bestT) {
					bestT = t
					bestPath = p
				}
			}
		}
	}
	walk(dir)
	return bestPath
}

// The render leaf's task prompt: point the worker at the staged work dir; the /render-film skill (the
// directive the runner injects) owns the steps (extract the script, run make-film, write the .mp4).
function buildRenderPrompt(_contract: TypeContract, a: { brief: string; workDir: string; feedback?: string }): string {
	return [
		`Produce the finished video for this node.`,
		`Work dir: ${a.workDir} — it holds film.json (the approved storyboard). Write the final MP4 into that same work dir.`,
		`Brief: ${a.brief}`,
		a.feedback ? `Revision feedback to address this round:\n${a.feedback}` : "",
	]
		.filter(Boolean)
		.join("\n\n")
}
