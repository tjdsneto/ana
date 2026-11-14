import { describe, expect, it } from "vitest"
import { toCatalogRecord } from "./promote-template.js"

const manifestRow = {
	slug: "kabir-wpvibe-20k-installs",
	title: "WPVibe — 20K Installs",
	creator: "Kabir",
	product: "WPVibe",
	tier: "north-star" as const,
	durationSec: 20.8,
	w: 1080,
	h: 1080,
}
const dataJson = {
	oneIdea: "watch installs climb in real time",
	hook: "a counter ticking up",
	cta: "Build yours with WPVibe",
	summary: "s",
	whyItWorks: "the number is real and earned",
	tools: ["HyperFrames", "GSAP"],
	look: "dark, monospace, kinetic",
	storyboard: [{ t: "0-3s", job: "hook", whatHappens: "counter starts", onScreen: "0" }],
	remakePrompts: ["counter scene prompt"],
	scorecard: [{ check: "signature device", verdict: "pass" as const, note: "the counter" }],
}

describe("toCatalogRecord", () => {
	it("merges manifest + data into a Template with /catalog asset paths and aspect", () => {
		const rec = toCatalogRecord(manifestRow, dataJson, ["generative-video"])
		expect(rec.slug).toBe("kabir-wpvibe-20k-installs")
		expect(rec.creator).toBe("Kabir")
		expect(rec.product).toBe("WPVibe")
		expect(rec.tier).toBe("north-star")
		expect(rec.tags).toEqual(["generative-video"])
		expect(rec.aspect).toBe("1:1") // 1080x1080 → 1:1
		expect(rec.videoPath).toBe("assets/kabir-wpvibe-20k-installs.mp4")
		expect(rec.posterPath).toBe("assets/kabir-wpvibe-20k-installs.poster.jpg")
		expect(rec.oneIdea).toBe("watch installs climb in real time")
		expect(rec.storyboard[0]?.job).toBe("hook")
		expect(rec.scorecard[0]?.verdict).toBe("pass")
	})

	it("flattens a structured look object into a string summary", () => {
		const rec = toCatalogRecord(manifestRow, { ...dataJson, look: { palette: "dark", type: "mono", motion: "kinetic", motifs: ["counter"], sound: "silent" } }, [])
		expect(typeof rec.look).toBe("string")
		expect(rec.look).toContain("dark")
		expect(rec.look).toContain("counter")
	})
})
