// The engine loop — what the worker runs. It produces, reviews internally, and marks the data; it
// never presents and never approves (the client does, via chat_input). Derived from spec 02.
//
// One tick: start any queued productions (expand the root), roll up any node whose children are all
// approved, then claim one ready node and run a single dispatch step. A node dispatches by type:
// expand (static checklist children), plan (dynamic fan-out), holistic review, or leaf (produce an
// artifact). Completion rolls up by approval from leaves to the root, at any depth.

import { randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { NoopLogger } from "@core/shared"
import type { InteractionRole, Logger, Node, Store, SubagentInput, SubagentResult, SubagentRunner } from "@core/shared"
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
				if (kids.every((c) => c.status === "approved")) {
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
		const result = await this.runSubagent({
			prompt: buildPlannerPrompt(contract, { brief: root.description ?? "", upstream }),
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
			subagent: { runId: randomUUID(), status: "done", sessionId: result.sessionId, engine: this.runner.engine, model: result.model },
		})
		await this.logInteraction(node, version.id, "producer", result, Date.now() - t0)

		const childType = contract.childType
		const childName = this.types.has(childType) ? (this.types.get(childType).name ?? childType) : childType
		await this.store.createChildNodes(
			node.id,
			planned.map((c, i) => ({ type: childType, name: c.name || `${childName} ${i + 1}`, description: c.brief, deps: node.deps, position: i })),
		)
		await this.store.updateNodeStatus(node.id, "in-progress")
		log.info("node.plan", { versionId: version.id, children: planned.length })
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
		// own TTS/ffmpeg tools and writes the .mp4), every other leaf runs its producer skill. The
		// producer resumes its prior session (the latest version's subagent.sessionId) so a redo
		// round continues the same provider session rather than starting cold.
		let draft: string
		let artifactPath: string
		let producerResult: SubagentResult | undefined
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
			producerResult = await this.runSubagent({
				prompt: buildRenderPrompt(contract, { brief: root.description ?? "", workDir, feedback }),
				skill: contract.skill ?? "render-film",
				cwd: this.config.craftRoot,
				resumeSessionId: latest?.subagent?.sessionId,
			})
			const mp4 = newestMp4(workDir)
			if (!mp4) throw new Error(`render: the skill produced no .mp4 in ${workDir} — ${producerResult.output.slice(0, 200)}`)
			artifactPath = mp4
			// Binary artifact: never read into a reviewer prompt. A text descriptor stands in.
			draft = `[rendered ${node.type}] file: ${mp4}`
		} else {
			const producePrompt = buildProducerPrompt(contract, { brief: root.description ?? "", upstream, nodeBrief: node.description ?? undefined, priorContent, feedback })
			producerResult = await this.runSubagent({
				prompt: producePrompt,
				skill: contract.skill ?? node.type,
				cwd: this.config.craftRoot,
				resumeSessionId: latest?.subagent?.sessionId,
			})
			draft = producerResult.output
			artifactPath = writeArtifact(this.config.artifactsDir, node.productionId, node.type, n, draft)
		}
		const producerMs = Date.now() - t0
		const version = await this.store.createVersion({
			nodeId: node.id,
			n,
			prevVersionId: latest?.id,
			status: "producing",
			artifactPath,
			subagent: {
				runId: randomUUID(),
				status: "done",
				...(producerResult ? { sessionId: producerResult.sessionId, engine: this.runner.engine, model: producerResult.model } : {}),
			},
		})
		if (producerResult) await this.logInteraction(node, version.id, "producer", producerResult, producerMs)
		log.info("node.produce", { versionId: version.id, n, rendered: Boolean(contract.rendered), ms: producerMs })

		// internal quality gate — independent specialist reviewers
		const verdicts: ("pass" | "revise")[] = []
		for (const rv of contract.reviews ?? []) {
			const rt0 = Date.now()
			const rres = await this.runSubagent({
				prompt: buildReviewerPrompt(contract, rv, { draft, brief: root.description ?? "", upstream }),
				skill: rv.skill ?? `review:${rv.kind}`, // a reviewer skill (per-step rubric) if declared, else the kind label (generic lens, no directive)
				cwd: this.config.craftRoot,
			})
			await this.logInteraction(node, version.id, `review:${rv.kind}`, rres, Date.now() - rt0)
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
		const result = await this.runSubagent({
			prompt: buildHolisticPrompt(contract, { brief: root.description ?? "", upstream }),
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
			subagent: { runId: randomUUID(), status: "done", sessionId: result.sessionId, engine: this.runner.engine, model: result.model },
		})
		await this.logInteraction(node, version.id, "producer", result, Date.now() - t0)

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

	// Send the named upstream nodes back to revise and cascade: any node transitively downstream of a
	// reopened one is stale (built on the old version) and reopens too. Named targets carry the critic's
	// reason as denial feedback (re-produced to address it); cascaded dependents are marked superseded
	// (re-produced against the fresh upstream). Returns the node types actually reopened.
	private async reopenWithCascade(reviewNode: Node, targets: ReopenTarget[]): Promise<string[]> {
		const all = (await this.store.nodesFor(reviewNode.productionId)).filter((n) => n.parentId !== null)
		const named = new Map<string, string>() // node id → reason
		for (const t of targets) {
			const hit = all.find((n) => n.type === t.type)
			if (hit) named.set(hit.id, t.reason)
		}
		if (named.size === 0) return []
		// transitive dependents of the named set (fixpoint over the deps edges)
		const invalid = new Set(named.keys())
		for (let changed = true; changed; ) {
			changed = false
			for (const node of all) {
				if (!invalid.has(node.id) && node.deps.some((d) => invalid.has(d))) {
					invalid.add(node.id)
					changed = true
				}
			}
		}
		for (const node of all) {
			if (!invalid.has(node.id)) continue
			const v = await this.store.latestVersion(node.id)
			if (v) await this.store.updateVersion(v.id, named.has(node.id) ? { status: "denied", feedback: named.get(node.id) } : { status: "superseded" })
			await this.store.updateNodeStatus(node.id, "pending")
		}
		return [...named.keys()].map((id) => all.find((n) => n.id === id)?.type ?? "?")
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
	private async logInteraction(node: Node, versionId: string, role: InteractionRole, result: SubagentResult, durationMs: number): Promise<void> {
		await this.store.recordInteraction({
			productionId: node.productionId,
			nodeId: node.id,
			versionId,
			role,
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
		for (const depId of node.deps) {
			const dep = await this.store.getNode(depId)
			if (!dep) continue
			const version = await this.store.latestVersion(dep.id)
			const content = readArtifact(version?.artifactPath ?? null)
			if (!content) continue
			// A dep's artifact may be binary (a rendered .mp4). Never put raw bytes in a subagent prompt
			// (null bytes crash the CLI); hand down a descriptor instead. Text artifacts pass through.
			const safe = content.includes("\0") ? `[binary ${dep.type} artifact: ${version?.artifactPath ?? "?"}]` : content
			out.push({ type: dep.type, content: safe })
		}
		return out
	}
}

// ── artifact files (on the shared volume; the DB only references the path) ─────────────────────────

function writeArtifact(artifactsDir: string, productionId: string, type: string, n: number, content: string): string {
	const dir = join(artifactsDir, productionId)
	mkdirSync(dir, { recursive: true })
	const path = join(dir, `${type}-v${n}.md`)
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
