#!/usr/bin/env node
// edl-apply.mjs pure helpers: segment validation + ffmpeg filtergraph building — without ffmpeg.
// The trim/concat/crop graph and segment rules are pure; the ffprobe + ffmpeg calls are thin I/O.
//   node craft/tools/tests/edl-apply.test.mjs   (exit 0 pass / 1 fail)
import assert from "node:assert"
import { validateSegments, buildVideoFilter, buildVideoFilterNoAudio, buildAudioFilter } from "../edl-apply.mjs"

function test_validate() {
	assert.deepEqual(validateSegments([], 10), [{ in: 0, out: 10 }], "empty -> whole asset")
	assert.deepEqual(validateSegments(undefined, 8), [{ in: 0, out: 8 }])
	assert.deepEqual(validateSegments([{ in: 2, out: 5 }], 10), [{ in: 2, out: 5 }])
	assert.throws(() => validateSegments([{ in: 5, out: 5 }], 10), /in < out/, "out<=in rejected")
	assert.throws(() => validateSegments([{ in: -1, out: 2 }], 10), /in < out/, "negative in rejected")
	assert.throws(() => validateSegments([{ in: 0, out: 99 }], 10), /exceeds source/, "beyond duration rejected")
}

function test_video_filter() {
	const g = buildVideoFilter([{ in: 2, out: 5 }, { in: 7, out: 9 }], null)
	assert.ok(g.includes("[0:v]trim=2:5,setpts=PTS-STARTPTS[v0];"), g)
	assert.ok(g.includes("[0:a]atrim=7:9,asetpts=PTS-STARTPTS[a1];"), g)
	assert.ok(g.endsWith("[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]"), g)
	// crop injected into the video chain
	const gc = buildVideoFilter([{ in: 0, out: 1 }], { x: 10, y: 20, w: 100, h: 50 })
	assert.ok(gc.includes("setpts=PTS-STARTPTS,crop=100:50:10:20[v0]"), gc)
}

function test_video_filter_no_audio() {
	const g = buildVideoFilterNoAudio([{ in: 0, out: 1 }, { in: 2, out: 3 }], null)
	assert.ok(!g.includes("[0:a]"), "no audio chain")
	assert.ok(g.endsWith("[v0][v1]concat=n=2:v=1:a=0[vout]"), g)
}

function test_audio_filter() {
	const g = buildAudioFilter([{ in: 1, out: 4 }], { gainDb: -3 })
	assert.ok(g.includes("[0:a]atrim=1:4,asetpts=PTS-STARTPTS[a0];"), g)
	assert.ok(g.includes("concat=n=1:v=0:a=1[ac]"), g)
	assert.ok(g.endsWith("[ac]volume=-3dB[aout]"), g)
	// no/zero gain -> passthrough
	assert.ok(buildAudioFilter([{ in: 0, out: 1 }], {}).endsWith("[ac]anull[aout]"))
	assert.ok(buildAudioFilter([{ in: 0, out: 1 }], { gainDb: 0 }).endsWith("[ac]anull[aout]"))
}

try {
	test_validate()
	test_video_filter()
	test_video_filter_no_audio()
	test_audio_filter()
	console.log("EDL-APPLY OK (validateSegments / video / video-no-audio / audio filters)")
} catch (e) {
	console.error(`EDL-APPLY FAIL: ${e.message}`)
	process.exit(1)
}
