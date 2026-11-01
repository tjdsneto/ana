#!/usr/bin/env node
// motion-graphics dispatcher: backend selection (pure). The render path is thin I/O (shells the
// chosen adapter), smoke-tested separately with a real HyperFrames render.
//   node craft/tools/tests/motion-graphics.test.mjs   (exit 0 pass / 1 fail)
import assert from "node:assert"
import { pickBackend } from "../motion-graphics/index.mjs"

try {
	assert.equal(pickBackend(undefined, undefined), "hyperframes", "default is hyperframes")
	assert.equal(pickBackend("remotion", undefined), "remotion", "env selects")
	assert.equal(pickBackend("remotion", "hyperframes"), "hyperframes", "flag overrides env")
	assert.equal(pickBackend("HyperFrames", undefined), "hyperframes", "case-insensitive")
	assert.throws(() => pickBackend("after-effects", undefined), /unknown backend/, "unknown rejected")
	console.log("MOTION-GRAPHICS OK (pickBackend: default / env / flag / unknown)")
} catch (e) {
	console.error(`MOTION-GRAPHICS FAIL: ${e.message}`)
	process.exit(1)
}
