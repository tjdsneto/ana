// request_video — HAND OFF. Inserts the root node and returns immediately; it never runs the
// production inline (the engine worker picks it up off the DB). The one slow operation of the whole
// surface, kept to a single insert.

import type { ActorKind, AutonomyLever, Store } from "@core/shared"

export interface RequestVideoInput {
	brief: string
	sessionId: string
	autonomyLever?: AutonomyLever
	actorKind?: ActorKind
}

// A production is just a root node of some type. requestProduction roots it at any rootCapable type
// (default "video-project"); requestVideo is the back-compat shim that always roots a video-project.
export interface RequestProductionInput extends RequestVideoInput {
	type?: string
}

export async function requestProduction(store: Store, input: RequestProductionInput): Promise<{ production_id: string; status: string }> {
	const account = await store.defaultAccount()
	const user = await store.defaultUser()
	const root = await store.createProduction({
		accountId: account.id,
		userId: user.id,
		brief: input.brief,
		sessionId: input.sessionId,
		// 0010: an agent actor runs unattended, so default it to full autonomy (`high`) unless a lever is
		// given explicitly; a human actor still defaults to `medium`. An explicit lever always wins.
		autonomyLever: input.autonomyLever ?? (input.actorKind === "agent" ? "high" : "medium"),
		actorKind: input.actorKind ?? "human",
		type: input.type,
	})
	return { production_id: root.id, status: root.status }
}

export function requestVideo(store: Store, input: RequestVideoInput): Promise<{ production_id: string; status: string }> {
	return requestProduction(store, input) // type omitted → defaults to "video-project"
}
