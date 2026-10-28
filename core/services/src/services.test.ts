// Service-layer unit tests — pure logic over FakeStore, no MCP transport, no HTTP, no DB, no network.
// This is the home of the logic the MCP tools and the dashboard API both call.

import { FakeStore } from "@core/shared/testing"
import { beforeEach, describe, expect, it } from "vitest"
import { approve, approveBudget, getDeliverable, getStatus, inbox, requestVideo, submitFeedback } from "./index.js"

let store: FakeStore

beforeEach(() => {
	store = new FakeStore()
})

// Simulate what the engine would do: a leaf child with a presentable version + a `present` output.
async function presentSomething() {
	const { production_id } = await requestVideo(store, { brief: "a 15s video about X", sessionId: "sess_1" })
	const [child] = await store.createChildNodes(production_id, [{ type: "script", name: "Script" }])
	const version = await store.createVersion({ nodeId: child!.id, n: 1, status: "presentable" })
	const output = await store.emitOutput({
		productionId: production_id,
		nodeId: child!.id,
		versionId: version.id,
		type: "present",
		prompt: "Draft script ready",
	})
	return { production_id, node: child!, version, output }
}

describe("requestVideo (hand off)", () => {
	it("resolves the defaults, inserts a queued root, returns its id", async () => {
		const res = await requestVideo(store, { brief: "make a promo", sessionId: "sess_1" })
		expect(res.status).toBe("queued")
		const root = await store.getProduction(res.production_id)
		expect(root?.accountId).toBe("acc_default")
		expect(root?.userId).toBe("usr_default")
		expect(root?.autonomyLever).toBe("medium") // default
		expect(root?.actorKind).toBe("human") // default
	})

	it("honors an explicit autonomyLever + actorKind", async () => {
		const res = await requestVideo(store, { brief: "x", sessionId: "s", autonomyLever: "high", actorKind: "agent" })
		const root = await store.getProduction(res.production_id)
		expect(root?.autonomyLever).toBe("high")
		expect(root?.actorKind).toBe("agent")
	})
})

describe("getStatus + inbox", () => {
	it("reports nodes and surfaces a presentable output", async () => {
		const { production_id, node, version } = await presentSomething()
		const status = await getStatus(store, { productionId: production_id })
		expect(status.nodes.map((n) => n.id)).toContain(node.id)
		expect(status.presentable).toHaveLength(1)
		expect(status.presentable[0]).toMatchObject({ node_id: node.id, version_id: version.id })

		const box = await inbox(store, { productionId: production_id })
		expect(box.outputs).toHaveLength(1)
		expect(box.outputs[0]).toMatchObject({ type: "present", version_id: version.id })
	})
})

describe("approve", () => {
	it("by outputId: resolves the output, approves the version + node, records the input", async () => {
		const { output, node, version } = await presentSomething()
		const res = await approve(store, { outputId: output.id })
		expect(res.ok).toBe(true)
		expect((await store.getOutput(output.id))?.status).toBe("resolved")
		expect((await store.getVersion(version.id))?.status).toBe("approved")
		expect((await store.getNode(node.id))?.status).toBe("approved")
		expect(store.chatInputs.at(-1)).toMatchObject({ kind: "approve", respondsTo: output.id })
	})

	it("by versionId: approves without an output", async () => {
		const { version, node } = await presentSomething()
		await approve(store, { versionId: version.id })
		expect((await store.getVersion(version.id))?.status).toBe("approved")
		expect((await store.getNode(node.id))?.status).toBe("approved")
	})
})

describe("submitFeedback", () => {
	it("by outputId: denies the version, reopens the node, resolves the output", async () => {
		const { output, node, version } = await presentSomething()
		await submitFeedback(store, { outputId: output.id, body: "too long, wrong tone" })
		expect((await store.getVersion(version.id))?.status).toBe("denied")
		expect((await store.getVersion(version.id))?.feedback).toBe("too long, wrong tone")
		expect((await store.getNode(node.id))?.status).toBe("pending")
		expect((await store.getOutput(output.id))?.status).toBe("resolved")
		expect(store.chatInputs.at(-1)).toMatchObject({ kind: "feedback", respondsTo: output.id })
	})

	it("unsolicited (productionId): records feedback with no respondsTo", async () => {
		const { production_id } = await presentSomething()
		await submitFeedback(store, { productionId: production_id, body: "make it shorter" })
		expect(store.chatInputs.at(-1)).toMatchObject({ kind: "feedback", respondsTo: null, body: "make it shorter" })
	})
})

describe("approveBudget", () => {
	it("flips the money gate", async () => {
		const { production_id } = await presentSomething()
		expect((await store.getBudget(production_id))?.approved).toBe(false)
		await approveBudget(store, { productionId: production_id })
		expect((await store.getBudget(production_id))?.approved).toBe(true)
	})
})

describe("getDeliverable", () => {
	it("returns the version + path, no inline content when there is no artifact", async () => {
		const { version } = await presentSomething()
		const res = await getDeliverable(store, { versionId: version.id })
		expect(res.version.id).toBe(version.id)
		expect(res.artifact_path).toBeNull()
		expect(res.content).toBeUndefined()
	})
})
