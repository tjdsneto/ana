// Fine-grained live phase for a step card. The node's own `status` is coarse — every fanned-out leaf
// reads "in-progress" from the moment it is created until it rolls up, whether a worker is actually
// drafting it, its draft is in review, or it is just waiting in the ready queue for a free worker. With
// only N workers, most "in-progress" leaves are NOT being touched right now. This derives what is really
// happening from (node.status + the latest version's status + that version's producer-subagent state),
// so the UI can say "producing" for the few a worker holds and "queued"/"waiting" for the rest.

export type StepPhase =
	| "waiting" // deps not satisfied yet (node pending) — can't start
	| "queued" // ready to run, but no worker has claimed it yet
	| "producing" // a worker is drafting it right now (its producer subagent is live)
	| "reviewing" // a draft exists; reviewers are running or pending (no producer live)
	| "revising" // a reviewer sent it back; a redo is pending
	| "approved"
	| "failed"
	| "cancelled"
	| "skipped"

export interface PhaseVersion {
	status: string
	subagent?: { status?: string | null } | null
}

export interface PhaseInput {
	node: { status: string }
	versions: Array<{ version: PhaseVersion }>
}

export function stepPhase(nv: PhaseInput): StepPhase {
	const s = nv.node.status
	if (s === "approved") return "approved"
	if (s === "failed") return "failed"
	if (s === "cancelled") return "cancelled"
	if (s === "skipped") return "skipped"

	const latest = nv.versions.length > 0 ? nv.versions[nv.versions.length - 1]?.version ?? null : null
	if (!latest) {
		// No draft yet. in-progress = a worker claimed it and is spawning the first draft; pending = blocked
		// on deps; anything else active-ish (ready) = sitting in the claim queue.
		if (s === "in-progress") return "producing"
		if (s === "pending") return "waiting"
		return "queued"
	}

	const sub = latest.subagent?.status ?? null
	const producerLive = sub === "running" || sub === "spawned"
	switch (latest.status) {
		case "producing":
			return producerLive ? "producing" : "reviewing"
		case "in-review":
		case "presentable":
		case "presented":
			return "reviewing"
		case "needs-work":
		case "denied":
			return "revising"
		case "approved":
			return "approved"
		default:
			return "queued"
	}
}

// 1-based index of a node among its same-type siblings, in position order — so a fanned-out set of 8
// `card` nodes reads "Card 1 … Card 8" instead of eight identical "Card"s. Returns null when the node is
// the only one of its type (no number needed) or isn't in the list.
export function siblingIndex(
	nodeId: string,
	siblings: Array<{ id: string; type: string; position: number }>,
): number | null {
	const self = siblings.find((s) => s.id === nodeId)
	if (!self) return null
	const sameType = siblings.filter((s) => s.type === self.type).sort((a, b) => a.position - b.position)
	if (sameType.length <= 1) return null
	return sameType.findIndex((s) => s.id === nodeId) + 1
}
