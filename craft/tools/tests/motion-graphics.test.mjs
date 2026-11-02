#!/usr/bin/env node
// motion-graphics dispatcher: backend selection (pure). The render path is thin I/O (shells the
// chosen adapter), smoke-tested separately with a real HyperFrames render.
//   node craft/tools/tests/motion-graphics.test.mjs   (exit 0 pass / 1 fail)
import assert from "node:assert"
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pickBackend, isLocalRef, inlineAssets } from "../motion-graphics/index.mjs"

try {
	assert.equal(pickBackend(undefined, undefined), "hyperframes", "default is hyperframes")
	assert.equal(pickBackend("remotion", undefined), "remotion", "env selects")
	assert.equal(pickBackend("remotion", "hyperframes"), "hyperframes", "flag overrides env")
	assert.equal(pickBackend("HyperFrames", undefined), "hyperframes", "case-insensitive")
	assert.throws(() => pickBackend("after-effects", undefined), /unknown backend/, "unknown rejected")
	console.log("MOTION-GRAPHICS OK (pickBackend: default / env / flag / unknown)")

	// isLocalRef: only on-disk refs are candidates for inlining
	assert.equal(isLocalRef("assets/x.png"), true)
	assert.equal(isLocalRef("../a/b.png"), true)
	assert.equal(isLocalRef("https://cdn/x.js"), false)
	assert.equal(isLocalRef("data:image/png;base64,AA"), false)
	assert.equal(isLocalRef("//cdn/x"), false)
	assert.equal(isLocalRef(""), false)

	// inlineAssets: a local src becomes a data URI, a remote src is untouched, and a composition with
	// no local refs is returned as-is (no temp file). Resolves relative to the HTML's own dir.
	const d = mkdtempSync(join(tmpdir(), "mg-test-"))
	writeFileSync(join(d, "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
	const htmlPath = join(d, "c.html")
	writeFileSync(htmlPath, '<img src="pic.png"><script src="https://cdn/gsap.js"></script>')
	const prepared = inlineAssets(htmlPath)
	assert.notEqual(prepared, htmlPath, "prepared is a new file when something inlined")
	const out = readFileSync(prepared, "utf8")
	assert.ok(out.includes("data:image/png;base64,"), "local src inlined to a data URI")
	assert.ok(out.includes("https://cdn/gsap.js"), "remote src left untouched")

	const htmlPath2 = join(d, "c2.html")
	writeFileSync(htmlPath2, '<script src="https://cdn/gsap.js"></script>')
	assert.equal(inlineAssets(htmlPath2), htmlPath2, "no local refs -> original path returned")
	console.log("MOTION-GRAPHICS OK (isLocalRef / inlineAssets)")
} catch (e) {
	console.error(`MOTION-GRAPHICS FAIL: ${e.message}`)
	process.exit(1)
}
