import { describe, expect, it } from "vitest"
import type { Template } from "@core/shared"
import { composeBriefFromTemplate } from "./compose-brief.js"

const t: Template = {
	slug: "kabir-wpvibe-20k-installs",
	title: "WPVibe — 20K Installs",
	creator: "Kabir",
	product: "WPVibe",
	tier: "north-star",
	tags: [],
	posterPath: "assets/x.poster.jpg",
	videoPath: "assets/x.mp4",
	durationSec: 21,
	aspect: "1:1",
	oneIdea: "watch installs climb in real time",
	hook: "a counter ticking up",
	cta: "Build yours with WPVibe",
	summary: "s",
	whyItWorks: "the number is real and earned",
	tools: ["GSAP"],
	look: "dark, monospace, kinetic",
	storyboard: [{ t: "0-3s", job: "hook", whatHappens: "counter starts" }],
	remakePrompts: [],
	scorecard: [],
}

describe("composeBriefFromTemplate", () => {
	it("renders product, angle, reference, hook, cta, look, and each beat into the brief", () => {
		const brief = composeBriefFromTemplate(t, { productName: "AcmeDocs", angle: "show the time saved per week" })
		expect(brief).toContain("AcmeDocs")
		expect(brief).toContain("show the time saved per week")
		expect(brief).toContain("WPVibe — 20K Installs")
		expect(brief).toContain("watch installs climb in real time")
		expect(brief).toContain("a counter ticking up")
		expect(brief).toContain("Build yours with WPVibe")
		expect(brief).toContain("dark, monospace, kinetic")
		expect(brief).toContain("counter starts")
		expect(brief).toMatch(/1:1/)
	})

	it("does not presume a 'launch' format — the reference carries the format", () => {
		const brief = composeBriefFromTemplate(t, { productName: "AcmeDocs", angle: "x" })
		expect(brief).not.toMatch(/launch video/i)
	})

	it("omits empty optional sections for a sparse reference (no blank 'in the spirit of:' lines)", () => {
		const sparse: Template = {
			...t,
			oneIdea: "",
			hook: "   ",
			cta: "",
			look: "",
			whyItWorks: "",
			storyboard: [],
		}
		const brief = composeBriefFromTemplate(sparse, { productName: "AcmeDocs", angle: "the core method" })
		expect(brief).not.toContain("in the spirit of:")
		expect(brief).not.toContain("Structure to mirror")
		expect(brief).not.toContain("Look & feel to match:")
		expect(brief).not.toMatch(/\n\n\n/) // no triple blank lines left behind
		expect(brief).toContain("AcmeDocs")
		expect(brief).toContain("the core method")
	})
})
