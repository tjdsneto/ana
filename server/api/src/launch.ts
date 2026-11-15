import type { RequestProductionInput } from "@core/services"
import type { AutonomyLever, Template } from "@core/shared"
import { composeBriefFromTemplate } from "./compose-brief.js"

export interface LaunchBody {
	template: Template
	productName: string
	angle: string
	autonomyLever?: AutonomyLever
}

const LEVERS = new Set(["low", "medium", "high"])

// Validate a launch request body and map it to a requestProduction input. Pure; throws on bad input.
export function buildLaunchInput(body: LaunchBody): RequestProductionInput {
	const productName = (body?.productName ?? "").trim()
	const angle = (body?.angle ?? "").trim()
	const t = body?.template
	if (!t?.slug || !t?.title || !Array.isArray(t?.storyboard)) throw new Error("invalid template")
	if (!productName) throw new Error("productName is required")
	if (!angle) throw new Error("angle is required")
	const autonomyLever = (body.autonomyLever ?? "high") as AutonomyLever
	if (!LEVERS.has(autonomyLever)) throw new Error("invalid autonomyLever")
	return {
		brief: composeBriefFromTemplate(t, { productName, angle }),
		sessionId: "web-app",
		actorKind: "human",
		autonomyLever,
		type: "video-project",
		params: { referenceSlug: t.slug, referenceTitle: t.title, productName, angle },
	}
}
