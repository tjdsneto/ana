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
	nodeBrief?: string // this node's own spec — set when a planner fanned the node out of a larger plan (e.g. one scene's spec)
	priorContent?: string // the version being revised
	feedback?: string // reviewer union or user feedback that drove this redo
	boardOut?: string // if set, save the rendered self-check board sheet here (absolute path) so the dashboard can show it
}

export function buildProducerPrompt(contract: TypeContract, ctx: ProduceContext): string {
	const parts: string[] = []
	parts.push(contract.produce ?? `Produce the ${contract.type} deliverable.`)
	parts.push(`\n## Brief\n${ctx.brief}`)
	if (ctx.nodeBrief) {
		parts.push(`\n## This unit's spec (produce exactly this part)\n${ctx.nodeBrief}`)
	}
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
	if (ctx.boardOut) {
		parts.push(`\n## Save your board for the dashboard\nAfter you render your self-check board, copy the board sheet image to EXACTLY this path (the dashboard reads it per version): \`${ctx.boardOut}\`\nUse \`cp <yourWorkDir>/board/sheet.jpg "${ctx.boardOut}"\` (create the parent dir if needed). Do this before you output.`)
	}
	return parts.join("\n")
}

export interface PlanChild {
	name: string
	brief: string
}

// A planner node fans out into dynamic children. The planner subagent reads the approved upstream
// work and returns the independent units to produce, as a fenced ```json array of {name, brief} in
// playback order. The engine stays domain-agnostic: it parses only this generic shape, never the
// upstream's own schema (e.g. a storyboard's film.json). Each entry becomes one child of childType,
// and its "brief" rides into the child's producer prompt as that unit's spec.
export function buildPlannerPrompt(contract: TypeContract, ctx: { brief: string; upstream: UpstreamArtifact[] }): string {
	const parts: string[] = []
	parts.push(
		contract.produce ??
			`Plan the ${contract.type} step: read the approved upstream work and break it into the independent ${contract.childType ?? "child"} units to produce.`,
	)
	parts.push(
		'Output ONLY a fenced ```json block: an array of objects {"name": string, "brief": string}, one per unit, in playback order. "brief" is the self-contained spec that unit\'s producer needs.',
	)
	parts.push(`\n## Brief\n${ctx.brief}`)
	if (ctx.upstream.length > 0) {
		parts.push("\n## Approved upstream work")
		for (const u of ctx.upstream) parts.push(`\n### ${u.type}\n${u.content}`)
	}
	return parts.join("\n")
}

// Planner output → child specs. Reads the first fenced ```json array (or a bare top-level array) and
// keeps entries that carry a name. Fail-closed: a malformed plan yields [], and the engine refuses to
// fan out zero children (a planner that produced nothing is an error, not an empty success).
export function parsePlan(output: string): PlanChild[] {
	const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/)
	const raw = fenced?.[1] ?? output
	const start = raw.indexOf("[")
	const end = raw.lastIndexOf("]")
	if (start === -1 || end === -1 || end < start) return []
	let parsed: unknown
	try {
		parsed = JSON.parse(raw.slice(start, end + 1))
	} catch {
		return []
	}
	if (!Array.isArray(parsed)) return []
	const out: PlanChild[] = []
	for (const item of parsed) {
		if (item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string") {
			const rec = item as { name: string; brief?: unknown }
			out.push({ name: rec.name, brief: typeof rec.brief === "string" ? rec.brief : "" })
		}
	}
	return out
}

export interface ReviewContext {
	draft: string
	brief: string
	upstream: UpstreamArtifact[]
	revalidation?: boolean // true = the deliverable was already approved and an upstream has since changed; judge whether it still holds, don't re-review from scratch
}

export function buildReviewerPrompt(contract: TypeContract, review: ReviewSpec, ctx: ReviewContext): string {
	const lens: Record<ReviewSpec["kind"], string> = {
		craft: "Judge the deliverable on its own craft merits against the rubric.",
		coverage: "Check that every point from the brief and approved upstream work made it in.",
		consistency: "Check that it matches the design language and the sibling artifacts.",
		audio: "Run the deterministic verifier and relay its verdict: the voiceover matches the script exactly (no duplicated or dropped lines, in order), the mp4/vo durations are in sync, no dead air, no blank open.",
	}
	const parts: string[] = []
	// A reviewer skill (if declared) owns the per-step rubric for this axis — the runner injects it as a
	// directive, so here we only name the role. Without a skill, fall back to the generic kind lens.
	parts.push(
		review.skill
			? `You are the "${review.name}" reviewer for a ${contract.type} deliverable. Judge it against your reviewer skill's rubric.`
			: `You are the "${review.name}" reviewer for a ${contract.type} deliverable. ${lens[review.kind]}`,
	)
	if (ctx.revalidation) {
		parts.push(
			"You are REVALIDATING: the deliverable below was already approved, and an upstream input has since changed. Pass if it STILL holds against the changed upstream; revise ONLY if the change actually breaks your axis. A trivial upstream edit that does not affect you is a pass — do not rebuild for its own sake.",
		)
	}
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

// The holistic final review (final-review node) names which upstream node to reopen and why, one per
// line: `REOPEN: <type> — <reason>`, or `REOPEN: <type>[<n>] — <reason>` to target one instance when a
// step has fanned out (e.g. `scene[3]` = the 3rd scene, 1-based). Parse them into {type, index?,
// reason}. The engine resolves the target to the production's node(s) and reopens just those (+ cascade
// to their dependents and ancestors). An index picks one instance; no index reopens every node of that
// type (one for a single-instance step; the whole fan-out for a multi-instance one). No REOPEN lines on
// a revise = the reviewer flagged problems but named nothing actionable; the engine escalates rather
// than reopening blindly.
export interface ReopenTarget {
	type: string
	index?: number // 1-based instance selector among siblings of that type; absent = all of that type
	reason: string
}

export function parseReopen(output: string): ReopenTarget[] {
	const out: ReopenTarget[] = []
	for (const line of output.split("\n")) {
		const m = line.match(/^\s*REOPEN:\s*([a-zA-Z0-9_-]+)(?:\[(\d+)\])?\s*(?:[—:-]\s*(.*))?$/)
		if (m?.[1]) {
			const index = m[2] ? Number.parseInt(m[2], 10) : undefined
			out.push({ type: m[1], index, reason: (m[3] ?? "").trim() || "revised on whole-video review" })
		}
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
		"Respond with `VERDICT: pass` if it is ready for the human, or `VERDICT: revise` if a specific earlier step must be redone. On revise, add one line per fix: `REOPEN: <step> — <reason>` (step = the pipeline node to redo, e.g. moodboard, script, storyboard, render, polish). When a step has fanned out into numbered units, target just the bad one with `REOPEN: <step>[<n>] — <reason>` (e.g. `scene[3]`, 1-based) so its siblings are left alone. Name only the steps that must change — each reopen rebuilds everything downstream of it.",
	)
	parts.push(`\n## Brief\n${ctx.brief}`)
	if (ctx.upstream.length > 0) {
		parts.push("\n## The finished video + its inputs")
		for (const u of ctx.upstream) parts.push(`\n### ${u.type}\n${u.content}`)
	}
	return parts.join("\n")
}
