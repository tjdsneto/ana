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
}

export interface TypeContract {
	type: string
	name?: string // human label for the node
	checklist?: ChecklistEntry[] // static sub-project (expand)
	planner?: boolean // dynamic sub-project (plan) — v0-flat: not exercised
	childType?: string
	produce?: string // producer instruction (the prompt seed)
	reviews?: ReviewSpec[] // the specialist reviewer set
	advisoryReview?: boolean // rollup/review never blocks (agreement types)
	agreement?: boolean // agreement-terminal (briefing): client approval is the gate, capped back-and-forth
	router?: boolean // emits VERDICT to gate a sibling — v0-flat: not exercised
	rendered?: boolean // file-output leaf: a worker runs the render skill (writes a file artifact), not a text producer
	holisticReview?: boolean // final whole-production review: on revise it reopens named upstream nodes (approved → pending) + cascades, capped by maxGlobalRevisions
	skill?: string // producer skill name, or "self"
	exposeChildrenToDependents?: boolean // a fanned-out node (planner) whose approved children's artifacts are handed to nodes that depend on it — so a selector/judge sees the produced units, not just the plan. Opt-in: off by default, so a planner like `build` is unaffected.
	emitsBoard?: boolean // the producer renders a visual board (storyboard): the engine passes a boardOut path; the producer saves the board sheet there so the dashboard can show it per version.
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
}
