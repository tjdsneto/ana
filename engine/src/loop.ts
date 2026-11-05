// The engine loop — what the worker runs. It produces, reviews internally, and marks the data; it
// never presents and never approves (the client does, via chat_input). Derived from spec 02.
//
// One tick: start any queued productions (expand the root), roll up any node whose children are all
// approved, then claim one ready node and run a single dispatch step. A node dispatches by type:
// expand (static checklist children), plan (dynamic fan-out), holistic review, or leaf (produce an
// artifact). Completion rolls up by approval from leaves to the root, at any depth.

import { createHash, randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, extname, join } from "node:path"
import { NoopLogger } from "@core/shared"
import type { InteractionRole, Logger, Node, Store, SubagentInput, SubagentResult, SubagentRunner, Version } from "@core/shared"
import type { EngineConfig } from "./config.js"
import { parseProductionPlanOutput } from "./plan-dag.js"
import { buildHolisticPrompt, buildPlannerPrompt, buildProducerPrompt, buildProductionPlanPrompt, buildReviewerPrompt, parsePlan, parseReopen, parseVerdict, type ReopenTarget, type UpstreamArtifact } from "./prompts.js"
import type { TypeContract, TypeRegistry } from "./typereg.js"

const MAX_TICKS_PER_DRAIN = 10_000 // safety valve; redo caps bound real work well below this
const DISPATCH_MAX_ATTEMPTS = 3 // 0001: a throwing dispatch is retried up to this many times, then the production fails

// 0001: a config/contract violation (a wiring bug, a planner that broke its own contract) is fatal — it
// must surface loudly and stop the worker, NOT be retried-then-failed like a transient produce crash.
// onDispatchError rethrows these; everything else is treated as a retryable runtime failure.
export class FatalDispatchError extends Error {}

export interface EngineDeps {
	store: Store
	runner: SubagentRunner // the default backend — used for any node that declares no engine (or names this one)
	runners?: Map<string, SubagentRunner> // extra backends by engine name, for nodes that pin a non-default engine (TypeContract.engine)
	types: TypeRegistry
	config: EngineConfig
	logger?: Logger // default: quiet (NoopLogger). Entrypoints inject a JsonLogger.
}

export class Engine {
	private readonly store: Store
	private readonly runner: SubagentRunner
	private readonly runners: Map<string, SubagentRunner>
	private readonly types: TypeRegistry
	private readonly config: EngineConfig
	private readonly log: Logger
	private realCalls = 0 // real (non-fake) subagent calls made this process — the spend-guard counter
	private parkedWarned = false // so the park guard logs once, not on every poll wake-up
	private readonly globalRevisions = new Map<string, number>() // productionId → holistic-reopen passes used (per-process; v0 single worker)
	private readonly nearPassStreak = new Map<string, number>() // nodeId → consecutive rounds a version passed all-but-one reviewer (convergence; per-process)
	private readonly noProgressStreak = new Map<string, { sig: string; n: number }>() // nodeId → the repeated failing-finding signature + its consecutive-round count (0020 no-progress escape; per-process)
	private readonly dispatchFailures = new Map<string, number>() // nodeId → consecutive dispatch throws (0001; per-process retry counter)

	constructor(deps: EngineDeps) {
		this.store = deps.store
		this.runner = deps.runner
		this.runners = deps.runners ?? new Map()
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
		// 0019: claim up to maxParallel READY nodes and dispatch them CONCURRENTLY. Independent fan-out
		// leaves (the N cards / N scenes under a plan node) have no dependency on each other, so running
		// them serially — one node per tick — is what made a real production a 13h wall-clock when the busy
		// time was the same 13h. The claim seam is `FOR UPDATE SKIP LOCKED`, so the sequential claims below
		// each return a DISTINCT node (no double-claim), and dispatching different nodes concurrently is safe
		// (the only per-node engine state — nearPassStreak / noProgressStreak — is keyed by node id).
		// maxParallel = 1 keeps the original serial behaviour.
		const cap = Math.max(1, this.config.maxParallel)
		const claimed: Node[] = []
		for (let i = 0; i < cap; i++) {
			const n = await this.store.claimReadyNode()
			if (!n) break
			claimed.push(n)
		}
		if (claimed.length > 0) {
			// A claimed node is already `in-progress`. If dispatch throws, nothing else would reset it and
			// claimReadyNode only picks `pending`, so the node — and the whole production — would hang
			// forever with no signal (0001). Catch per node, retry a few times, then fail the production loudly.
			await Promise.all(
				claimed.map(async (n) => {
					try {
						await this.dispatch(n)
					} catch (err) {
						await this.onDispatchError(n, err)
					}
				}),
			)
			return true
		}
		return started || rolled
	}

