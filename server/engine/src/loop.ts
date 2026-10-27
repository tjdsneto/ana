// The engine loop — what the worker runs. It produces, reviews internally, and marks the data; it
// never presents and never approves (the client does, via chat_input). Derived from spec 02.
//
// One tick: start any queued productions (expand the root), roll up finished ones, then claim one
// ready node and run a single dispatch step. v0-flat: productions expand into leaf children only
// (no sub-projects / fan-out), so dispatch is always a leaf.

import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Node, RenderClient, Store, SubagentRunner } from "@app/shared"
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
}

export class Engine {
	private readonly store: Store
	private readonly runner: SubagentRunner
	private readonly render: RenderClient
	private readonly types: TypeRegistry
	private readonly config: EngineConfig

	constructor(deps: EngineDeps) {
		this.store = deps.store
		this.runner = deps.runner
		this.render = deps.render
		this.types = deps.types
		this.config = deps.config
	}

	// One unit of work. Returns whether anything advanced (false = idle: nothing queued/ready and
	// nothing to roll up — the loop is waiting on the human gate or genuinely done).
	async tick(): Promise<boolean> {
		const started = await this.startQueuedProductions()
		const rolled = await this.rollupProductions()
		const node = await this.store.claimReadyNode()
		if (node) {
			await this.dispatch(node)
			return true
		}
		return started || rolled
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
	}

	// ── all children approved → root approved (production done) ────────────────────────────────────

	private async rollupProductions(): Promise<boolean> {
		let rolled = false
		for (const root of (await this.store.listProductions()).filter((r) => r.status === "in-progress")) {
			const children = (await this.store.nodesFor(root.productionId)).filter((n) => n.parentId === root.id)
			if (children.length > 0 && children.every((c) => c.status === "approved")) {
				await this.store.updateNodeStatus(root.id, "approved")
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

		// produce — via the RenderClient for rendered types (stubbed in v0), else a subagent
		let draft: string
		let artifactPath: string
		if (contract.rendered) {
			const outDir = join(this.config.artifactsDir, node.productionId)
			mkdirSync(outDir, { recursive: true })
			const result = await this.render.render({ kind: node.type, spec: { brief: root.description ?? "", upstream }, outDir })
			artifactPath = result.artifactPath
			draft = readArtifact(artifactPath) ?? `[rendered ${node.type} — stub]`
		} else {
			const producePrompt = buildProducerPrompt(contract, { brief: root.description ?? "", upstream, priorContent, feedback })
			const produced = await this.runner.run({ prompt: producePrompt, skill: contract.skill ?? node.type })
			draft = produced.output
			artifactPath = writeArtifact(this.config.artifactsDir, node.productionId, node.type, n, draft)
		}
		const version = await this.store.createVersion({
			nodeId: node.id,
			n,
			prevVersionId: latest?.id,
			status: "producing",
			artifactPath,
			subagent: { runId: randomUUID(), status: "done" },
		})

		// internal quality gate — independent specialist reviewers
		const verdicts: ("pass" | "revise")[] = []
		for (const rv of contract.reviews ?? []) {
			const rres = await this.runner.run({
				prompt: buildReviewerPrompt(contract, rv, { draft, brief: root.description ?? "", upstream }),
				skill: `review:${rv.kind}`,
			})
			const verdict = parseVerdict(rres.output)
			await this.store.addReview({ nodeId: node.id, versionId: version.id, name: rv.name, kind: rv.kind, verdict, body: rres.output })
			verdicts.push(verdict)
		}

		const advisory = contract.advisoryReview === true
		if (advisory || verdicts.every((v) => v === "pass")) {
			await this.present(node, contract, version.id, root)
			return
		}

		// a reviewer said revise — never shown to the user
		await this.store.updateVersion(version.id, { status: "needs-work" })
		const redosSoFar = priorVersions.filter((v) => v.status === "needs-work").length + 1
		if (redosSoFar >= this.config.maxRedos) {
			await this.present(node, contract, version.id, root, `couldn't fully satisfy the review set after ${this.config.maxRedos} attempts`)
		} else {
			await this.store.updateNodeStatus(node.id, "pending") // redo next tick, fed the reviewer feedback
		}
	}

	private async present(node: Node, contract: TypeContract, versionId: string, root: Node, caveat?: string): Promise<void> {
		await this.store.updateVersion(versionId, { status: "presentable" })

		let prompt = `${node.name} is ready for review.`
		if (contract.agreement) {
			const rounds = (await this.store.versionsFor(node.id)).filter((v) => v.status === "denied").length
			const cap = root.actorKind === "agent" ? this.config.agreementMaxRoundsAgent : this.config.agreementMaxRoundsHuman
			if (rounds >= cap) {
				// agreement cap (F5): escalate — do not force. The actor decides: approve = proceed, feedback = keep refining.
				prompt = `${node.name}: ${rounds} rounds of refinement reached. Approve to proceed as-is, or give feedback to keep refining.`
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
