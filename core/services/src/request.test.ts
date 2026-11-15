import { describe, expect, it } from "vitest"
import { FakeStore } from "@core/shared/testing"
import { requestProduction } from "./request.js"

describe("requestProduction params", () => {
	it("persists explicit params on the root node", async () => {
		const store = new FakeStore()
		const { production_id } = await requestProduction(store, {
			brief: "make a thing",
			sessionId: "web-app",
			actorKind: "human",
			type: "video-project",
			params: { referenceSlug: "kabir-wpvibe-20k-installs" },
		})
		const root = await store.getNode(production_id)
		expect(root?.params?.referenceSlug).toBe("kabir-wpvibe-20k-installs")
	})
})
