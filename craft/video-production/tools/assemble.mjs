// assemble — concatenate the approved scene clips into the master film and mux the master audio.
//
// A craft TOOL (not engine code): the assemble skill calls it. The final render of the unified
// pipeline — the engine fans the storyboard into scenes, each scene is produced to its own
// <root>/scenes/<id>.mp4 (by any realization method), and this stitches them into one video on a
// single master timeline, laying the master audio (the multi-track mix from mix.py) over the top.
//
//   node craft/video-production/tools/assemble.mjs --root <workdir> --out <film.mp4> [--audio media/mix.wav] [--fps 30] [--size 1920x1080]
//
// Reads <root>/timeline.json if present — { "scenes": ["scenes/s1.mp4", ...], "audio": "media/mix.wav",
// "fps": 30, "size": [1920,1080] } — the master-timeline document (the NLE artifact a later visual
// editor renders). Otherwise it sorts <root>/scenes/*.mp4. Scene audio is dropped; the master audio
// is the single mixed track. Needs ffmpeg on PATH. Joins are hard cuts unless a scene entry is
// { "clip": ..., "out": "vertical_whip", "frames": 7 } — a vertical slide into the next scene with
// directional blur. The whip runs over a freeze of the outgoing clip's last frame, so it adds no
// overlap and every scene still starts on its VO-timed frame. "duration" (s) trims the master tail.

import { readdirSync, existsSync, readFileSync } from "node:fs"
import { join, resolve, isAbsolute } from "node:path"
import { spawnSync } from "node:child_process"

function arg(name, def) {
	const i = process.argv.indexOf(name)
	return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const root = resolve(arg("--root", "."))
const outPath = resolve(arg("--out", join(root, "film.mp4")))

// master-timeline document, or fall back to sorted scenes/*.mp4
let scenes, audioRel, outs = [], tl = {}
const tlPath = join(root, "timeline.json")
if (existsSync(tlPath)) {
	tl = JSON.parse(readFileSync(tlPath, "utf8"))
	scenes = (tl.scenes || []).map((s) => (typeof s === "string" ? s : s.clip))
	outs = (tl.scenes || []).map((s) => (typeof s === "string" || !s.out ? null : { type: s.out, frames: Number(s.frames || 7) }))
	audioRel = tl.audio
} else {
	const dir = join(root, "scenes")
	scenes = existsSync(dir)
		? readdirSync(dir).filter((f) => f.endsWith(".mp4")).sort().map((f) => join("scenes", f))
		: []
}
const audioArg = arg("--audio", audioRel || null)
const fps = Number(arg("--fps", String(tl.fps || 30)))
const [W, H] = arg("--size", tl.size ? tl.size.join("x") : "1920x1080").split("x").map(Number)
const duration = arg("--duration", tl.duration != null ? String(tl.duration) : null)

const abs = (p) => (isAbsolute(p) ? p : join(root, p))
const clips = scenes.map(abs)
if (clips.length === 0) {
	console.error(`assemble: no scene clips (looked in timeline.json and ${join(root, "scenes")})`)
	process.exit(2)
}
for (const c of clips) {
	if (!existsSync(c)) {
		console.error(`assemble: scene clip missing: ${c}`)
		process.exit(2)
	}
}

function frameCount(c) {
	const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets,r_frame_rate", "-of", "json", c], { encoding: "utf8" })
	const st = JSON.parse(r.stdout).streams[0]
	const [n, d] = st.r_frame_rate.split("/").map(Number)
	return Math.round((Number(st.nb_read_packets) / (n / d)) * fps)
}

// Normalize each scene to the master size/fps, then join (video only — scene audio dropped).
const inputs = clips.flatMap((c) => ["-i", c])
const scaled = clips
	.map((_, i) => {
		// a whip-out clip holds its last frame for the whip (padded per clip: tpad after xfade stalls the chain)
		const pad = outs[i] && outs[i].type === "vertical_whip" && i < clips.length - 1 ? `,tpad=stop_mode=clone:stop=${outs[i].frames}` : ""
		return `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,settb=AVTB${pad}[v${i}]`
	})
	.join(";")
let filter
if (outs.some(Boolean)) {
	const parts = [scaled]
	const blurs = []
	let cur = "v0", frames = frameCount(clips[0])
	for (let i = 1; i < clips.length; i++) {
		const t = outs[i - 1], next = `j${i}`
		if (t && t.type === "vertical_whip") {
			// offset half a frame early: xfade starts on the first frame with pts >= offset, and the
			// chained pts can land a hair under frames/fps — an exact offset then slips the cut 1 frame
			const d = t.frames / fps, at = (frames - 0.5) / fps
			parts.push(`[${cur}][v${i}]xfade=transition=slideup:duration=${d.toFixed(6)}:offset=${at.toFixed(6)}[${next}]`)
			blurs.push(`between(t,${at.toFixed(4)},${(at + d).toFixed(4)})`)
		} else {
			if (t) console.error(`assemble: unknown transition "${t.type}" — hard cut`)
			parts.push(`[${cur}][v${i}]concat=n=2:v=1:a=0[${next}]`)
		}
		cur = next
		frames += frameCount(clips[i])
	}
	const blur = blurs.length ? `avgblur=sizeX=1:sizeY=${Math.round(H / 40)}:enable='${blurs.join("+")}'` : "null"
	parts.push(`[${cur}]${blur}[v]`)
	filter = parts.join(";")
} else {
	filter = `${scaled};` + clips.map((_, i) => `[v${i}]`).join("") + `concat=n=${clips.length}:v=1:a=0[v]`
}

const args = ["-y", ...inputs]
if (audioArg) args.push("-i", abs(audioArg))
args.push("-filter_complex", filter, "-map", "[v]")
if (audioArg) args.push("-map", `${clips.length}:a`, "-c:a", "aac", "-b:a", "192k", "-shortest")
if (duration) args.push("-t", duration)
args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(fps), outPath)

const ff = spawnSync("ffmpeg", ["-v", "error", ...args], { stdio: ["ignore", "ignore", "inherit"] })
if (ff.status !== 0) {
	console.error(`assemble: ffmpeg failed (code ${ff.status})`)
	process.exit(4)
}
console.log(`assemble: ${clips.length} scenes -> ${outPath}${audioArg ? " (+ master audio)" : ""}`)