	// 0001: a dispatch threw (a producer crashed, a planner returned unparseable children, a skill was
	// unresolved, …). Retry the node up to DISPATCH_MAX_ATTEMPTS by resetting it to `pending`; once the
	// cap is hit, mark the node `failed`, retire the production (root → `failed`, so claimReadyNode stops
	// claiming its descendants), and emit a `notify` so the client learns the production died.
	private async onDispatchError(node: Node, err: unknown): Promise<void> {
		if (err instanceof FatalDispatchError) throw err // config/contract violation — surface loudly, never retry
		const message = err instanceof Error ? err.message : String(err)
		const attempts = (this.dispatchFailures.get(node.id) ?? 0) + 1
		this.dispatchFailures.set(node.id, attempts)
		const log = this.log.child({ productionId: node.productionId, nodeId: node.id, type: node.type })
		if (attempts < DISPATCH_MAX_ATTEMPTS) {
			log.warn("node.dispatch_error_retry", { attempt: attempts, max: DISPATCH_MAX_ATTEMPTS, message })
			await this.store.updateNodeStatus(node.id, "pending") // retried next tick
			return
		}
		this.dispatchFailures.delete(node.id)
		log.error("node.dispatch_failed", { attempts, message })
		await this.store.updateNodeStatus(node.id, "failed")
		if (node.parentId !== null) await this.store.updateNodeStatus(node.productionId, "failed")
		const root = await this.store.getProduction(node.productionId)
		await this.store.emitOutput({
			productionId: node.productionId,
			nodeId: node.id,
			accountId: root?.accountId ?? undefined,
			userId: root?.userId ?? undefined,
			type: "notify",
			prompt: `${node.name ?? node.type} failed after ${attempts} attempts; the production was stopped. Last error: ${message}`,
		})
	}

	private callBudgetSpent(): boolean {
		return this.config.maxSubagentCalls !== undefined && this.realCalls >= this.config.maxSubagentCalls
	}

	// Single seam for every subagent call, so the real-spend counter can never be bypassed. fake is
	// free, so it does not count against the budget.
	// The backend a node runs on: the type may pin one (TypeContract.engine); otherwise the default
	// runner. A pinned engine that names the default is just the default; any other must be registered
	// in the runners map (the worker wires it), else it is a config error we surface loudly.
	private runnerFor(contract?: TypeContract): SubagentRunner {
		const name = contract?.engine
		if (!name || name === this.runner.engine) return this.runner
		const runner = this.runners.get(name)
		if (!runner) throw new FatalDispatchError(`node type "${contract?.type}" pins subagent engine "${name}", but no runner is registered for it (wire it into the worker's runners map)`)
		return runner
	}

	private async runSubagent(input: SubagentInput, contract?: TypeContract): Promise<SubagentResult> {
		// Per-node overrides declared on the type contract. Each falls back to the runner's configured
		// default (engine → SUBAGENT_ENGINE, model → SUBAGENT_MODEL, budget → SUBAGENT_MAX_BUDGET_USD)
		// when the type declares none, and an override already set on `input` still wins over the contract.
		const runner = this.runnerFor(contract)
		const merged: SubagentInput = {
			...input,
			model: input.model ?? contract?.model,
			maxBudgetUsd: input.maxBudgetUsd ?? contract?.maxBudgetUsd,
		}
		const t0 = Date.now()
		const result = await this.runWithWatchdog(runner, merged)
		const elapsed = Date.now() - t0
		// 0009: surface a slow-but-completed call so a laggy produce is visible, not buried in timing.
		if (this.config.subagentWarnMs !== undefined && elapsed > this.config.subagentWarnMs) {
			this.log.warn("subagent.slow", { engine: runner.engine, skill: merged.skill, ms: elapsed, warnMs: this.config.subagentWarnMs })
		}
		if (runner.engine !== "fake") this.realCalls++
		// Stamp which backend actually ran, so the interaction log + node metadata record the per-node
		// engine rather than always the default. The runner may also report it on the result itself.
		return { ...result, engine: result.engine ?? runner.engine }
	}

