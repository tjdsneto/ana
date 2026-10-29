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
	// A reviewer skill (if declared) owns the per-step rubric for this axis — the runner injects it as a
	// directive, so here we only name the role. Without a skill, fall back to the generic kind lens.
	parts.push(
		review.skill
			? `You are the "${review.name}" reviewer for a ${contract.type} deliverable. Judge it against your reviewer skill's rubric.`
			: `You are the "${review.name}" reviewer for a ${contract.type} deliverable. ${lens[review.kind]}`,
	)
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

// The holistic final review (final-review node) names which upstream STEP to reopen and why, one per
// line: `REOPEN: <type> — <reason>`. Parse them into {type, reason}. The engine resolves <type> to the
// production's node of that type and reopens it (+ cascades to its dependents). No REOPEN lines on a
// revise = the reviewer flagged problems but named nothing actionable; the engine then escalates
// rather than reopening blindly.
export interface ReopenTarget {
	type: string
	reason: string
}

export function parseReopen(output: string): ReopenTarget[] {
	const out: ReopenTarget[] = []
	for (const line of output.split("\n")) {
		const m = line.match(/^\s*REOPEN:\s*([a-zA-Z0-9_-]+)\s*(?:[—:-]\s*(.*))?$/)
		if (m?.[1]) out.push({ type: m[1], reason: (m[2] ?? "").trim() || "revised on whole-video review" })
	}
	return out
}

// The final-review producer prompt: the critic watches the finished (polished) video and either passes
// the whole production or names the steps to redo. The engine owns the output contract; the reviewer
// skill owns the good-video rubric.
export function buildHolisticPrompt(contract: TypeContract, ctx: { brief: string; upstream: UpstreamArtifact[] }): string {
	const parts: string[] = []
	parts.push(
		`You are the final whole-video reviewer for this ${contract.type}. Judge the finished video as a whole against your reviewer skill's good-video rubric — pacing, clarity, does it deliver the brief, do the parts play well together.`,
	)
	parts.push(
		"Respond with `VERDICT: pass` if it is ready for the human, or `VERDICT: revise` if a specific earlier step must be redone. On revise, add one line per fix: `REOPEN: <step> — <reason>` (step = the pipeline node to redo, e.g. moodboard, script, storyboard, render, polish). Name only the steps that must change.",
	)
	parts.push(`\n## Brief\n${ctx.brief}`)
	if (ctx.upstream.length > 0) {
		parts.push("\n## The finished video + its inputs")
		for (const u of ctx.upstream) parts.push(`\n### ${u.type}\n${u.content}`)
	}
	return parts.join("\n")
}
