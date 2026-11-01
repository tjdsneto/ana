#!/usr/bin/env node
// punch.mjs pure helper: the zoompan expression. The ffprobe + ffmpeg calls are thin I/O.
//   node craft/tools/tests/punch.test.mjs   (exit 0 pass / 1 fail)
import assert from "node:assert"
import { buildZoompan } from "../punch.mjs"

try {
	const vf = buildZoompan({ durationSec: 2, fps: 30, zoom: 1.5, cx: 0.5, cy: 0.5, width: 1280, height: 720 })
	assert.ok(vf.startsWith("zoompan=z="), vf)
	assert.ok(vf.includes("min(1+(1.5-1)*on/60,1.5)"), vf) // ramp over 2s*30 = 60 frames to 1.5x
	assert.ok(vf.includes("s=1280x720"), vf)
	assert.ok(vf.includes("fps=30"), vf)
	assert.ok(vf.includes("(iw-iw/zoom)*0.5") && vf.includes("(ih-ih/zoom)*0.5"), vf) // centre
	// off-centre target
	const vf2 = buildZoompan({ durationSec: 1, fps: 25, zoom: 1.2, cx: 0.8, cy: 0.2, width: 640, height: 480 })
	assert.ok(vf2.includes("*0.8") && vf2.includes("*0.2"), vf2)
	assert.ok(vf2.includes("on/25"), vf2)
	console.log("PUNCH OK (buildZoompan: ramp / size / fps / target)")
} catch (e) {
	console.error(`PUNCH FAIL: ${e.message}`)
	process.exit(1)
}