	// 0009: enforce a per-call wall-clock budget. Without one, a `claude -p` produce that does not
	// terminate (one ran ~32 min) silently blocks the whole production. When subagentTimeoutMs is set,
	// race the run against a timer; on timeout, abort the call (an adapter that honors the signal kills
	// its child) and reject, so dispatch treats it as a failure (retried, then fails — 0001). No timeout
	// configured → run unchanged, no signal.
	private async runWithWatchdog(runner: SubagentRunner, input: SubagentInput): Promise<SubagentResult> {
		const ms = this.config.subagentTimeoutMs
		if (ms === undefined) return runner.run(input)
		const controller = new AbortController()
		let timer: ReturnType<typeof setTimeout> | undefined
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				controller.abort()
				reject(new Error(`subagent call exceeded ${ms}ms wall-clock budget (skill=${input.skill ?? "?"}, engine=${runner.engine})`))
			}, ms)
		})
		try {
			return await Promise.race([runner.run({ ...input, signal: controller.signal }), timeout])
		} finally {
			if (timer) clearTimeout(timer)
		}
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
		let started = false
		for (const root of queued) {
			const contract = this.types.get(root.type)
			// Intake resolution: a required input with no provided value AND no default must be asked
			// before the production starts. Emit a question (once) and HOLD — don't produce on incomplete
			// inputs. The production resumes once the params are supplied (then `missing` is empty).
			const missing = (contract.inputs ?? []).filter(
				(i) => i.required && i.default === undefined && (root.params == null || root.params[i.name] === undefined),
			)
			if (missing.length > 0) {
				const pending = await this.store.pendingOutputs(root.id)
				if (!pending.some((o) => o.type === "question")) {
					await this.store.emitOutput({
						productionId: root.id,
						accountId: root.accountId ?? undefined,
						userId: root.userId ?? undefined,
						type: "question",
						prompt: `To start this ${contract.name ?? root.type}, provide: ${missing.map((m) => (m.description ? `${m.name} (${m.description})` : m.name)).join("; ")}.`,
					})
				}
				continue // held until the required inputs are provided — does NOT count as progress (a held
				// production must not keep runUntilIdle draining, or the tick safety valve trips every poll)
			}
			// A production is a root node of ANY type, not only an expand video-project. Route it by kind:
			// an expand root fans its checklist; a planner/leaf root (a standalone capability — a scene, a
			// clip, a one-shot sfx) is dispatched directly, marked in-progress first (the claim a non-root
			// node would get) so it isn't re-claimed this tick.
			if (contract.checklist && contract.checklist.length > 0) {
				await this.expandNode(root)
			} else {
				await this.store.updateNodeStatus(root.id, "in-progress")
				await this.dispatch(root)
			}
			started = true
		}
		return started
	}

	// Expand a node's static checklist into child nodes (the root at startup, or any claimed node whose
	// type declares a checklist — e.g. a scene fanning into shots). Children's deps are resolved within
	// the checklist. The node goes in-progress and rolls up when its children are approved.
	private async expandNode(node: Node): Promise<void> {
		const contract = this.types.get(node.type)
		if (!contract.checklist || contract.checklist.length === 0) {
			throw new Error(`expandNode: type "${node.type}" has no checklist to expand`)
		}
		// Idempotent: if this node already has children, it was expanded before — a worker restart, a
		// re-claim, or a critic REOPEN that named a checklist node all route it back through dispatch.
		// Creating a second child set is the duplicate-stage bug. Just ensure it's in-progress so rollup
		// resumes over the existing children. (Mirrors the reopen path's own hasChildren guard, line ~594.)
		const existing = (await this.store.nodesFor(node.productionId)).filter((n) => n.parentId === node.id)
		if (existing.length > 0) {
			if (node.status !== "in-progress") await this.store.updateNodeStatus(node.id, "in-progress")
			this.log.info("node.expand_skip_existing", { productionId: node.productionId, nodeId: node.id, children: existing.length })
			return
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
		if (contract.plansProduction) {
			await this.dispatchProductionPlan(node, contract)
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
		const result = await this.runSubagent(
			{
				prompt: plannerPrompt,
				skill: contract.skill ?? node.type,
				cwd: this.config.craftRoot,
				resumeSessionId: latest?.subagent?.sessionId,
			},
			contract,
		)
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
			subagent: { runId: randomUUID(), status: "done", sessionId: result.sessionId, engine: result.engine ?? this.runner.engine, model: result.model },
		})
		await this.logInteraction(node, version.id, "producer", result, Date.now() - t0, plannerPrompt)

		const childType = contract.childType
		const childName = this.types.has(childType) ? (this.types.get(childType).name ?? childType) : childType
		// 0027: a diverseChildren planner (e.g. brainstorm) rotates the configured FANOUT_MODEL_MIX across
		// its fanned children, so the N idea agents run on different models ("different sensibilities in the
		// room"). Off / empty mix → undefined model → each child inherits the childType's model (unchanged).
		const mix = contract.diverseChildren ? (this.config.fanoutModelMix ?? []) : []
		if (mix.length) log.info("node.fanout_model_mix", { mix, children: planned.length })
		await this.store.createChildNodes(
			node.id,
			planned.map((c, i) => ({ type: childType, name: c.name || `${childName} ${i + 1}`, description: c.brief, deps: node.deps, position: i, model: mix.length ? mix[i % mix.length] : undefined })),
		)
		await this.store.updateNodeStatus(node.id, "in-progress")
		log.info("node.plan", { versionId: version.id, children: planned.length })
	}

	// Production-plan dispatch (materialize the frozen spine): a plansProduction node runs a planner
	// subagent that returns the production's whole pipeline as an ordered stage DAG (parseProductionDag),
	// which the engine freezes into SIBLING nodes under the ROOT — not children fanned under this node
	// (that is dispatchPlan). The root's own id IS the productionId, so passing node.productionId as the
	// parent arg to createChildNodes parents each stage to the root; the root then rolls up when the
	// materialized stages approve. Each stage's deps are stage KEYS resolved to the created siblings' node
	// ids, so stages are created one-per-call in order (a batch can't reference ids that don't exist yet).
	// The plan node is approved once the spine is laid — like dispatchPlan, the materialized children carry
	// the gate from here. Bookkeeping (version/artifact/interaction) mirrors dispatchPlan.
	private async dispatchProductionPlan(node: Node, contract: TypeContract): Promise<void> {
		const root = await this.store.getProduction(node.productionId)
		if (!root) throw new Error(`dispatchProductionPlan: production ${node.productionId} missing`)
		const log = this.log.child({ productionId: node.productionId, nodeId: node.id, type: node.type })
		log.info("node.dispatch")

		const upstream = await this.collectUpstream(node)
		const priorVersions = await this.store.versionsFor(node.id)
		const latest = priorVersions.at(-1)
		const n = (latest?.n ?? 0) + 1

		// Prior feedback: when this node is re-dispatched after a presented ask (an earlier tick HELD on a
		// cost fork), the latest version is denied+feedback — the client's ANSWER. Thread it into the prompt
		// so the planner resolves the fork and emits the stages (mirrors dispatchLeaf's revision-context read).
		const feedback = latest?.status === "denied" ? (latest.feedback ?? undefined) : undefined

		const t0 = Date.now()
		const planPrompt = buildProductionPlanPrompt(contract, { brief: root.description ?? "", upstream, autonomyLever: root.autonomyLever ?? undefined, feedback })
		const result = await this.runSubagent(
			{
				prompt: planPrompt,
				skill: contract.skill ?? node.type,
				cwd: this.config.craftRoot,
				resumeSessionId: latest?.subagent?.sessionId,
			},
			contract,
		)
		const parsed = parseProductionPlanOutput(result.output)

		// Autonomy gate (§5): on low/medium the planner MAY ASK the client about a paid/tier capability fork
		// BEFORE freezing. Present the question as an `options` chat_output and HOLD — nothing materializes
		// until the client answers. On high the planner must DECIDE within the brief + registry, so an ask is
		// a contract violation: throw (a held production with no one to answer is worse than a visible error).
		if (parsed.kind === "ask") {
			if (root.autonomyLever === "high") {
				throw new FatalDispatchError(`dispatchProductionPlan: planner asked on "high" autonomy — on high it must decide and emit stages, not ask (${parsed.prompt})`)
			}
			const askArtifact = writeArtifact(this.config.artifactsDir, node.productionId, node.type, n, result.output)
			const askVersion = await this.store.createVersion({
				nodeId: node.id,
				n,
				prevVersionId: latest?.id,
				status: "presentable", // "presentable" is the version's present status; the NODE goes needs-presentation below
				artifactPath: askArtifact,
				builtFrom: await this.computeBuiltFrom(node),
				subagent: { runId: randomUUID(), status: "done", sessionId: result.sessionId, engine: result.engine ?? this.runner.engine, model: result.model },
			})
			await this.logInteraction(node, askVersion.id, "producer", result, Date.now() - t0, planPrompt)
			// The present→feedback resume path (mirrors dispatchLeaf's present): the output carries THIS node
			// + version, so the client's submit_feedback flips the version to denied+feedback and the node to
			// pending (gate.ts); the next tick re-dispatches this node, reads that feedback (above), and the
			// planner now emits the stages instead of asking again.
			await this.store.emitOutput({
				productionId: node.productionId,
				nodeId: node.id,
				versionId: askVersion.id,
				accountId: root.accountId ?? undefined,
				userId: root.userId ?? undefined,
				type: "options",
				prompt: parsed.prompt,
				options: parsed.options,
			})
			await this.store.updateNodeStatus(node.id, "needs-presentation")
			log.info("node.plan_production_ask", { versionId: askVersion.id, options: parsed.options.length })
			return
		}

		const stages = parsed.stages

		// Materialize each stage as a sibling under the root. Base the position past the root's existing
		// direct children (the static checklist siblings — briefing, this plan node, …) so the spine does
		// not collide with them. Resolve each stage's dep keys to earlier siblings' real node ids as we go.
		const idByKey = new Map<string, string>() // stage key → created node id
		const base = (await this.store.nodesFor(node.productionId)).filter((s) => s.parentId === node.productionId).length
		for (const [i, s] of stages.entries()) {
			const resolved = s.deps.map((k) => idByKey.get(k)).filter((x): x is string => Boolean(x))
			// 0012: a spine ENTRY stage (no in-spine deps) would otherwise collectUpstream nothing and run on
			// the bare brief — cut off from the winning concept + emphasis the brainstorm produced. Seed the
			// roots with the plan node's OWN upstream (the same inheritance dispatchPlan gives its children),
			// so script/moodboard see the concept; downstream stages inherit it transitively through them.
			const deps = resolved.length > 0 ? resolved : node.deps
			const [created] = await this.store.createChildNodes(node.productionId, [
				{
					type: s.type,
					name: s.id,
					description: s.binding ? JSON.stringify(s.binding) : undefined,
					deps,
					position: base + i,
				},
			])
			if (!created) throw new Error("dispatchProductionPlan: createChildNodes returned no row")
			idByKey.set(s.id, created.id)
		}

		// Record the frozen DAG as an approved version (auditable, like dispatchPlan's plan version) and
		// approve the plan node — the materialized spine carries the gate from here.
		const artifactPath = writeArtifact(this.config.artifactsDir, node.productionId, node.type, n, result.output)
		const version = await this.store.createVersion({
			nodeId: node.id,
			n,
			prevVersionId: latest?.id,
			status: "approved",
			artifactPath,
			builtFrom: await this.computeBuiltFrom(node),
			subagent: { runId: randomUUID(), status: "done", sessionId: result.sessionId, engine: result.engine ?? this.runner.engine, model: result.model },
		})
		await this.logInteraction(node, version.id, "producer", result, Date.now() - t0, planPrompt)
		await this.store.updateNodeStatus(node.id, "approved")
		log.info("node.plan_production", { versionId: version.id, stages: stages.length })
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
		if (contract.produces === "file") {
			// A file-output leaf is produced by a WORKER running the type's skill (skills + tools, spec 09),
			// not by engine code. Stage the upstream artifacts into a work dir, dispatch the worker from
			// craftRoot (its .claude/skills), and capture the file it writes. The engine owns no renderer —
			// the craft skills do. Generic: no video knowledge here (the type names its skill + staging).
			// Include node.id: sibling nodes of the same type (fanned-out scenes) must not share a work dir.
			const workDir = join(this.config.artifactsDir, node.productionId, `${node.type}-${node.id}-v${n}`)
			mkdirSync(workDir, { recursive: true })
			// A board-dir producer (e.g. a composed-board assembler) writes its shared files — plates/,
			// fonts/, and its output file — into a stable <prod>/board dir, referenced by absolute path so
			// the downstream render reads them from any work dir. Create it and hand the path to the skill.
			let boardDir: string | undefined
			if (contract.boardDir) {
				boardDir = join(this.config.artifactsDir, node.productionId, "board")
				mkdirSync(join(boardDir, "plates"), { recursive: true })
				mkdirSync(join(boardDir, "fonts"), { recursive: true })
			}
			const stagedUpstream = stageUpstreamArtifacts(workDir, upstream)
			// Also stage any caller-provided assets (b-roll / audio / logo …) so an edit/compose leaf can
			// use real footage. Harmless for others — extra staged files are simply unused.
			const stagedAssets = stageAssets(workDir, await this.store.assetsFor(node.productionId))
			// A compositor leaf (e.g. assemble) stages the production's approved <type> artifacts (e.g. the
			// scene clips) into <workDir>/<into>/NN-<name>.<ext>, in order, so its skill stitches them.
			if (contract.collectArtifacts) {
				const { type: ct, into } = contract.collectArtifacts
				const sources = (await this.store.nodesFor(node.productionId))
					.filter((x) => x.type === ct && x.status === "approved")
					.sort((a, b) => a.position - b.position)
				const items: { name: string; path: string }[] = []
				for (const sn of sources) {
					const sv = await this.store.latestVersion(sn.id)
					if (sv?.artifactPath) items.push({ name: sn.name ?? sn.id, path: sv.artifactPath })
				}
				stageCollectedArtifacts(workDir, into, items)
			}
			producerPrompt = buildRenderedPrompt(contract, { brief: root.description ?? "", workDir, feedback, assets: stagedAssets, boardDir, upstreamFiles: stagedUpstream })
			producerResult = await this.runSubagent(
				{
					prompt: producerPrompt,
					skill: contract.skill ?? node.type, // the type names its skill; no video default in the engine
					model: node.model ?? undefined, // 0027: per-node model override (diversity-mix idea agent); undefined → the type model
					cwd: this.config.craftRoot,
				},
				contract,
			)
			// Capture the file the skill wrote. A type that declares `output` names the exact file (looked up
			// in the board dir when boardDir is set, else the work dir) — so a non-media file, e.g. a composed
			// film.json, is captured AT THE SOURCE and a downstream dependent stages the real structured file,
			// not the producer's stdout. Otherwise take the newest media. If the skill wrote NONE — e.g. a
			// keyless generative leaf that can only emit a spec — fall back to recording the skill's text
			// output, so the node still produces a reviewable artifact instead of failing the whole production.
			// Downstream (assemble / the reviewers) surface a genuinely missing file where it matters.
			let declaredOut: string | undefined
			if (contract.output) {
				const candidates = [boardDir ? join(boardDir, contract.output) : undefined, join(workDir, contract.output)]
				declaredOut = candidates.find((p) => p !== undefined && existsSync(p))
			}
			const outFile = declaredOut ?? newestMedia(workDir)
			if (outFile) {
				artifactPath = outFile
				// Binary artifact: never read into a reviewer prompt. A text descriptor stands in.
				draft = `[file ${node.type}] ${outFile}`
			} else {
				draft = producerResult.output
				artifactPath = writeArtifact(this.config.artifactsDir, node.productionId, await this.artifactBase(node), n, draft)
			}
		} else {
			let boardOut: string | undefined
			if (contract.emitsBoard) {
				const base = await this.artifactBase(node)
				boardOut = join(this.config.artifactsDir, node.productionId, "boards", `${base}-v${n}.jpg`)
				mkdirSync(join(this.config.artifactsDir, node.productionId, "boards"), { recursive: true })
			}
			let boardDir: string | undefined
			if (contract.boardDir) {
				boardDir = join(this.config.artifactsDir, node.productionId, "board")
				mkdirSync(join(boardDir, "plates"), { recursive: true })
				mkdirSync(join(boardDir, "fonts"), { recursive: true })
			}
			producerPrompt = buildProducerPrompt(contract, { brief: root.description ?? "", upstream, nodeBrief: node.description ?? undefined, priorContent, feedback, boardOut, boardDir })
			producerResult = await this.runSubagent(
				{
					prompt: producerPrompt,
					skill: contract.skill ?? node.type,
					model: node.model ?? undefined, // 0027: per-node model override (diversity-mix idea agent); undefined → the type model
					cwd: this.config.craftRoot,
				},
				contract,
			)
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
				...(producerResult ? { sessionId: producerResult.sessionId, engine: producerResult.engine ?? this.runner.engine, model: producerResult.model } : {}),
			},
		})
		if (producerResult) await this.logInteraction(node, version.id, "producer", producerResult, producerMs, producerPrompt)
		log.info("node.produce", { versionId: version.id, n, produces: contract.produces ?? "text", ms: producerMs })

		// internal quality gate — independent specialist reviewers.
		// 0021: on a redo, carry forward an axis that already PASSED on the prior version instead of
		// re-spending a reviewer call to re-confirm an input that did not change — run only the axes that
		// were failing. The prior verdicts are read from the DB (the prior version's review rows), so this
		// is restart-safe and needs no in-memory loop state (each redo is a fresh dispatchLeaf call). The
		// carried pass is recorded on THIS version too, so a further redo can carry it again.
		const priorPassed =
			latest && latest.status === "needs-work"
				? new Set((await this.store.reviewsFor(latest.id)).filter((r) => r.verdict === "pass").map((r) => r.name))
				: new Set<string>()
		const verdicts: ("pass" | "revise")[] = []
		const roundReviews: { name: string; verdict: "pass" | "revise"; body: string }[] = [] // 0020: each axis's verdict + body, to detect a repeated unfixable finding
		for (const rv of contract.reviews ?? []) {
			if (n > 1 && priorPassed.has(rv.name)) {
				await this.store.addReview({ nodeId: node.id, versionId: version.id, name: rv.name, kind: rv.kind, verdict: "pass", body: "[carried forward (0021): this axis passed on the prior version and its input was not re-reviewed on this redo]" })
				verdicts.push("pass")
				roundReviews.push({ name: rv.name, verdict: "pass", body: "" })
				log.debug("review.carry_forward", { versionId: version.id, reviewer: rv.name, kind: rv.kind })
				continue
			}
			const rt0 = Date.now()
			const reviewPrompt = buildReviewerPrompt(contract, rv, { draft, brief: root.description ?? "", upstream, nodeBrief: node.description ?? undefined })
			const rres = await this.runSubagent(
				{
					prompt: reviewPrompt,
					skill: rv.skill ?? `review:${rv.kind}`, // a reviewer skill (per-step rubric) if declared, else the kind label (generic lens, no directive)
					model: rv.model ?? node.model ?? undefined, // 0021 per-axis override, else 0027 per-node model, else the type model (runSubagent)
					cwd: this.config.craftRoot,
				},
				contract,
			)
			await this.logInteraction(node, version.id, `review:${rv.kind}`, rres, Date.now() - rt0, reviewPrompt)
			const verdict = parseVerdict(rres.output)
			await this.store.addReview({ nodeId: node.id, versionId: version.id, name: rv.name, kind: rv.kind, verdict, body: rres.output })
			verdicts.push(verdict)
			roundReviews.push({ name: rv.name, verdict, body: rres.output })
			log.debug("review.verdict", { versionId: version.id, reviewer: rv.name, kind: rv.kind, verdict })
		}

		const advisory = contract.advisoryReview === true
		if (advisory || verdicts.every((v) => v === "pass")) {
			this.nearPassStreak.delete(node.id)
			this.noProgressStreak.delete(node.id)
			await this.present(node, contract, version.id, root, log)
			return
		}

		// Convergence: with 3+ reviewers a genuinely good deliverable can oscillate — each round one
		// reviewer dissents on a different nit — and never get a unanimous pass. If a version passes
		// all-but-one reviewer for `convergeAfter` CONSECUTIVE rounds, accept it rather than grind to
		// the redo cap. A worse result (more than one dissent) resets the streak, so weak work (which
		// never sustains an all-but-one pass) still never converges here — it escalates below.
		const passCount = verdicts.filter((v) => v === "pass").length
		if (verdicts.length >= 3 && passCount >= verdicts.length - 1) {
			const streak = (this.nearPassStreak.get(node.id) ?? 0) + 1
			this.nearPassStreak.set(node.id, streak)
			if (streak >= this.config.convergeAfter) {
				this.nearPassStreak.delete(node.id)
				this.noProgressStreak.delete(node.id)
				log.info("node.converge", { versionId: version.id, passCount, of: verdicts.length, streak })
				await this.present(node, contract, version.id, root, log)
				return
			}
		} else {
			this.nearPassStreak.delete(node.id)
		}

		// a reviewer said revise — never shown to the user
		await this.store.updateVersion(version.id, { status: "needs-work" })
		const redosSoFar = priorVersions.filter((v) => v.status === "needs-work").length + 1

		// 0020: no-progress escape. If the failing finding repeats UNCHANGED across rounds, the producer is
		// not converging — a defect scoped above this node (e.g. a missing licensed font a card can't add).
		// Escalate early with the finding rather than grind to maxRedos re-rendering the identical defect
		// and force-approving a known-bad version at the cap. The signature is the failing axes + their
		// normalized bodies; exact-match is deliberately strict (bias to NOT escalating a genuinely-changing
		// finding — it fires only when the reviewer essentially repeats itself). The fuller fix (a reviewer
		// "escalate" verdict + lever-gated auto-degrade per docs/lisa/font-resolution.md) is deferred with
		// the 0010/0013 agent-ask channel; this is the engine backstop that stops the grind.
		const failing = roundReviews.filter((r) => r.verdict === "revise")
		const sig = failing
			.map((r) => `${r.name}:${r.body.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 240)}`)
			.sort()
			.join("|")
		const prevNP = this.noProgressStreak.get(node.id)
		const npStreak = prevNP && prevNP.sig === sig ? prevNP.n + 1 : 1
		this.noProgressStreak.set(node.id, { sig, n: npStreak })
		if (sig !== "" && npStreak >= this.config.noProgressAfter) {
			this.noProgressStreak.delete(node.id)
			const axes = failing.map((r) => r.name).join(", ")
			const reason = `no progress: the "${axes}" review finding repeated unchanged for ${npStreak} rounds and this node can't resolve it — escalated instead of grinding to the redo cap (0020)`
			log.warn("node.no_progress", { versionId: version.id, streak: npStreak, axes: failing.map((r) => r.name) })
			await this.present(node, contract, version.id, root, log, reason)
			return
		}

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

		// When a human submits feedback on this review's present, gate.ts denies the version + stores the
		// feedback and re-dispatches us. Thread it in as a directive so the critic reopens the step the
		// feedback is about instead of re-grading the same render to a pass (issue 0037).
		const feedback = latest?.status === "denied" ? (latest.feedback ?? undefined) : undefined

		const t0 = Date.now()
		const holisticPrompt = buildHolisticPrompt(contract, { brief: root.description ?? "", upstream, feedback })
		const result = await this.runSubagent(
			{
				prompt: holisticPrompt,
				skill: contract.skill ?? "final-review",
				cwd: this.config.craftRoot,
				resumeSessionId: latest?.subagent?.sessionId,
			},
			contract,
		)
		const draft = result.output
		const artifactPath = writeArtifact(this.config.artifactsDir, node.productionId, node.type, n, draft)
		const version = await this.store.createVersion({
			nodeId: node.id,
			n,
			prevVersionId: latest?.id,
			status: "producing",
			artifactPath,
			builtFrom: await this.computeBuiltFrom(node),
			subagent: { runId: randomUUID(), status: "done", sessionId: result.sessionId, engine: result.engine ?? this.runner.engine, model: result.model },
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
		// 0010: on full autonomy the engine must not block on a human. A `high` production auto-approves
		// every presented leaf in place (it then rolls up) instead of emitting a present and holding —
		// EXCEPT the holistic final review, which stays a human gate on every lever, so the finished video
		// never ships without human sight. `low`/`medium` present as before.
		if (root.autonomyLever === "high" && !contract.holisticReview) {
			// Auto-approved by the engine (no human). A caveat means it was forced past unresolved review.
			await this.store.updateVersion(versionId, { status: "approved", approvedBy: caveat ? "agent-escalated" : "agent" })
			await this.store.updateNodeStatus(node.id, "approved")
			log.info("node.auto_approved", { versionId, lever: "high", escalation: Boolean(caveat) })
			return
		}
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
			engine: result.engine ?? this.runner.engine,
			model: result.model,
			sessionId: result.sessionId,
			inputTokens: result.usage?.inputTokens,
			outputTokens: result.usage?.outputTokens,
			cacheReadTokens: result.usage?.cacheReadTokens,
			cacheCreationTokens: result.usage?.cacheCreationTokens,
			costUsd: result.usage?.costUsd,
			durationMs,
			numTurns: result.numTurns,
			apiDurationMs: result.apiDurationMs,
			status: "done",
		})
	}

	private async collectUpstream(node: Node): Promise<UpstreamArtifact[]> {
		const out: UpstreamArtifact[] = []
		// A dep's artifact may be binary (a rendered .mp4). Never put raw bytes in a subagent prompt
		// (null bytes crash the CLI); hand down a descriptor instead. Text artifacts pass through.
		const push = (type: string, path: string | null | undefined, content: string) =>
			out.push({ type, content: content.includes("\0") ? `[binary ${type} artifact: ${path ?? "?"}]` : content, artifactPath: path ?? undefined })
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
		if (contract.produces === "file" || sensitive.length === 0) {
			await this.store.updateVersion(latest.id, { status: "superseded" })
			log.info("node.revalidate_rebuild", { reason: contract.produces === "file" ? "mechanical" : "no-upstream-reviewer" })
			return false
		}

		const root = await this.store.getProduction(node.productionId)
		const draft = readArtifact(latest.artifactPath ?? null) ?? ""
		const upstream = await this.collectUpstream(node)
		const revise: string[] = []
		for (const rv of sensitive) {
			const rt0 = Date.now()
			const reviewPrompt = buildReviewerPrompt(contract, rv, { draft, brief: root?.description ?? "", upstream, nodeBrief: node.description ?? undefined, revalidation: true })
			const rres = await this.runSubagent(
				{
					prompt: reviewPrompt,
					skill: rv.skill ?? `review:${rv.kind}`,
					cwd: this.config.craftRoot,
				},
				contract,
			)
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
		const result = await this.runSubagent(
			{
				prompt: plannerPrompt,
				skill: contract.skill ?? node.type,
				cwd: this.config.craftRoot,
				resumeSessionId: latest.subagent?.sessionId,
			},
			contract,
		)
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
			subagent: { runId: randomUUID(), status: "done", sessionId: result.sessionId, engine: result.engine ?? this.runner.engine, model: result.model },
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

// Stage a file-leaf's upstream artifacts into its work dir for its skill to read. A file-artifact
// upstream (produces:"file" — e.g. a composed board's captured film.json) is copied in under its own
// basename, so the skill reads the REAL structured file, never the producer's stdout. A text artifact
// is written as <type>.txt beside it. Generic: the engine names no film.json/script.txt — the type's
// skill owns what its input file is called and how to read it.
function stageUpstreamArtifacts(workDir: string, upstream: UpstreamArtifact[]): string[] {
	const staged: string[] = []
	for (const u of upstream) {
		if (u.artifactPath && !u.content.startsWith("[binary ") && existsSync(u.artifactPath)) {
			try {
				const name = basename(u.artifactPath) // unique per node, so same-type siblings (cards) don't clobber
				copyFileSync(u.artifactPath, join(workDir, name))
				staged.push(name)
				continue
			} catch {
				// fall through and write the text content instead
			}
		}
		if (u.content.includes("\0")) continue // never stage raw bytes
		const name = `${u.type}.txt`
		writeFileSync(join(workDir, name), u.content, "utf8")
		staged.push(name)
	}
	return staged
}

// Stage caller-provided assets (video/audio/images) into the work dir by copying each from its
// storagePath, so an edit/compose leaf's worker can use real footage. Returns the staged basenames
// (named in the prompt). A missing/unreadable asset is skipped — the producer reports an absent input.
export function stageAssets(workDir: string, assets: readonly { storagePath: string }[]): string[] {
	const staged: string[] = []
	for (const a of assets) {
		try {
			const dest = basename(a.storagePath)
			copyFileSync(a.storagePath, join(workDir, dest))
			staged.push(dest)
		} catch {
			// skip; the producer surfaces a genuinely-needed input that is absent
		}
	}
	return staged
}

// Copy a compositor leaf's collected artifacts into <workDir>/<into>/NN-<name>.<ext>, in the order
// given, so its skill stitches them (e.g. assemble composing the scene clips). Returns the staged
// relative paths. Missing source files are skipped (a keyless scene that produced a spec, not a clip),
// so the skill sees exactly the clips that exist and reports the rest as not-yet-generated.
export function stageCollectedArtifacts(workDir: string, into: string, items: readonly { name: string; path: string }[]): string[] {
	const dir = join(workDir, into)
	mkdirSync(dir, { recursive: true })
	const staged: string[] = []
	items.forEach((it, i) => {
		if (!existsSync(it.path)) return
		const ext = extname(it.path) || ".bin"
		const rel = `${into}/${String(i + 1).padStart(2, "0")}-${it.name}${ext}`
		copyFileSync(it.path, join(workDir, rel))
		staged.push(rel)
	})
	return staged
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

const OTHER_MEDIA_EXT = [".mov", ".webm", ".mkv", ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"]

// The media file a rendered leaf's skill produced: prefer the newest .mp4 (render/assemble always
// write one), else the newest other media (an edit/compose leaf may output audio). Render behavior is
// unchanged — a work dir with an .mp4 always resolves to it.
export function newestMedia(dir: string): string | null {
	const mp4 = newestMp4(dir)
	if (mp4) return mp4
	let best: string | null = null
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
			else if (OTHER_MEDIA_EXT.some((x) => e.name.toLowerCase().endsWith(x))) {
				const t = statSync(p).mtimeMs
				if (t > bestT) {
					bestT = t
					best = p
				}
			}
		}
	}
	walk(dir)
	return best
}

// The render leaf's task prompt: point the worker at the staged work dir; the /render-film skill (the
// directive the runner injects) owns the steps (extract the script, run make-film, write the .mp4).
export function buildRenderedPrompt(_contract: TypeContract, a: { brief: string; workDir: string; feedback?: string; assets?: string[]; boardDir?: string; upstreamFiles?: string[] }): string {
	// Generic: the engine names no film.json/storyboard. The type's skill (the directive the runner
	// injects) owns what its staged input files are and how to read them; the engine only points at the
	// dirs + lists the staged files, and keeps the exact "Work dir: <path>" phrase the worker reads.
	const lines = [`Produce the finished artifact for this node.`]
	lines.push(`Work dir: ${a.workDir} — the approved upstream artifacts are staged there. Write the produced file into that same work dir.`)
	if (a.upstreamFiles?.length) lines.push(`Upstream artifacts staged in the work dir: ${a.upstreamFiles.join(", ")}. Read what you need from these files.`)
	if (a.boardDir) lines.push(`Shared board dir: ${a.boardDir} — write shared files (plates/, fonts/) here and reference them from your output by ABSOLUTE path, so the render resolves them from any work dir.`)
	if (a.assets?.length) lines.push(`Provided assets staged in the work dir: ${a.assets.join(", ")}.`)
	lines.push(`Brief: ${a.brief}`)
	if (a.feedback) lines.push(`Revision feedback to address this round:\n${a.feedback}`)
	return lines.filter(Boolean).join("\n\n")
}
