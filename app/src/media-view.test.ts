import { describe, expect, test } from "vitest"
import { fileViewKind, isBoardShape, isCard, isFilm, pairVoiceClips, parseJsonLoose, prettyJson, sceneNumFromName, splitScriptLines } from "./media-view.js"

describe("fileViewKind", () => {
	test("classifies by extension, case-insensitive", () => {
		expect(fileViewKind("vo.wav")).toBe("audio")
		expect(fileViewKind("track.MP3")).toBe("audio")
		expect(fileViewKind("hero.png")).toBe("image")
		expect(fileViewKind("clip.mp4")).toBe("video")
		expect(fileViewKind("words.json")).toBe("json")
	})
	test("anything else reads as plain text", () => {
		expect(fileViewKind("script.txt")).toBe("text")
		expect(fileViewKind("notes.md")).toBe("text")
		expect(fileViewKind("captions.srt")).toBe("text")
	})
})

describe("sceneNumFromName", () => {
	test("parses the scene number from the sNN convention", () => {
		expect(sceneNumFromName("s01.wav")).toBe(1)
		expect(sceneNumFromName("s03.wav")).toBe(3)
		expect(sceneNumFromName("s10.wav")).toBe(10)
		expect(sceneNumFromName("S07.MP3")).toBe(7)
	})
	test("returns null when the name doesn't match", () => {
		expect(sceneNumFromName("vo.wav")).toBeNull()
		expect(sceneNumFromName("scene-1.wav")).toBeNull()
	})
})

describe("splitScriptLines", () => {
	test("trims, drops blank lines, keeps order", () => {
		expect(splitScriptLines("One.\n\n  Two.  \r\nThree.\n")).toEqual(["One.", "Two.", "Three."])
	})
})

describe("pairVoiceClips", () => {
	const clip = (name: string) => ({ name, path: `vo/piper/${name}` })

	test("pairs each line with its sNN clip by scene number", () => {
		const lines = ["Line one.", "Line two.", "Line three."]
		const clips = [clip("s03.wav"), clip("s01.wav"), clip("s02.wav")] // out of order on purpose
		const rows = pairVoiceClips(lines, clips)
		expect(rows.map((r) => [r.n, r.text, r.clip?.name])).toEqual([
			[1, "Line one.", "s01.wav"],
			[2, "Line two.", "s02.wav"],
			[3, "Line three.", "s03.wav"],
		])
	})

	test("a line with no clip still shows (clip undefined)", () => {
		const rows = pairVoiceClips(["a", "b"], [clip("s01.wav")])
		expect(rows[1]).toEqual({ n: 2, text: "b", clip: undefined })
	})

	test("a clip past the last line still shows (empty text)", () => {
		const rows = pairVoiceClips(["a"], [clip("s01.wav"), clip("s02.wav")])
		expect(rows).toHaveLength(2)
		expect(rows[1]).toEqual({ n: 2, text: "", clip: clip("s02.wav") })
	})

	test("without the sNN convention, pairs by list order", () => {
		const clips = [clip("alpha.wav"), clip("beta.wav")]
		const rows = pairVoiceClips(["one", "two"], clips)
		expect(rows.map((r) => r.clip?.name)).toEqual(["alpha.wav", "beta.wav"])
	})
})

describe("prettyJson", () => {
	test("re-indents valid JSON", () => {
		expect(prettyJson('{"a":1,"b":[2,3]}')).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}')
	})
	test("returns the raw text unchanged when it isn't JSON", () => {
		expect(prettyJson("not json")).toBe("not json")
	})
})

describe("parseJsonLoose", () => {
	test("parses a bare object/array", () => {
		expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 })
		expect(parseJsonLoose("[1,2]")).toEqual([1, 2])
	})
	test("pulls a fenced ```json block out of prose", () => {
		expect(parseJsonLoose('here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
	})
	test("null when there is no JSON", () => {
		expect(parseJsonLoose("just prose")).toBeNull()
	})
})

describe("artifact shape detectors", () => {
	const film = { size: [1080, 1080], voice: { id: "x" }, script: ["a", "b"], camera: [{ plate: "p", at: "a" }], plates: {} }
	const planArray = [{ name: "beat 1", brief: "…" }, { name: "beat 2", brief: "…" }]
	const boardObj = { theme: {}, beats: [{ vo: "a" }] }
	const card = { id: "c1", vo_line: "hi", plate_html: "<div/>" }
	const wordsJson = { duration: 44, words: [{ text: "a", start: 0, end: 1, line: 1 }] }

	test("isFilm matches a film.json, not a plain board/words.json", () => {
		expect(isFilm(film)).toBe(true)
		expect(isFilm(boardObj)).toBe(false)
		expect(isFilm(wordsJson)).toBe(false)
	})
	test("isBoardShape matches a plan array or a beats object, never a film.json", () => {
		expect(isBoardShape(planArray)).toBe(true)
		expect(isBoardShape(boardObj)).toBe(true)
		expect(isBoardShape(film)).toBe(false) // film has no beats — must fall through to the film view
		expect(isBoardShape(wordsJson)).toBe(false)
	})
	test("isCard matches a plate-bearing object only", () => {
		expect(isCard(card)).toBe(true)
		expect(isCard(film)).toBe(false)
	})
})
