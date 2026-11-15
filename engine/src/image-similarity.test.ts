// Unit tests for the mockup-fidelity similarity core (issue 0049). Synthetic luminance grids — no image
// decode, no live render. Exercises the failure-exposing cases (a regenerated / recoloured region scores
// low) alongside the identity case.

import { describe, expect, it } from "vitest"
import { type LuminanceGrid, averageHash, hashSimilarity, mockupFidelity, resampleGrid, rmsSimilarity } from "./image-similarity.js"

// a deterministic "UI mockup": a light panel with a dark header band
function mockup(w = 32, h = 32): LuminanceGrid {
	return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (y < h / 4 ? 30 : x < w / 2 ? 230 : 210)))
}
function invert(g: LuminanceGrid): LuminanceGrid {
	return g.map((row) => row.map((v) => 255 - v))
}

describe("mockupFidelity", () => {
	it("scores an identical region at ~1.0", () => {
		const g = mockup()
		expect(mockupFidelity(g, g)).toBeCloseTo(1, 5)
	})
	it("scores a regenerated (inverted) region far below the 0.9 locked-source threshold", () => {
		const g = mockup()
		expect(mockupFidelity(g, invert(g))).toBeLessThan(0.9)
	})
	it("scores a recoloured-but-same-layout region below identity but above a full regenerate", () => {
		const g = mockup()
		// same layout, every cell nudged darker by 40 — tone drifts, structure holds
		const recoloured = g.map((row) => row.map((v) => Math.max(0, v - 40)))
		const f = mockupFidelity(g, recoloured)
		expect(f).toBeLessThan(1)
		expect(f).toBeGreaterThan(mockupFidelity(g, invert(g)))
	})
	it("is tolerant of a pure resize (same picture at a different resolution)", () => {
		const big = mockup(64, 64)
		const small = mockup(16, 16)
		expect(mockupFidelity(big, small)).toBeGreaterThan(0.9)
	})
})

describe("hashSimilarity", () => {
	it("is 1 for identical hashes and 0 for inverted", () => {
		const g = mockup()
		const h = averageHash(g)
		expect(hashSimilarity(h, h)).toBe(1)
		expect(hashSimilarity(h, h.map((b) => !b))).toBe(0)
	})
})

describe("rmsSimilarity", () => {
	it("is 1 for identical grids", () => {
		const g = mockup()
		expect(rmsSimilarity(g, g)).toBeCloseTo(1, 5)
	})
	it("drops toward 0 for maximal difference (black vs white)", () => {
		const black: LuminanceGrid = Array.from({ length: 16 }, () => new Array(16).fill(0))
		const white: LuminanceGrid = Array.from({ length: 16 }, () => new Array(16).fill(255))
		expect(rmsSimilarity(black, white)).toBeCloseTo(0, 5)
	})
})

describe("resampleGrid", () => {
	it("resizes to the requested dimensions", () => {
		const g = resampleGrid(mockup(32, 32), 8, 8)
		expect(g.length).toBe(8)
		expect(g[0]?.length).toBe(8)
	})
	it("handles an empty grid without throwing", () => {
		expect(resampleGrid([], 4, 4).length).toBe(4)
	})
})
