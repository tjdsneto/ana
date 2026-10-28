// Prompt construction for producers + reviewers. Plain string assembly — the SubagentRunner (fake
// or claude -p) consumes these. Kept separate so the craft wording lives in one place.

import type { ReviewSpec, TypeContract } from "./typereg.js"

export interface UpstreamArtifact {
	type: string
	content: string
}

export interface ProduceContext {
	brief: string
	upstream: UpstreamArtifact[]
	priorContent?: string // the version being revised
	feedback?: string // reviewer union or user feedback that drove this redo
}

export function buildProducerPrompt(contract: TypeContract, ctx: ProduceContext): string {
	const parts: string[] = []
	parts.push(contract.produce ?? `Produce the ${contract.type} deliverable.`)
	parts.push(`\n## Brief\n${ctx.brief}`)
	if (ctx.upstream.length > 0) {
		parts.push("\n## Approved upstream work")
		for (const u of ctx.upstream) parts.push(`\n### ${u.type}\n${u.content}`)
	}
	if (ctx.priorContent) {
		parts.push(`\n## Your previous version (revise it — do not start over)\n${ctx.priorContent}`)
	}
	if (ctx.feedback) {
		parts.push(`\n## Feedback to address\n${ctx.feedback}`)
	}
	return parts.join("\n")
}

export interface ReviewContext {
	draft: string
	brief: string
	upstream: UpstreamArtifact[]
}

export function buildReviewerPrompt(contract: TypeContract, review: ReviewSpec, ctx: ReviewContext): string {
	const lens: Record<ReviewSpec["kind"], string> = {
		craft: "Judge the deliverable on its own craft merits against the rubric.",
		coverage: "Check that every point from the brief and approved upstream work made it in.",
		consistency: "Check that it matches the design language and the sibling artifacts.",
	}
	const parts: string[] = []
	parts.push(`You are the "${review.name}" reviewer for a ${contract.type} deliverable. ${lens[review.kind]}`)
	parts.push("Respond with exactly one line: `VERDICT: pass` or `VERDICT: revise`, then (if revise) the specific, actionable fixes.")
	parts.push(`\n## Brief\n${ctx.brief}`)
	if (ctx.upstream.length > 0) {
		parts.push("\n## Approved upstream work")
		for (const u of ctx.upstream) parts.push(`\n### ${u.type}\n${u.content}`)
	}
	parts.push(`\n## Deliverable under review\n${ctx.draft}`)
	return parts.join("\n")
}

// Reviewer output → verdict. Fail-closed: anything that is not an explicit pass counts as revise, so
// a malformed reviewer never silently waves work through.
export function parseVerdict(output: string): "pass" | "revise" {
	const match = output.match(/VERDICT:\s*(pass|revise)/i)
	return match?.[1]?.toLowerCase() === "pass" ? "pass" : "revise"
}
