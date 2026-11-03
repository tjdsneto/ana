#!/usr/bin/env node
// edl-apply — apply an Edit Decision List to a caller-provided asset, producing a derived asset.
//
// A craft TOOL (not engine code), for the `clip` leaf / `edit-footage` skill: Claude inspects a
// provided video/audio asset and writes an EDL (the cut plan); this tool executes it with ffmpeg.
// Node + ffmpeg are both already baked into the engine image, so this needs no container change
// (python is NOT baked — hence node, not a .py tool; native JSON, no jq).
//
// EDL contract (JSON — the control artifact, the editor-mode analogue of the storyboard):
//   {
//     "source":   "<path to the provided asset>",       // required (assetId resolution: later)
//     "segments": [ { "in": <sec>, "out": <sec> }, ... ], // ordered keep-ranges; concatenated in order
//     "crop":     { "x":, "y":, "w":, "h": },            // optional, video only (pixels)
//     "audio":    { "channels": <n>, "gainDb": <dB> }    // optional (channels downmix; gain)
//   }
// Omit "segments" (or []) to keep the whole asset. "captions" is reserved for the motion-graphics
// skill, not applied here. Video out = H.264/AAC mp4; audio out = by --out extension (wav/mp3/...).
//
//   node craft/video-production/tools/edl-apply.mjs --edl cut.json --out clip.mp4
//   node craft/video-production/tools/edl-apply.mjs --edl-json '{"source":"a.mp4","segments":[{"in":2,"out":5}]}' --out clip.mp4
//
// Pure helpers (parseArgs/loadEdl aside) buildVideoFilter / buildAudioFilter / validateSegments are
// I/O-free and unit-tested in craft/video-production/tools/tests/edl-apply.test.mjs (run under node via ./x).

import { execFileSync } from "node:child_process"
import { readFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

export function validateSegments(segments, duration) {
	// Normalize + validate. No segments -> one whole-asset segment. Throws on bad ranges.
	if (!segments || segments.length === 0) return [{ in: 0, out: duration }]
	const out = []
	for (const [i, s] of segments.entries()) {
		const a = Number(s.in), b = Number(s.out)
		if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`segment ${i}: in/out must be numbers`)
		if (a < 0 || b <= a) throw new Error(`segment ${i}: need 0 <= in < out (got in=${a}, out=${b})`)
		if (duration && b > duration + 0.05) throw new Error(`segment ${i}: out ${b}s exceeds source ${duration}s`)
		out.push({ in: a, out: b })
	}
	return out
}

export function buildVideoFilter(segments, crop) {
	// filter_complex that trims each segment of stream 0 (v+a), optional crop, then concatenates.
	const cropF = crop ? `,crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}` : ""
	let g = ""
	for (const [i, s] of segments.entries()) {
		g += `[0:v]trim=${s.in}:${s.out},setpts=PTS-STARTPTS${cropF}[v${i}];`
		g += `[0:a]atrim=${s.in}:${s.out},asetpts=PTS-STARTPTS[a${i}];`
	}
	for (let i = 0; i < segments.length; i++) g += `[v${i}][a${i}]`
	g += `concat=n=${segments.length}:v=1:a=1[vout][aout]`
	return g
}

export function buildVideoFilterNoAudio(segments, crop) {
	const cropF = crop ? `,crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}` : ""
	let g = ""
	for (const [i, s] of segments.entries()) g += `[0:v]trim=${s.in}:${s.out},setpts=PTS-STARTPTS${cropF}[v${i}];`
	for (let i = 0; i < segments.length; i++) g += `[v${i}]`
	g += `concat=n=${segments.length}:v=1:a=0[vout]`
	return g
}

export function buildAudioFilter(segments, audio) {
	// atrim+concat of stream 0's audio, optional gain (volume). Channels handled via -ac (output opt).
	let g = ""
	for (const [i, s] of segments.entries()) g += `[0:a]atrim=${s.in}:${s.out},asetpts=PTS-STARTPTS[a${i}];`
	for (let i = 0; i < segments.length; i++) g += `[a${i}]`
	g += `concat=n=${segments.length}:v=0:a=1[ac]`
	const gain = audio && Number.isFinite(Number(audio.gainDb)) && Number(audio.gainDb) !== 0
	g += gain ? `;[ac]volume=${Number(audio.gainDb)}dB[aout]` : `;[ac]anull[aout]`
	return g
}

// ---------- I/O ----------

function ffprobeStreams(src) {
	const out = execFileSync("ffprobe", ["-v", "error", "-show_entries",
		"stream=codec_type:format=duration", "-of", "json", src], { encoding: "utf8" })
	const j = JSON.parse(out)
	const types = new Set((j.streams || []).map((s) => s.codec_type))
	return { hasVideo: types.has("video"), hasAudio: types.has("audio"), duration: Number(j.format?.duration) || 0 }
}

function ff(args) {
	execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] })
}

function parseArgs(argv) {
	const a = { edl: null, edlJson: null, out: null }
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--edl") a.edl = argv[++i]
		else if (argv[i] === "--edl-json") a.edlJson = argv[++i]
		else if (argv[i] === "--out") a.out = argv[++i]
		else throw new Error(`edl-apply: unknown arg ${argv[i]}`)
	}
	if (!a.out) throw new Error("edl-apply: --out is required")
	if (!a.edl && !a.edlJson) throw new Error("edl-apply: --edl <file> or --edl-json <json> is required")
	return a
}

function main() {
	const a = parseArgs(process.argv.slice(2))
	const edl = a.edlJson ? JSON.parse(a.edlJson) : JSON.parse(readFileSync(a.edl, "utf8"))
	if (!edl.source) throw new Error("edl-apply: EDL needs a `source` path")

	const { hasVideo, hasAudio, duration } = ffprobeStreams(edl.source)
	const segments = validateSegments(edl.segments, duration)
	mkdirSync(dirname(a.out) || ".", { recursive: true })

	if (hasVideo) {
		if (edl.crop && !(edl.crop.w > 0 && edl.crop.h > 0)) throw new Error("edl-apply: crop needs positive w/h")
		const filter = hasAudio ? buildVideoFilter(segments, edl.crop) : buildVideoFilterNoAudio(segments, edl.crop)
		const maps = hasAudio ? ["-map", "[vout]", "-map", "[aout]"] : ["-map", "[vout]"]
		const ac = edl.audio?.channels ? ["-ac", String(edl.audio.channels)] : []
		ff(["-i", edl.source, "-filter_complex", filter, ...maps,
			"-c:v", "libx264", "-pix_fmt", "yuv420p", ...(hasAudio ? ["-c:a", "aac", ...ac] : []), a.out])
	} else if (hasAudio) {
		const filter = buildAudioFilter(segments, edl.audio)
		const ac = edl.audio?.channels ? ["-ac", String(edl.audio.channels)] : []
		ff(["-i", edl.source, "-filter_complex", filter, "-map", "[aout]", ...ac, a.out])
	} else {
		throw new Error(`edl-apply: source has neither video nor audio: ${edl.source}`)
	}

	const total = segments.reduce((t, s) => t + (s.out - s.in), 0)
	process.stdout.write(`edl-apply: ${segments.length} segment(s), ~${total.toFixed(2)}s ${hasVideo ? "video" : "audio"}${edl.crop ? " +crop" : ""} -> ${a.out}\n`)
}

// Only run when invoked directly, so the test file can import the pure helpers.
if (import.meta.url === `file://${process.argv[1]}`) {
	try { main() } catch (e) { process.stderr.write(`${e.message}\n`); process.exit(1) }
}
