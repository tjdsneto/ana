// Unit tests for the deterministic layout inspector (issue 0033). Pure checks over synthetic geometry
// fixtures — no live render. Each test exercises the FAILURE-exposing case (a defect present) and the
// clean case (the same frame with the defect removed stays silent), so a check that fires on nothing is
// caught too.

import { describe, expect, it } from "vitest"
import {
	type InspectOptions,
	type LayoutFrame,
	type LayoutGeometry,
	DEFAULT_INSPECT_OPTIONS,
	contrastRatio,
	defectsToReopenLines,
	inspectFrame,
	inspectLayout,
	overlapFraction,
	parseGeometry,
	renderPrecheckReport,
} from "./layout-inspect.js"

const BOUNDS = { width: 1920, height: 1080 }

function frame(over: Partial<LayoutFrame> = {}): LayoutFrame {
	return { t: 1, beat: 1, bounds: BOUNDS, elements: [], ...over }
}

function checks(f: LayoutFrame, opts?: InspectOptions): string[] {
	return inspectFrame(f, opts).map((d) => d.check)
}

describe("clipping", () => {
	it("flags a box crossing the right/bottom edge", () => {
		const f = frame({ elements: [{ id: "title", kind: "text", text: "Launch day", box: { x: 1800, y: 1000, w: 300, h: 200 } }] })
		expect(checks(f)).toContain("clipping")
	})
	it("flags a box crossing the top/left edge (negative origin)", () => {
		const f = frame({ elements: [{ id: "logo", kind: "image", box: { x: -50, y: -40, w: 200, h: 200 } }] })
		expect(checks(f)).toContain("clipping")
	})
	it("does not flag a box fully inside the frame within tolerance", () => {
		const f = frame({ elements: [{ id: "title", kind: "text", text: "ok", box: { x: 160, y: 160, w: 400, h: 120 } }] })
		expect(checks(f)).not.toContain("clipping")
	})
	it("ignores a not-yet-revealed (transparent) element", () => {
		const f = frame({ elements: [{ id: "title", kind: "text", text: "x", box: { x: 1900, y: 1070, w: 400, h: 120 }, opacity: 0 }] })
		expect(checks(f)).not.toContain("clipping")
	})
})

describe("collision", () => {
	it("flags two opaque text runs overlapping beyond the fraction", () => {
		const f = frame({
			elements: [
				{ id: "a", kind: "text", text: "A", box: { x: 200, y: 200, w: 400, h: 200 } },
				{ id: "b", kind: "text", text: "B", box: { x: 300, y: 250, w: 400, h: 200 } },
			],
		})
		expect(checks(f)).toContain("collision")
	})
	it("does not flag text runs that merely touch below the fraction", () => {
		const f = frame({
			elements: [
				{ id: "a", kind: "text", text: "A", box: { x: 200, y: 200, w: 400, h: 200 } },
				{ id: "b", kind: "text", text: "B", box: { x: 590, y: 200, w: 400, h: 200 } },
			],
		})
		expect(checks(f)).not.toContain("collision")
	})
	it("ignores a collision with a faded-out run (not visible)", () => {
		const f = frame({
			elements: [
				{ id: "a", kind: "text", text: "A", box: { x: 200, y: 200, w: 400, h: 200 } },
				{ id: "b", kind: "text", text: "B", box: { x: 300, y: 250, w: 400, h: 200 }, opacity: 0.1 },
			],
		})
		expect(checks(f)).not.toContain("collision")
	})
})

describe("never-settling", () => {
	it("flags an element still moving on a hold frame", () => {
		const f = frame({ hold: true, elements: [{ id: "chip", box: { x: 100, y: 100, w: 100, h: 100 }, motionDelta: 12 }] })
		expect(checks(f)).toContain("never-settling")
	})
	it("does not flag motion on a non-hold (mid-motion) frame", () => {
		const f = frame({ hold: false, elements: [{ id: "chip", box: { x: 100, y: 100, w: 100, h: 100 }, motionDelta: 12 }] })
		expect(checks(f)).not.toContain("never-settling")
	})
	it("does not flag a settled element (sub-threshold motion) on a hold", () => {
		const f = frame({ hold: true, elements: [{ id: "chip", box: { x: 100, y: 100, w: 100, h: 100 }, motionDelta: 0.4 }] })
		expect(checks(f)).not.toContain("never-settling")
	})
})

