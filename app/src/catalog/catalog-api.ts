import type { AutonomyLever, Template } from "./types.js"

// The ONLY place that knows the catalog's data source. v1 = static committed JSON; swapping to a
// DB-backed GET /api/catalog later changes this function alone (design spec §5.3, F1 seam).
export async function getCatalog(): Promise<Template[]> {
	const res = await fetch("/catalog/catalog.json")
	if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`)
	return (await res.json()) as Template[]
}

// Pure client-side filter for the catalog grid.
export function filterTemplates(all: Template[], f: { tier?: string; tag?: string }): Template[] {
	return all.filter((t) => (f.tier ? t.tier === f.tier : true) && (f.tag ? t.tags.includes(f.tag) : true))
}

export interface LaunchInput {
	template: Template
	productName: string
	angle: string
	autonomyLever: AutonomyLever
}

export async function launchFromTemplate(input: LaunchInput): Promise<{ productionId: string }> {
	const res = await fetch("/api/productions", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	})
	const data = (await res.json().catch(() => ({}))) as { production_id?: string; error?: string }
	if (!res.ok) throw new Error(data.error ?? `launch failed: ${res.status}`)
	return { productionId: data.production_id ?? "" }
}
