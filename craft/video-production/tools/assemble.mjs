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
// is the single mixed track. Needs ffmpeg on PATH. Transitions are hard cuts for now.

import { readdirSync, existsSync, readFileSync } from "node:fs"
import { join, resolve, isAbsolute } from "node:path"
import { spawnSync } from "node:child_process"

function arg(name, def) {
	const i = process.argv.indexOf(name)
	return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const root = resolve(arg("--root", "."))
const outPath = resolve(arg("--out", join(root, "film.mp4")))
const fps = Number(arg("--fps", "30"))
const [W, H] = arg("--size", "1920x1080").split("x").map(Number)

// master-timeline document, or fall back to sorted scenes/*.mp4
let scenes, audioRel
const tlPath = join(root, "timeline.json")
if (existsSync(tlPath)) {
	const tl = JSON.parse(readFileSync(tlPath, "utf8"))
	scenes = (tl.scenes || []).map((s) => (typeof s === "string" ? s : s.clip))
	audioRel = tl.audio
} else {
	const dir = join(root, "scenes")
	scenes = existsSync(dir)
		? readdirSync(dir).filter((f) => f.endsWith(".mp4")).sort().map((f) => join("scenes", f))
		: []
}
const audioArg = arg("--audio", audioRel || null)

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

// Normalize each scene to the master size/fps, then concat (video only — scene audio dropped).
const inputs = clips.flatMap((c) => ["-i", c])
const scaled = clips
	.map((_, i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[v${i}]`)
	.join(";")
const concat = clips.map((_, i) => `[v${i}]`).join("") + `concat=n=${clips.length}:v=1:a=0[v]`
const filter = `${scaled};${concat}`

const args = ["-y", ...inputs]
if (audioArg) args.push("-i", abs(audioArg))
args.push("-filter_complex", filter, "-map", "[v]")
if (audioArg) args.push("-map", `${clips.length}:a`, "-c:a", "aac", "-b:a", "192k", "-shortest")
args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(fps), outPath)

const ff = spawnSync("ffmpeg", ["-v", "error", ...args], { stdio: ["ignore", "ignore", "inherit"] })
if (ff.status !== 0) {
	console.error(`assemble: ffmpeg failed (code ${ff.status})`)
	process.exit(4)
}
console.log(`assemble: ${clips.length} scenes -> ${outPath}${audioArg ? " (+ master audio)" : ""}`)
