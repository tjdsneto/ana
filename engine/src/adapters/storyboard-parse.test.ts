import { describe, expect, it } from "vitest"
import { parseScenes } from "./storyboard-parse.js"

describe("parseScenes", () => {
	it("splits on scene headings and pulls the narration label", () => {
		const sb = ["## Scene 1 — Open on the product", "Narration: Meet the fastest way to ship.", "", "## Scene 2", "VO: One click and you're live."].join("\n")
		const scenes = parseScenes(sb)
		expect(scenes).toHaveLength(2)
		expect(scenes[0]!.caption).toContain("Open on the product")
		expect(scenes[0]!.narration).toBe("Meet the fastest way to ship.")
		expect(scenes[1]!.narration).toBe("One click and you're live.")
	})

	it("uses the body as narration when there is no label", () => {
		const scenes = parseScenes("# Shot 1\nA wide drone shot over the city at dawn.")
		expect(scenes).toHaveLength(1)
		expect(scenes[0]!.narration).toContain("wide drone shot")
	})

	it("falls back to paragraph blocks when there are no headings", () => {
		const scenes = parseScenes("First beat of the ad.\n\nSecond beat of the ad.\n\nThird beat.")
		expect(scenes).toHaveLength(3)
		expect(scenes[2]!.narration).toBe("Third beat.")
	})

	it("returns one placeholder scene for empty input", () => {
		const scenes = parseScenes("   ")
		expect(scenes).toHaveLength(1)
		expect(scenes[0]!.caption).toMatch(/no storyboard/i)
	})

	it("strips markdown decoration from captions and narration", () => {
		const scenes = parseScenes("## **Scene 1**\n- Narration: Check [our site](https://x.y) now")
		expect(scenes[0]!.caption).toBe("Scene 1")
		expect(scenes[0]!.narration).toBe("Check our site now")
	})
})
