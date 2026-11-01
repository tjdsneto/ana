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
	// video layers must have metadata (duration/dimensions) before we can seek them per frame
	await Promise.all([...document.querySelectorAll("video.layer")].map((v) =>
		v.readyState >= 1 ? null : new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }))
	))
})
// Warm-up: force every plate image to raster once (large images otherwise paint blank on first use).
const saved = await page.evaluate(() => [...document.querySelectorAll("img.shot")].map((im) => { const o = im.style.opacity; im.style.opacity = "1"; return o }))
await page.waitForTimeout(800)
await page.screenshot({ type: "jpeg", quality: 10, clip: { x: 0, y: 0, width, height } })
await page.evaluate((saved) => [...document.querySelectorAll("img.shot")].forEach((im, i) => { im.style.opacity = saved[i] }), saved)
const duration = await page.evaluate(() => window.__duration || window.__timelines.main.duration())
const frames = Math.max(1, Math.ceil(duration * fps))

const dir = mkdtempSync(join(tmpdir(), "render-frames-"))
console.log(`render: ${duration.toFixed(2)}s @ ${fps}fps = ${frames} frames, ${width}x${height}`)
for (let i = 0; i < frames; i++) {
	const t = Math.min(duration, i / fps)
	// seek the paused timeline + sync each video layer's currentTime, then wait two animation
	// frames so CSS transforms/filters and the decoded video frame paint
	await page.evaluate(async (t) => {
		window.__timelines.main.seek(t)
		await Promise.all([...document.querySelectorAll("video.layer")].map((v) => {
			const vin = parseFloat(v.dataset.in || "0")
			const dur = isFinite(v.duration) ? v.duration : Infinity
			const ct = Math.max(0, Math.min(dur - 0.001, t - vin))
			if (Math.abs(v.currentTime - ct) < 1e-3) return null
			return new Promise((r) => {
				v.addEventListener("seeked", r, { once: true })
				v.currentTime = ct
			})
		}))
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