describe("reveal-stops-short", () => {
	it("flags a reveal below full progress on a hold frame", () => {
		const f = frame({ hold: true, elements: [{ id: "headline", kind: "text", text: "Your AI jus", box: { x: 200, y: 200, w: 800, h: 120 }, revealProgress: 0.7 }] })
		expect(checks(f)).toContain("reveal-stops-short")
	})
	it("does not flag a completed reveal on a hold frame", () => {
		const f = frame({ hold: true, elements: [{ id: "headline", kind: "text", text: "done", box: { x: 200, y: 200, w: 800, h: 120 }, revealProgress: 1 }] })
		expect(checks(f)).not.toContain("reveal-stops-short")
	})
	it("does not fire mid-motion (reveal still in progress is fine before the hold)", () => {
		const f = frame({ hold: false, elements: [{ id: "headline", kind: "text", text: "Your", box: { x: 200, y: 200, w: 800, h: 120 }, revealProgress: 0.4 }] })
		expect(checks(f)).not.toContain("reveal-stops-short")
	})
})

describe("low-contrast", () => {
	it("computes WCAG contrast ratio (black on white ~21:1)", () => {
		expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0)
	})
	it("flags low-contrast normal text (the Sadia yellow-on-light call)", () => {
		const f = frame({ elements: [{ id: "cta", kind: "text", text: "Start free", box: { x: 200, y: 200, w: 400, h: 60 }, color: [245, 210, 60], bgColor: [255, 255, 255], fontSizePx: 20 }] })
		expect(checks(f)).toContain("low-contrast")
	})
	it("passes high-contrast text", () => {
		const f = frame({ elements: [{ id: "cta", kind: "text", text: "Start free", box: { x: 200, y: 200, w: 400, h: 60 }, color: [20, 20, 20], bgColor: [255, 255, 255], fontSizePx: 20 }] })
		expect(checks(f)).not.toContain("low-contrast")
	})
	it("applies the laxer large-text floor so large low-ish contrast can pass", () => {
		// ratio ~3.1:1 — fails the 4.5 normal floor, passes the 3.0 large floor
		const color: [number, number, number] = [120, 120, 120]
		const bg: [number, number, number] = [255, 255, 255]
		expect(contrastRatio(color, bg)).toBeGreaterThan(3.0)
		expect(contrastRatio(color, bg)).toBeLessThan(4.5)
		const large = frame({ elements: [{ id: "h", kind: "text", text: "big", box: { x: 200, y: 200, w: 800, h: 200 }, color, bgColor: bg, fontSizePx: 80 }] })
		const small = frame({ elements: [{ id: "h", kind: "text", text: "small", box: { x: 200, y: 200, w: 200, h: 30 }, color, bgColor: bg, fontSizePx: 16 }] })
		expect(checks(large)).not.toContain("low-contrast")
		expect(checks(small)).toContain("low-contrast")
	})
})

describe("too-many-type-systems", () => {
	it("flags 3 distinct font families in one frame", () => {
		const f = frame({
			elements: [
				{ id: "a", kind: "text", text: "A", box: { x: 10, y: 10, w: 100, h: 40 }, fontFamily: "Museo Sans" },
				{ id: "b", kind: "text", text: "B", box: { x: 10, y: 60, w: 100, h: 40 }, fontFamily: "Inter" },
				{ id: "c", kind: "text", text: "C", box: { x: 10, y: 110, w: 100, h: 40 }, fontFamily: "Georgia" },
			],
		})
		expect(checks(f)).toContain("too-many-type-systems")
	})
	it("allows a two-face system (display + body)", () => {
		const f = frame({
			elements: [
				{ id: "a", kind: "text", text: "A", box: { x: 10, y: 10, w: 100, h: 40 }, fontFamily: '"Museo Sans", sans-serif' },
				{ id: "b", kind: "text", text: "B", box: { x: 10, y: 60, w: 100, h: 40 }, fontFamily: "Museo Sans" },
				{ id: "c", kind: "text", text: "C", box: { x: 10, y: 110, w: 100, h: 40 }, fontFamily: "IBM Plex Mono" },
			],
		})
		expect(checks(f)).not.toContain("too-many-type-systems")
	})
})

