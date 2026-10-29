// The engine loop — what the worker runs. It produces, reviews internally, and marks the data; it
// never presents and never approves (the client does, via chat_input). Derived from spec 02.
//
// One tick: start any queued productions (expand the root), roll up finished ones, then claim one
// ready node and run a single dispatch step. v0-flat: productions expand into leaf children only
// (no sub-projects / fan-out), so dispatch is always a leaf.

import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { NoopLogger } from "@core/shared"
import type { InteractionRole, Logger, Node, RenderClient, Store, SubagentInput, SubagentResult, SubagentRunner } from "@core/shared"
import type { EngineConfig } from "./config.js"
import { buildProducerPrompt, buildReviewerPrompt, parseVerdict, type UpstreamArtifact } from "./prompts.js"
import type { TypeContract, TypeRegistry } from "./typereg.js"

const MAX_TICKS_PER_DRAIN = 10_000 // safety valve; redo caps bound real work well below this

export interface EngineDeps {
	store: Store
	runner: SubagentRunner
	render: RenderClient
	types: TypeRegistry
	config: EngineConfig
	logger?: Logger // default: quiet (NoopLogger). Entrypoints inject a JsonLogger.
}

export class Engine {
	private readonly store: Store
	private readonly runner: SubagentRunner
	private readonly render: RenderClient
	private readonly types: TypeRegistry
	private readonly config: EngineConfig
	private readonly log: Logger
	private realCalls = 0 // real (non-fake) subagent calls made this process — the spend-guard counter
	private parkedWarned = false // so the park guard logs once, not on every poll wake-up

	constructor(deps: EngineDeps) {
		this.store = deps.store
		this.runner = deps.runner
		this.render = deps.render
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
		const rolled = await this.rollupProductions()
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
		for (const root of queued) await this.expandProduction(root)
		return queued.length > 0
	}

	private async expandProduction(root: Node): Promise<void> {
		const contract = this.types.get(root.type)
		if (!contract.checklist || contract.checklist.length === 0) {
			throw new Error(`expandProduction: type "${root.type}" has no checklist to expand`)
		}
		const idByKey = new Map<string, string>() // checklist-local key → created node id
		let position = 0
		for (const entry of contract.checklist) {
			const deps = (entry.deps ?? []).map((k) => {
				const id = idByKey.get(k)
				if (!id) throw new Error(`expandProduction: dep "${k}" referenced before it was declared`)
				return id
			})
			const name = this.types.has(entry.type) ? (this.types.get(entry.type).name ?? entry.type) : entry.type
			const [child] = await this.store.createChildNodes(root.id, [{ type: entry.type, name, deps, position }])
			if (!child) throw new Error("expandProduction: createChildNodes returned no row")
			idByKey.set(entry.id, child.id)
			position++
		}
		await this.store.updateNodeStatus(root.id, "in-progress")
		this.log.info("production.start", { productionId: root.id, children: contract.checklist.length })
	}

	// ── all children approved → root approved (production done) ────────────────────────────────────

	private async rollupProductions(): Promise<boolean> {
		let rolled = false
		for (const root of (await this.store.listProductions()).filter((r) => r.status === "in-progress")) {
			const children = (await this.store.nodesFor(root.productionId)).filter((n) => n.parentId === root.id)
			if (children.length > 0 && children.every((c) => c.status === "approved")) {
				await this.store.updateNodeStatus(root.id, "approved")
				this.log.info("production.done", { productionId: root.productionId })
				rolled = true
			}
		}
		return rolled
	}

	// ── dispatch one ready node ────────────────────────────────────────────────────────────────────

	private async dispatch(node: Node): Promise<void> {
		const contract = this.types.get(node.type)
		if (contract.checklist) throw new Error(`dispatch: nested sub-project "${node.type}" not supported in v0-flat`)
		if (contract.planner || contract.router) throw new Error(`dispatch: planner/router "${node.type}" not supported in v0-flat`)
		await this.dispatchLeaf(node, contract)
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

		// produce — via the RenderClient for rendered types (stubbed in v0), else a subagent. The
		// producer resumes its prior session (the latest version's subagent.sessionId) so a redo
		// round continues the same provider session rather than starting cold.
		let draft: string
		let artifactPath: string
		let producerResult: SubagentResult | undefined
		const t0 = Date.now()
		if (contract.rendered) {
			const outDir = join(this.config.artifactsDir, node.productionId)
			mkdirSync(outDir, { recursive: true })
			const result = await this.render.render({ kind: node.type, spec: { brief: root.description ?? "", upstream }, outDir })
			artifactPath = result.artifactPath
			// The rendered artifact may be binary (an .mp4) — NEVER read it into the reviewer prompt
			// (null bytes crash the subagent CLI). Describe it; the reviewer judges against the upstream
			// artifacts plus this summary.
			const meta = (result.meta ?? {}) as { scenes?: unknown; durationMs?: unknown; voice?: unknown }
			draft = `[rendered ${node.type}] ${meta.scenes ?? "?"} scenes, ${meta.durationMs ?? "?"}ms, voice=${meta.voice ?? "?"} — file: ${artifactPath}`
		} else {
			const producePrompt = buildProducerPrompt(contract, { brief: root.description ?? "", upstream, priorContent, feedback })
			producerResult = await this.runSubagent({
				prompt: producePrompt,
				skill: contract.skill ?? node.type,
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
				skill: `review:${rv.kind}`,
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
			if (content) out.push({ type: dep.type, content })
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
