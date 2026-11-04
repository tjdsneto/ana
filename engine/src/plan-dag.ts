export interface PlannedStage { id: string; type: string; deps: string[]; binding?: Record<string, unknown> }

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
