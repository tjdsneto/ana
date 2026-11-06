import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { emptyManifest, readManifest, seedManifest, sliceHash, writeSlice } from "./film-manifest.js"

const tmp = () => mkdtempSync(join(tmpdir(), "fm-"))

describe("film-manifest", () => {
	test("emptyManifest is the skeleton shape", () => {
		expect(emptyManifest()).toEqual({ script: [], camera: [], plates: {} })
	})

	test("readManifest returns empty when the file is missing", () => {
		expect(readManifest(join(tmp(), "film.json"))).toEqual({ script: [], camera: [], plates: {} })
	})

	test("readManifest parses an existing file", () => {
		const p = join(tmp(), "film.json")
		writeFileSync(p, JSON.stringify({ script: ["hi"], voice: { id: "rachel" } }))
		expect(readManifest(p)).toEqual({ script: ["hi"], voice: { id: "rachel" } })
	})

	test("seedManifest creates the skeleton, and is idempotent (never clobbers)", () => {
		const p = join(tmp(), "board", "film.json")
		seedManifest(p)
		expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ script: [], camera: [], plates: {} })
		writeFileSync(p, JSON.stringify({ script: ["keep me"] }))
		seedManifest(p) // second call must NOT overwrite
		expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ script: ["keep me"] })
	})

	test("writeSlice writes only the given keys and preserves the rest", () => {
		const p = join(tmp(), "film.json")
		seedManifest(p)
		writeSlice(p, { voice: { id: "rachel" } })
		const merged = writeSlice(p, { script: ["line one"] })
		expect(merged.voice).toEqual({ id: "rachel" }) // untouched by the second write
		expect(merged.script).toEqual(["line one"])
		expect(JSON.parse(readFileSync(p, "utf8")).voice).toEqual({ id: "rachel" })
	})

	test("sliceHash depends only on the named keys and is order-independent", () => {
		const m = { script: ["a"], voice: { id: "rachel" }, plates: {} }
		expect(sliceHash(m, ["script"])).toBe(sliceHash(m, ["script"]))
		expect(sliceHash(m, ["script", "voice"])).toBe(sliceHash(m, ["voice", "script"])) // arg order irrelevant
		expect(sliceHash(m, ["script"])).not.toBe(sliceHash({ ...m, script: ["b"] }, ["script"])) // value change → hash change
		expect(sliceHash(m, ["script"])).toBe(sliceHash({ ...m, voice: { id: "adam" } }, ["script"])) // a key NOT in the set doesn't affect it
	})
})
