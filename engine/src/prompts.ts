// Prompt construction for producers + reviewers. Plain string assembly — the SubagentRunner (fake
// or claude -p) consumes these. Kept separate so the craft wording lives in one place.

import type { AutonomyLever } from "@core/shared"
import type { ReviewSpec, TypeContract } from "./typereg.js"

export interface UpstreamArtifact {
	type: string
	content: string
	artifactPath?: string // the file this upstream wrote (produces:"file"); a dependent's work dir stages it in by basename, so the skill reads the real file (not the producer's stdout). Absent for a text producer.
}

export interface ProduceContext {
	brief: string
	upstream: UpstreamArtifact[]
	nodeBrief?: string // this node's own spec — set when a planner fanned the node out of a larger plan (e.g. one scene's spec)
	priorContent?: string // the version being revised
	feedback?: string // reviewer union or user feedback that drove this redo
	boardOut?: string // if set, save the rendered self-check board sheet here (absolute path) so the dashboard can show it
	boardDir?: string // if set, the stable per-production board dir (write plates/<id>.html + fonts/ here; reference by absolute path from film.json)
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
	if (ctx.boardDir) {
		parts.push(`\n## Board files directory\nWrite the shared board files under this exact directory (it persists for the render): \`${ctx.boardDir}\`\n- plate files → \`${ctx.boardDir}/plates/<id>.html\`\n- the shared font → \`${ctx.boardDir}/fonts/\`\nReference these from film.json by their ABSOLUTE path (so the render resolves them from any work dir). Create the subdirs if needed.`)
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

// A plansProduction planner reads the brief + staged upstream and FREEZES the production's whole
// pipeline as an ordered stage DAG the engine materializes (parseProductionDag) into sibling nodes under
// the root. Unlike buildPlannerPrompt (which fans childType units UNDER the planner), this emits the
// production's own spine: every universal stage, in order, each bound to a production method/heaviness
// chosen from the capability registry. The engine owns only the output contract; the planner skill owns
// the craft (which method fits the brief). Generic: no domain/product names here.
export function buildProductionPlanPrompt(
	contract: TypeContract,
	ctx: { brief: string; upstream: UpstreamArtifact[]; autonomyLever?: AutonomyLever; feedback?: string },
): string {
	const parts: string[] = []
	parts.push(
		contract.produce ??
			"Plan how this production is made: read the brief and the approved upstream work, then freeze the production pipeline as an ordered stage DAG over the universal spine.",
	)
	parts.push(
		'Output ONLY a fenced ```json block of the shape {"stages": [{"id": string, "type": string, "deps": [string], "binding"?: object}]}. "id" is a stage key other stages name in their "deps"; "type" is the node type that produces the stage; "deps" are the ids of the earlier stages this one builds on; "binding" (optional) carries this stage\'s chosen method/heaviness (e.g. the acquisition source, how heavy it runs).',
	)
	parts.push(
		"Emit EVERY stage of the universal spine, in order — script → moodboard → storyboard → assemble-board → build → assemble → polish → final-review — and never add or drop a spine stage. Bind each stage's method and heaviness from the production-capability registry, matched against the brief (aspect, length, tier, placement). deps may reference only earlier stage ids.",
	)
	// Autonomy gate (§5): the client's autonomy lever decides whether you may ASK about a paid/tier
	// capability fork before freezing, or must DECIDE it yourself. The ask is a SEPARATE output shape the
	// engine recognizes — emit it INSTEAD of the stages (not alongside); you will be re-invoked with the
	// answer and then emit the stages.
	const lever = ctx.autonomyLever ?? "medium"
	if (lever === "high") {
		parts.push(
			"Autonomy is `high`: NEVER ask. Decide every production choice — including any paid/tier capability (e.g. an avatar presenter) — yourself, within the brief + the capability registry, and emit the stages. Do not emit an `ask` block on high autonomy.",
		)
	} else {
		parts.push(
			`Autonomy is \`${lever}\`: if your best plan needs a PAID/tier capability (e.g. an avatar presenter) whose cost the client should confirm before you freeze the DAG, you MAY emit \`{"ask":{"prompt":string,"options":string[]}}\` INSTEAD of the stages — one question to confirm the cost. Otherwise (no cost fork, or the choice is low-impact) just decide and emit the stages. On \`medium\`, ask ONLY for genuinely high-impact / cost-tier forks; decide the rest.`,
		)
	}
	if (ctx.feedback) {
		// The client answered a prior ask — this IS the resolved cost fork. Honor it and emit the stages.
		parts.push(`\n## The client answered your earlier question\n${ctx.feedback}\n\nHonor this answer and emit the stage DAG now — do NOT ask again.`)
	}
	parts.push(`\n## Brief\n${ctx.brief}`)
	if (ctx.upstream.length > 0) {
		parts.push("\n## Approved upstream work")
		for (const u of ctx.upstream) parts.push(`\n### ${u.type}\n${u.content}`)
	}
	return parts.join("\n")
}

export interface ReviewContext {
	draft: string
	brief: string
	upstream: UpstreamArtifact[]
	nodeBrief?: string // the per-instance spec THIS node was assigned (a fanned-out card/scene's own beat spec); lets conformance check the deliverable against its assignment, not only the whole-video brief (0023)
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
	if (ctx.nodeBrief) {
		// 0023: a fanned-out leaf (a card/scene) was produced from its OWN beat spec, not just the
		// whole-video brief. Give the reviewer that assignment so conformance can catch a leaf that drifts
		// from the beat it was told to realize (the producer gets this; previously the reviewer did not).
		parts.push(`\n## This node's assigned spec\nThe specific instruction THIS deliverable was produced from — check the deliverable against this, not only the whole-video brief above:\n${ctx.nodeBrief}`)
	}
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
export function buildHolisticPrompt(
	contract: TypeContract,
	ctx: { brief: string; upstream: UpstreamArtifact[]; feedback?: string },
): string {
	const parts: string[] = []
	parts.push(
		`You are the final whole-video reviewer for this ${contract.type}. Judge the finished video as a whole against your reviewer skill's good-video rubric — pacing, clarity, does it deliver the brief, do the parts play well together.`,
	)
	parts.push(
		"Respond with `VERDICT: pass` if it is ready for the human, or `VERDICT: revise` if a specific earlier step must be redone. On revise, add one line per fix: `REOPEN: <step> — <reason>` (step = the pipeline node to redo, e.g. moodboard, script, storyboard, render, polish). When a step has fanned out into numbered units, target just the bad one with `REOPEN: <step>[<n>] — <reason>` (e.g. `scene[3]`, 1-based) so its siblings are left alone. Name only the steps that must change — each reopen rebuilds everything downstream of it.",
	)
	if (ctx.feedback) {
		// Human feedback on the finished video is a DIRECTIVE, not optional grading context. Without this,
		// the critic re-grades the same render on its own rubric and passes — ignoring what the human asked
		// (issue 0037). Force it to act: translate the feedback into the step that implements it and reopen.
		parts.push(
			`\n## The human reviewer's feedback — a directive you MUST act on\n${ctx.feedback}\n\nThis is explicit human direction on the finished video. Even if the video would otherwise pass your rubric, you MUST emit \`VERDICT: revise\` and \`REOPEN:\` the upstream step(s) that implement this request — do not pass with it unaddressed. Map it to the right step: wording / voiceover lines / voice expressivity or audio tags → \`script\`; the spoken voice choice or voice settings → the step that sets them (moodboard/storyboard); visual look → \`moodboard\`/\`storyboard\`; timing, captions, audio levels → \`polish\`. Put the request in the \`REOPEN\` reason so the reopened step knows exactly what to change.`,
		)
	}
	parts.push(`\n## Brief\n${ctx.brief}`)
	if (ctx.upstream.length > 0) {
		parts.push("\n## The finished video + its inputs")
		for (const u of ctx.upstream) parts.push(`\n### ${u.type}\n${u.content}`)
	}
	return parts.join("\n")
}
