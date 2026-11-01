// Rendered-leaf helpers: asset staging, media-output selection, and the type-aware prompt. These back
// the clip / motion-graphics leaves and must leave the render/assemble path byte-for-byte unchanged.
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildRenderedPrompt, newestMedia, stageAssets } from "./loop.js"
import type { TypeContract } from "./typereg.js"

const tmp = () => mkdtempSync(join(tmpdir(), "rl-"))
const c = (type: string): TypeContract => ({ type, produces: "file" })

describe("buildRenderedPrompt", () => {
	it("render + assemble keep the film.json wording (unchanged behavior)", () => {
		for (const t of ["render", "assemble"]) {
			const p = buildRenderedPrompt(c(t), { brief: "b", workDir: "/wd" })
			expect(p).toContain("Work dir: /wd")
			expect(p).toContain("film.json")
		}
	})
	it("an edit/compose leaf gets the staged-assets wording, not film.json", () => {
		const p = buildRenderedPrompt(c("clip"), { brief: "b", workDir: "/wd", assets: ["take.mp4", "vo.wav"] })
		expect(p).toContain("Work dir: /wd") // the phrase the worker/fake reads
		expect(p).not.toContain("film.json")
		expect(p).toContain("take.mp4, vo.wav")
	})
})

describe("newestMedia", () => {
	it("returns an audio file when there is no mp4", () => {
		const d = tmp()
		writeFileSync(join(d, "clip.wav"), "x")
		expect(newestMedia(d)?.endsWith("clip.wav")).toBe(true)
	})
	it("prefers an .mp4 over other media (render unchanged)", () => {
		const d = tmp()
		writeFileSync(join(d, "a.wav"), "x")
		writeFileSync(join(d, "out.mp4"), "x")
		expect(newestMedia(d)?.endsWith("out.mp4")).toBe(true)
	})
	it("null when the dir holds no media", () => {
		expect(newestMedia(tmp())).toBe(null)
	})
})

describe("stageAssets", () => {
	it("copies each asset into the work dir and returns the basenames", () => {
		const src = tmp()
		const srcFile = join(src, "b-roll.mov")
		writeFileSync(srcFile, "x")
		const wd = tmp()
		const staged = stageAssets(wd, [{ storagePath: srcFile }])
		expect(staged).toEqual(["b-roll.mov"])
		expect(readdirSync(wd)).toContain("b-roll.mov")
	})
	it("skips a missing asset without throwing", () => {
		const wd = tmp()
		expect(stageAssets(wd, [{ storagePath: "/does/not/exist.mp4" }])).toEqual([])
		expect(readdirSync(wd)).toHaveLength(0)
	})
})
