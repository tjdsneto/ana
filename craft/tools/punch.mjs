#!/usr/bin/env node
// punch — a ken-burns punch-in (animated zoom) on a video, via ffmpeg zoompan. A craft tool for the
// edit-footage leaf: after edl-apply cuts the piece, Claude can zoom into a moment to emphasize it.
// Node + ffmpeg only (both baked) — no container change.
//
//   node craft/tools/punch.mjs --in clip.mp4 --out clip-punch.mp4 [--zoom 1.3] [--fps 30] [--to 0.5,0.5]
//
// --zoom = target magnification at the end (1.0 = none). --to = the point to zoom toward, as x,y
// fractions of the frame (0,0 top-left … 1,1 bottom-right; default centre). Audio is copied through.
// buildZoompan is pure (unit-tested in tests/punch.test.mjs).
import { execFileSync } from "node:child_process"
import { mkdirSync, existsSync } from "node:fs"
import { dirname } from "node:path"

export function buildZoompan({ durationSec, fps, zoom, cx, cy, width, height }) {
	const n = Math.max(1, Math.round(durationSec * fps)) // total output frames the ramp spans
	const z = `min(1+(${zoom}-1)*on/${n},${zoom})` // 1 → zoom, linear over the clip
	// hold the chosen point as the frame shrinks (x/y use the current `zoom`)
	const x = `(iw-iw/zoom)*${cx}`
	const y = `(ih-ih/zoom)*${cy}`
	return `zoompan=z='${z}':d=1:x='${x}':y='${y}':s=${width}x${height}:fps=${fps}`
}

function probe(src) {
	const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
		"stream=width,height:format=duration", "-of", "json", src], { encoding: "utf8" })
	const j = JSON.parse(out)
	const s = (j.streams || [])[0] || {}
	return { width: Number(s.width), height: Number(s.height), duration: Number(j.format?.duration) || 0 }
}
function hasAudio(src) {
	const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries",
		"stream=index", "-of", "csv=p=0", src], { encoding: "utf8" })
	return out.trim().length > 0
}

function parseArgs(argv) {
	const a = { inp: null, out: null, zoom: 1.3, fps: 30, cx: 0.5, cy: 0.5 }
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--in") a.inp = argv[++i]
		else if (argv[i] === "--out") a.out = argv[++i]
		else if (argv[i] === "--zoom") a.zoom = Number(argv[++i])
		else if (argv[i] === "--fps") a.fps = Number(argv[++i])
		else if (argv[i] === "--to") { const [x, y] = argv[++i].split(","); a.cx = Number(x); a.cy = Number(y) }
		else throw new Error(`punch: unknown arg ${argv[i]}`)
	}
	if (!a.inp || !a.out) throw new Error("punch: --in and --out are required")
	if (!(a.zoom >= 1)) throw new Error("punch: --zoom must be >= 1")
	return a
}

function main() {
	const a = parseArgs(process.argv.slice(2))
	if (!existsSync(a.inp)) throw new Error(`punch: input not found: ${a.inp}`)
	const { width, height, duration } = probe(a.inp)
	if (!width || !height) throw new Error(`punch: could not read video size of ${a.inp}`)
	const vf = buildZoompan({ durationSec: duration, fps: a.fps, zoom: a.zoom, cx: a.cx, cy: a.cy, width, height })
	mkdirSync(dirname(a.out) || ".", { recursive: true })
	const audio = hasAudio(a.inp) ? ["-c:a", "copy"] : []
	execFileSync("ffmpeg", ["-v", "error", "-y", "-i", a.inp, "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", ...audio, a.out],
		{ stdio: ["ignore", "inherit", "inherit"] })
	process.stdout.write(`punch: zoom->${a.zoom} @ (${a.cx},${a.cy}) ${width}x${height} -> ${a.out}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try { main() } catch (e) { process.stderr.write(`${e.message}\n`); process.exit(1) }
}
