import { afterEach, describe, expect, it, vi } from "vitest"
import type { Template } from "./types.js"
import { filterTemplates, getCatalog, launchFromTemplate } from "./catalog-api.js"

const mk = (slug: string, tier: Template["tier"], tags: string[]): Template => ({
	slug, title: slug, creator: "c", product: "p", tier, tags,
	posterPath: "assets/x.poster.jpg", videoPath: "assets/x.mp4", durationSec: 20, aspect: "9:16",
	oneIdea: "", hook: "", cta: "", summary: "", whyItWorks: "", tools: [], look: "",
	storyboard: [], remakePrompts: [], scorecard: [],
})

afterEach(() => vi.unstubAllGlobals())

describe("filterTemplates", () => {
	const all = [mk("a", "north-star", ["launch-film"]), mk("b", "launch-reel", ["ugc-avatar"])]
	it("filters by tier and tag, returns all when no filter", () => {
		expect(filterTemplates(all, {}).length).toBe(2)
		expect(filterTemplates(all, { tier: "north-star" }).map((t) => t.slug)).toEqual(["a"])
		expect(filterTemplates(all, { tag: "ugc-avatar" }).map((t) => t.slug)).toEqual(["b"])
	})
})

describe("getCatalog", () => {
	it("fetches and parses catalog.json", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([mk("a", "north-star", [])]), { status: 200 })))
		const cat = await getCatalog()
		expect(cat[0]?.slug).toBe("a")
	})
	it("throws on a non-ok response", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })))
		await expect(getCatalog()).rejects.toThrow()
	})
})

describe("launchFromTemplate", () => {
	it("POSTs the body and returns the production id", async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ production_id: "p-123" }), { status: 200 }))
		vi.stubGlobal("fetch", fetchMock)
		const res = await launchFromTemplate({ template: mk("a", "north-star", []), productName: "Acme", angle: "x", autonomyLever: "high" })
		expect(res.productionId).toBe("p-123")
		const [url, init] = fetchMock.mock.calls[0]!
		expect(url).toBe("/api/productions")
		expect((init as RequestInit).method).toBe("POST")
	})
	it("throws with the server error message on failure", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "angle is required" }), { status: 400 })))
		await expect(launchFromTemplate({ template: mk("a", "north-star", []), productName: "Acme", angle: "", autonomyLever: "high" })).rejects.toThrow("angle is required")
	})
})