describe("mockup-fidelity (0049)", () => {
	it("flags a locked-source element whose rendered region drifted below the threshold", () => {
		const f = frame({ beat: 2, elements: [{ id: "ui", kind: "image", box: { x: 200, y: 200, w: 1000, h: 600 }, lockedSourceId: "dashboard.png", fidelity: 0.62 }] })
		expect(checks(f)).toContain("mockup-fidelity")
	})
	it("passes a faithful composite at/above the threshold", () => {
		const f = frame({ elements: [{ id: "ui", kind: "image", box: { x: 200, y: 200, w: 1000, h: 600 }, lockedSourceId: "dashboard.png", fidelity: 0.97 }] })
		expect(checks(f)).not.toContain("mockup-fidelity")
	})
	it("does not fire on an element with no locked source (ordinary generated art)", () => {
		const f = frame({ elements: [{ id: "art", kind: "image", box: { x: 200, y: 200, w: 1000, h: 600 }, fidelity: 0.1 }] })
		expect(checks(f)).not.toContain("mockup-fidelity")
	})
	it("does not fire when fidelity was not computed (renderer did not diff)", () => {
		const f = frame({ elements: [{ id: "ui", kind: "image", box: { x: 200, y: 200, w: 1000, h: 600 }, lockedSourceId: "dashboard.png" }] })
		expect(checks(f)).not.toContain("mockup-fidelity")
	})
})

describe("overlapFraction", () => {
	it("is 1 when the smaller box is fully contained", () => {
		expect(overlapFraction({ x: 0, y: 0, w: 100, h: 100 }, { x: 10, y: 10, w: 20, h: 20 })).toBe(1)
	})
	it("is 0 for disjoint boxes", () => {
		expect(overlapFraction({ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 100, w: 10, h: 10 })).toBe(0)
	})
})

describe("inspectLayout + reopen mapping", () => {
	const geometry: LayoutGeometry = {
		frames: [
			frame({ beat: 2, hold: true, elements: [{ id: "title", kind: "text", text: "Clipped", box: { x: 1850, y: 100, w: 300, h: 100 } }] }),
			frame({ beat: 3, elements: [{ id: "ok", kind: "text", text: "fine", box: { x: 200, y: 200, w: 200, h: 80 } }] }),
		],
	}
	it("collects defects across frames", () => {
		const defects = inspectLayout(geometry)
		expect(defects.length).toBeGreaterThanOrEqual(1)
		expect(defects.some((d) => d.check === "clipping" && d.beat === 2)).toBe(true)
	})
	it("maps a numeric beat to a 1-based REOPEN index on the given target", () => {
		const lines = defectsToReopenLines(inspectLayout(geometry), "scene")
		expect(lines.some((l) => l.startsWith("REOPEN: scene[2] —"))).toBe(true)
	})
	it("renders a revise report that opens with VERDICT: revise and a REOPEN line", () => {
		const report = renderPrecheckReport(inspectLayout(geometry), "scene")
		expect(report.startsWith("VERDICT: revise")).toBe(true)
		expect(report).toContain("REOPEN: scene[2]")
	})
	it("renders a pass report when clean", () => {
		expect(renderPrecheckReport([], "scene").startsWith("VERDICT: pass")).toBe(true)
		expect(defectsToReopenLines([], "scene")).toEqual([])
	})
})

describe("parseGeometry", () => {
	it("parses a valid geometry", () => {
		expect(parseGeometry('{"frames":[{"t":0,"bounds":{"width":10,"height":10},"elements":[]}]}').frames.length).toBe(1)
	})
	it("degrades malformed input to zero frames (never throws)", () => {
		expect(parseGeometry("not json").frames).toEqual([])
		expect(parseGeometry('{"frames":"nope"}').frames).toEqual([])
	})
})

describe("DEFAULT_INSPECT_OPTIONS", () => {
	it("uses WCAG AA floors", () => {
		expect(DEFAULT_INSPECT_OPTIONS.contrastMinNormal).toBe(4.5)
		expect(DEFAULT_INSPECT_OPTIONS.contrastMinLarge).toBe(3.0)
	})
})
