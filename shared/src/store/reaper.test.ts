// 0011 self-heal: claim lease + reaper. Unit-level, against the FakeStore (no DB) — the FakeStore
// mirrors PgStore's lease/heartbeat/reaper semantics, so these pin the selection logic the Postgres
// adapter implements under FOR UPDATE SKIP LOCKED: an expired in-progress claim returns to pending, a
// live (heartbeated or just-claimed) one does not, and a dead producing version is superseded on reclaim.

import { describe, expect, it } from "vitest"
import { DEFAULT_ACCOUNT_ID, DEFAULT_USER_ID } from "../defaults.js"
import type { ClaimLease } from "../ports.js"
import type { Node } from "../types.js"
import { FakeStore, FixedClock, SeqIdGen } from "../testing/fake-store.js"

const TTL = 1000 // ms — short so a clock advance can cross it
const LEASE: ClaimLease = { workerId: "wrk_1", leaseTtlMs: TTL }

// A production with one claimable child: the root is forced in-progress (so the child's parent is
// "active" and the child is ready), and the child is claimed with a lease + given a live producing
// version — exactly the shape a worker leaves behind mid-produce.
async function withClaimedChild() {
	const clock = new FixedClock(new Date("2026-01-01T00:00:00.000Z"))
	const store = new FakeStore(clock, new SeqIdGen())
	const root = await store.createProduction({
		accountId: DEFAULT_ACCOUNT_ID,
		userId: DEFAULT_USER_ID,
		brief: "a 15s video",
		sessionId: "sess_1",
		autonomyLever: "high",
		actorKind: "agent",
	})
	await store.updateNodeStatus(root.id, "in-progress")
	const [child] = await store.createChildNodes(root.id, [{ type: "script", name: "script" }])
	const claimed = await store.claimReadyNode(LEASE)
	if (!claimed || claimed.id !== child!.id) throw new Error("setup: expected to claim the child")
	const version = await store.createVersion({ nodeId: child!.id, n: 1, status: "producing", subagent: { runId: "r1", status: "running" } })
	return { clock, store, root, child: child!, version }
}

describe("claim lease", () => {
	it("stamps claimed_by + lease_expires_at = claim time + ttl when a lease is passed", async () => {
		const { store, child } = await withClaimedChild()
		const n = (await store.getNode(child.id)) as Node
		expect(n.status).toBe("in-progress")
		expect(n.claimedBy).toBe("wrk_1")
		expect(n.claimedAt).toEqual(new Date("2026-01-01T00:00:00.000Z"))
		expect(n.leaseExpiresAt).toEqual(new Date("2026-01-01T00:00:01.000Z")) // +1000ms
	})

	it("writes no lease when claimReadyNode is called without one", async () => {
		const clock = new FixedClock()
		const store = new FakeStore(clock, new SeqIdGen())
		const root = await store.createProduction({
			accountId: DEFAULT_ACCOUNT_ID,
			userId: DEFAULT_USER_ID,
			brief: "b",
			sessionId: "s",
			autonomyLever: "high",
			actorKind: "agent",
		})
		await store.updateNodeStatus(root.id, "in-progress")
		const [child] = await store.createChildNodes(root.id, [{ type: "script", name: "script" }])
		const claimed = await store.claimReadyNode()
		expect(claimed?.id).toBe(child!.id)
		expect(claimed?.claimedBy).toBeNull()
		expect(claimed?.leaseExpiresAt).toBeNull()
	})
})

describe("reapExpiredClaims", () => {
	it("returns an expired in-progress claim to pending and supersedes its dead producing version", async () => {
		const { store, clock, child, version } = await withClaimedChild()
		clock.advance(TTL + 1) // let the lease lapse

		const reaped = await store.reapExpiredClaims()

		expect(reaped.map((n) => n.id)).toEqual([child.id])
		const n = (await store.getNode(child.id)) as Node
		expect(n.status).toBe("pending")
		expect(n.claimedBy).toBeNull()
		expect(n.claimedAt).toBeNull()
		expect(n.leaseExpiresAt).toBeNull()
		expect((await store.getVersion(version.id))?.status).toBe("superseded") // the half-written producing row is retired
	})

	it("does NOT reap a live (un-expired) claim", async () => {
		const { store, clock, child } = await withClaimedChild()
		clock.advance(TTL - 1) // still inside the lease

		const reaped = await store.reapExpiredClaims()

		expect(reaped).toEqual([])
		expect((await store.getNode(child.id))?.status).toBe("in-progress")
	})

	it("does NOT reap an in-progress node that carries no lease (e.g. a direct-dispatched root)", async () => {
		const { store, clock, root } = await withClaimedChild()
		// the root is in-progress but was never claimed-with-lease, so lease_expires_at is null
		clock.advance(TTL * 1000)

		const reaped = await store.reapExpiredClaims()

		expect(reaped.some((n) => n.id === root.id)).toBe(false)
		expect((await store.getNode(root.id))?.status).toBe("in-progress")
	})

	it("skips a node whose production root is retired", async () => {
		const { store, clock, root, child } = await withClaimedChild()
		await store.updateNodeStatus(root.id, "cancelled") // human stop — don't resurrect its work
		clock.advance(TTL + 1)

		const reaped = await store.reapExpiredClaims()

		expect(reaped).toEqual([])
		expect((await store.getNode(child.id))?.status).toBe("in-progress")
	})
})

describe("heartbeatClaims", () => {
	it("extends the lease so a claim about to expire survives the reaper", async () => {
		const { store, clock, child } = await withClaimedChild()
		clock.advance(TTL - 1) // nearly expired

		const refreshed = await store.heartbeatClaims("wrk_1", TTL)
		expect(refreshed).toBe(1)
		// the lease is now (now + TTL) = original+999+1000; advance past the ORIGINAL expiry but within the new one
		clock.advance(2) // total elapsed TTL+1 from claim, but only 2 since the heartbeat

		expect(await store.reapExpiredClaims()).toEqual([])
		expect((await store.getNode(child.id))?.status).toBe("in-progress")
	})

	it("only refreshes claims held by the given worker", async () => {
		const { store } = await withClaimedChild()
		expect(await store.heartbeatClaims("someone-else", TTL)).toBe(0)
		expect(await store.heartbeatClaims("wrk_1", TTL)).toBe(1)
	})
})
