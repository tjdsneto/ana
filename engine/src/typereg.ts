// Type registry — node behavior lives on disk, resolved by node.type (spec 01). Each type is a
// directory holding type.json. The loop is generic; this is the only place the craft pipeline is
// declared. Load from AUTONOMY_TYPES_DIR (default server/engine/types), or build in-memory for tests.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

export interface ChecklistEntry {
	id: string // checklist-local key; deps reference these, resolved to node ids on expand
	type: string
	deps?: string[]
	when?: string
	role?: string
}

export interface ReviewSpec {
	name: string
	kind: "craft" | "coverage" | "consistency" | "audio" // the axis: craft = quality, coverage = conformance-to-params, consistency = matches siblings, audio = deterministic VO/sync check
	skill?: string // reviewer skill that owns this axis's per-step rubric; omitted → generic kind lens (prompts.ts)
	model?: string // per-axis subagent model override (0021: run mechanical axes — coverage/consistency — on a cheaper model); falls back to the node's contract model, then SUBAGENT_MODEL
}

export interface InputSpec {
	name: string // the param key
	required?: boolean // a hard requirement: if absent and no default, intake asks the user (R3) rather than guessing
	default?: unknown // smart default used when the param is absent
	description?: string // what it is — shown by the MCP capability discovery (R4)
}

export interface TypeContract {
	type: string
	name?: string // human label for the node
	description?: string // one-line human/dev summary of what this node does in the pipeline; surfaced in capability discovery (loadCapabilities) for rootCapable types
	rootCapable?: boolean // offerable as a standalone production root (a capability a caller can ask for directly). Off by default, so internal plumbing (briefing, moodboard, build, …) is never exposed as a root. See InputSpec + requestProduction.
	inputs?: InputSpec[] // the intake param schema for a root-capable type: what a caller passes when rooting a production here. Resolution: passed value → default → (if required and absent) ask the user.
	checklist?: ChecklistEntry[] // static sub-project (expand)
	planner?: boolean // dynamic sub-project (plan) — v0-flat: not exercised
	childType?: string
	diverseChildren?: boolean // 0027: a planner whose fanned children get the config's FANOUT_MODEL_MIX rotated across them (per-node model diversity); off → children inherit this type's model
	plansProduction?: boolean // a planner that MATERIALIZES the production's sibling DAG (parseProductionDag) rather than fanning children of a childType
	produce?: string // producer instruction (the prompt seed)
	reviews?: ReviewSpec[] // the specialist reviewer set
	advisoryReview?: boolean // rollup/review never blocks (agreement types)
	agreement?: boolean // agreement-terminal (briefing): client approval is the gate, capped back-and-forth
	router?: boolean // emits VERDICT to gate a sibling — v0-flat: not exercised
	produces?: "file" | "text" // leaf artifact kind: "file" = a worker runs a skill in a staged work dir and the engine captures the file it writes (falling back to the skill's text when it writes none, e.g. a keyless generative leaf that can only emit a spec); "text" (default) = a plain text producer. Generic: no video knowledge — a type declares its own skill + staging.
	output?: string // produces:"file" leaf: the exact basename the skill writes, captured as the artifact (looked up in the board dir when boardDir is set, else the work dir). Absent → capture the newest media file. Lets a non-media file (e.g. a composed film.json) be captured at the source, so a downstream dependent stages the real structured file, not the producer's stdout.
	holisticReview?: boolean // final whole-production review: on revise it reopens named upstream nodes (approved → pending) + cascades, capped by maxGlobalRevisions
	skill?: string // producer skill name, or "self"
	exposeChildrenToDependents?: boolean // a fanned-out node (planner) whose approved children's artifacts are handed to nodes that depend on it — so a selector/judge sees the produced units, not just the plan. Opt-in: off by default, so a planner like `build` is unaffected.
	emitsBoard?: boolean // the producer renders a visual board (storyboard): the engine passes a boardOut path; the producer saves the board sheet there so the dashboard can show it per version.
	boardDir?: boolean // the producer writes the shared board files (plates/, fonts/): the engine passes a stable <prod>/board dir so assemble can materialize plate files + a shared font and reference them by absolute path from film.json.
	collectArtifacts?: { type: string; into: string } // a file-leaf that composes the production's approved <type> nodes (e.g. assemble composes scenes): the engine copies each approved node-of-that-type's file-artifact into <workDir>/<into>/NN-<name>.<ext>, ordered by position, so the skill stitches them. Generic: the engine names no domain type; the type.json names which.
	owns?: string[] // Option B (progressive film.json): the board/film.json keys this type's slice owns. A manifest-owning leaf's producer emits those keys as JSON; the engine writes them into the shared board/film.json and snapshots them as the node's artifact. A dependent's builtFrom hashes exactly these keys (per-slice), so it rebuilds only when the slice it consumes changes. See docs/lisa/progressive-film-json-design.md.
	reads?: string[] // Option B: the board/film.json keys this type CONSUMES. The node's builtFrom includes a per-key hash of these keys (independent of the node DAG), so a node like build-voice, nested far from the script node, still goes stale + rebuilds when the `script` slice it reads changes — without a fragile deep dep edge.
	engine?: string // per-node subagent backend for this type (producer + its reviewers), e.g. "claude" | "codex"; must be a runner registered with the worker. Falls back to SUBAGENT_ENGINE
	model?: string // per-node subagent model for this type (producer + its reviewers), e.g. "opus" for a brainstorm; falls back to SUBAGENT_MODEL
	maxBudgetUsd?: number // per-node per-call spend cap for this type's subagents; falls back to SUBAGENT_MAX_BUDGET_USD
}

export class TypeRegistry {
	private readonly byType = new Map<string, TypeContract>()

	private constructor(contracts: TypeContract[]) {
		for (const c of contracts) this.byType.set(c.type, c)
	}

	static fromContracts(contracts: TypeContract[]): TypeRegistry {
		return new TypeRegistry(contracts)
	}

	static load(dir: string): TypeRegistry {
		const contracts: TypeContract[] = []
		for (const entry of readdirSync(dir)) {
			const typeDir = join(dir, entry)
			if (!statSync(typeDir).isDirectory()) continue
			const contractPath = join(typeDir, "type.json")
			try {
				const parsed = JSON.parse(readFileSync(contractPath, "utf8")) as TypeContract
				contracts.push(parsed)
			} catch (err) {
				throw new Error(`type registry: failed to load ${contractPath}: ${(err as Error).message}`)
			}
		}
		if (contracts.length === 0) throw new Error(`type registry: no type.json found under ${dir}`)
		return new TypeRegistry(contracts)
	}

	get(type: string): TypeContract {
		const contract = this.byType.get(type)
		if (!contract) throw new Error(`type registry: unknown type "${type}"`)
		return contract
	}

	has(type: string): boolean {
		return this.byType.has(type)
	}

	// Every loaded contract — for whole-registry checks (e.g. the worker's boot skills self-check).
	all(): TypeContract[] {
		return [...this.byType.values()]
	}
}
