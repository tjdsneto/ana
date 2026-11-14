import { describe, expect, it } from "vitest"
import { FakeStore } from "@core/shared/testing"
import { requestProduction } from "@core/services"
import type { Template } from "@core/shared"
import { buildLaunchInput } from "./launch.js"

const template: Template = {
	slug: "ref-1", title: "Ref One", creator: "Kabir", product: "WPVibe", tier: "north-star",
	tags: [], posterPath: "assets/x.poster.jpg", videoPath: "assets/x.mp4", durationSec: 20, aspect: "9:16",
	oneIdea: "o", hook: "h", cta: "c", summary: "s", whyItWorks: "w", tools: [], look: "l",
	storyboard: [{ t: "0-2s", job: "hook", whatHappens: "x" }], remakePrompts: [], scorecard: [],
}

describe("buildLaunchInput", () => {
	it("maps a valid body to a video-project request with composed brief + reference params", () => {
		const input = buildLaunchInput({ template, productName: "AcmeDocs", angle: "time saved" })
		expect(input.type).toBe("video-project")
		expect(input.actorKind).toBe("human")
		expect(input.autonomyLever).toBe("high")
		expect(input.sessionId).toBe("web-app")
		expect(input.brief).toContain("AcmeDocs")
		expect(input.params?.referenceSlug).toBe("ref-1")
	})

	it("rejects missing productName / angle / bad lever / bad template", () => {
		expect(() => buildLaunchInput({ template, productName: " ", angle: "a" })).toThrow()
		expect(() => buildLaunchInput({ template, productName: "p", angle: "" })).toThrow()
		expect(() => buildLaunchInput({ template, productName: "p", angle: "a", autonomyLever: "turbo" as never })).toThrow()
		expect(() => buildLaunchInput({ template: { slug: "" } as Template, productName: "p", angle: "a" })).toThrow()
	})

	it("inserts a queued video-project root when run through requestProduction", async () => {
		const store = new FakeStore()
		const { production_id, status } = await requestProduction(store, buildLaunchInput({ template, productName: "AcmeDocs", angle: "time saved" }))
		const root = await store.getNode(production_id)
		expect(root?.type).toBe("video-project")
		expect(status).toBe("queued")
		expect(root?.params?.referenceSlug).toBe("ref-1")
		expect(root?.description).toContain("AcmeDocs")
	})
})
