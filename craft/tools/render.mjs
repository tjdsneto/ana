// render — seek the built GSAP composition frame by frame and encode to MP4 (the Family-A renderer).
//
// A craft TOOL (not engine code): the render skill calls it. Replaces HyperFrames with a headless
// Chrome frame loop (spec 09): load index.html, seek window.__timelines.main to t = frame/fps (paused),
// let it paint, screenshot. Then ffmpeg encodes the frames and muxes the voiceover, mastered to
// -14 LUFS. Deterministic — each frame is the timeline sampled at a fixed time.
//
//   node craft/tools/render.mjs --html <index.html> --audio <vo.wav> --out <out.mp4> [--fps 30]
//
// Browser: Playwright chromium (falls back to the installed Chrome channel). Needs ffmpeg on PATH.

import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const require = createRequire(import.meta.url)
const { chromium } = require("playwright")

function arg(name, def) {
	const i = process.argv.indexOf(name)
	return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const htmlPath = resolve(arg("--html", ""))
const audioPath = arg("--audio", null)
const outPath = resolve(arg("--out", ""))
const fps = Number(arg("--fps", "30"))
const width = Number(arg("--width", "1920"))
const height = Number(arg("--height", "1080"))
const master = !process.argv.includes("--no-master") // loudnorm the audio unless it's already mastered (mix.wav)
if (!htmlPath || !outPath) {
	console.error("render: --html and --out are required")
	process.exit(2)
}

const browser = await chromium
	.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
	.catch(() => chromium.launch({ channel: "chrome" }))
	.catch((e) => {
		console.error(`render: no browser for Playwright — ${e.message}`)
		process.exit(3)
	})
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle", timeout: 60000 })

// Wait until GSAP loaded, the timeline is exposed, and the plate images have decoded.
await page.waitForFunction(() => !!(window.__timelines && window.__timelines.main && window.gsap), null, { timeout: 30000 })
await page.evaluate(async () => {
	await Promise.all([...document.images].map((im) => (im.complete ? null : im.decode().catch(() => {}))))
})
const duration = await page.evaluate(() => window.__duration || window.__timelines.main.duration())
const frames = Math.max(1, Math.ceil(duration * fps))

const dir = mkdtempSync(join(tmpdir(), "render-frames-"))
console.log(`render: ${duration.toFixed(2)}s @ ${fps}fps = ${frames} frames, ${width}x${height}`)
for (let i = 0; i < frames; i++) {
	const t = Math.min(duration, i / fps)
	// seek the paused timeline, then wait two animation frames so CSS transforms/filters paint
	await page.evaluate((t) => {
		window.__timelines.main.seek(t)
		return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
	}, t)
	await page.screenshot({ path: join(dir, `f${String(i).padStart(5, "0")}.jpg`), type: "jpeg", quality: 95, clip: { x: 0, y: 0, width, height } })
	if (i % 60 === 0) process.stdout.write(`  frame ${i}/${frames}\r`)
}
await browser.close()

// Encode frames + mux the voiceover, mastered to -14 LUFS (true peak -1.5 dBFS).
const args = ["-y", "-framerate", String(fps), "-i", join(dir, "f%05d.jpg")]
if (audioPath) {
	args.push("-i", resolve(audioPath))
	if (master) args.push("-af", "loudnorm=I=-14:TP=-1.5:LRA=11")
}
args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(fps))
if (audioPath) args.push("-c:a", "aac", "-b:a", "192k", "-shortest")
args.push(outPath)
const ff = spawnSync("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] })
rmSync(dir, { recursive: true, force: true })
if (ff.status !== 0) {
	console.error(`render: ffmpeg failed (code ${ff.status})`)
	process.exit(4)
}
console.log(`render: wrote ${outPath}`)
