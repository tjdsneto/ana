export interface PlannedStage { id: string; type: string; deps: string[]; binding?: Record<string, unknown> }

// A plansProduction planner's output is one of two shapes. Either it FREEZES the pipeline — a stage DAG
// (see parseProductionDag) — or, on low/medium autonomy, it ASKS the client about a paid/tier capability
// fork BEFORE freezing: an {"ask":{"prompt":string,"options":string[]}} block. The gate in the loop (the
// autonomy lever) decides which is allowed. This parser classifies the output so that gate can branch.
export type ProductionPlanOutput = { kind: "ask"; prompt: string; options: string[] } | { kind: "stages"; stages: PlannedStage[] }

// Prefer an explicit ask block (the planner's FIRST json block is {"ask":{…}}); otherwise treat the
// output as the stage DAG. The ask is parsed leniently — a malformed first block simply falls through to
// the stage parser, which fails loudly if the output is neither a well-formed ask nor a valid DAG.
export function parseProductionPlanOutput(output: string): ProductionPlanOutput {
	const m = output.match(/```json\s*([\s\S]*?)```/) ?? output.match(/(\{[\s\S]*\})/)
	if (m?.[1]) {
		let doc: unknown
		try {
			doc = JSON.parse(m[1])
		} catch {
			doc = undefined
		}
		const ask = (doc as { ask?: { prompt?: unknown; options?: unknown } } | undefined)?.ask
		if (ask && typeof ask.prompt === "string" && Array.isArray(ask.options)) {
			return { kind: "ask", prompt: ask.prompt, options: ask.options.filter((o): o is string => typeof o === "string") }
		}
	}
	return { kind: "stages", stages: parseProductionDag(output) }
}

export function parseProductionDag(output: string): PlannedStage[] {
	const m = output.match(/```json\s*([\s\S]*?)```/) ?? output.match(/(\{[\s\S]*\})/)
	const json = m?.[1]
	if (!json) throw new Error("parseProductionDag: no JSON block in planner output")
	const doc = JSON.parse(json) as { stages?: PlannedStage[] }
	const stages = doc.stages ?? []
	if (stages.length === 0) throw new Error("parseProductionDag: empty stages")
	const seen = new Set<string>()
	for (const s of stages) {
		if (!s.id || !s.type) throw new Error("parseProductionDag: stage missing id/type")
		for (const d of s.deps ?? []) if (!seen.has(d)) throw new Error(`parseProductionDag: dep "${d}" is not an earlier stage id`)
		seen.add(s.id)
	}
	return stages.map((s) => ({ ...s, deps: s.deps ?? [] }))
}
