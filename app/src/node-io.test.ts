import { describe, expect, test } from "vitest"
import { nodeFileIO } from "./node-io.js"

const PID = "nd_prod1"

describe("nodeFileIO", () => {
	test("build-voice reads the script + board, writes the narration + timing", () => {
		const io = nodeFileIO("build-voice", PID)
		expect(io.reads.map((r) => [r.label, r.path])).toEqual([
			["script.txt", "nd_prod1/board/script.txt"],
			["film.json", "nd_prod1/board/film.json"],
		])
		expect(io.writes.map((r) => [r.label, r.path])).toEqual([
			["vo.wav", "nd_prod1/board/media/vo.wav"],
			["words.json", "nd_prod1/board/media/words.json"],
		])
	})

	test("build-soundtrack reads the board + VO timing, writes the mix", () => {
		const io = nodeFileIO("build-soundtrack", PID)
		expect(io.reads.map((r) => r.label)).toEqual(["film.json", "words.json"])
		expect(io.writes.map((r) => r.path)).toEqual([
			"nd_prod1/board/audio/soundtrack.wav",
			"nd_prod1/board/audio/bed.mp3",
			"nd_prod1/board/audio/audio-plan.json",
		])
	})

	test("build-assets reads the board, writes the asset manifest", () => {
		const io = nodeFileIO("build-assets", PID)
		expect(io.reads.map((r) => r.path)).toEqual(["nd_prod1/board/film.json"])
		expect(io.writes.map((r) => r.path)).toEqual(["nd_prod1/assets/assets.json"])
	})

	test("assemble-board writes the composed board film.json", () => {
		const io = nodeFileIO("assemble-board", PID)
		expect(io.writes.map((r) => r.path)).toEqual(["nd_prod1/board/film.json"])
	})

	test("a text-only step has no side files", () => {
		expect(nodeFileIO("script", PID)).toEqual({ reads: [], writes: [] })
		expect(nodeFileIO("briefing", PID)).toEqual({ reads: [], writes: [] })
	})
})
