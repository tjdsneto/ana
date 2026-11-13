// render — seek the built GSAP composition frame by frame and encode to MP4 (the Family-A renderer).
//
// A craft TOOL (not engine code): the render skill calls it. Replaces HyperFrames with a headless
// Chrome frame loop (spec 09): load index.html, seek window.__timelines.main to t = frame/fps (paused),
// let it paint, screenshot. Then ffmpeg encodes the frames and muxes the voiceover, mastered to
// -14 LUFS. Deterministic — each frame is the timeline sampled at a fixed time.
//
//   node craft/video-production/tools/render.mjs --html <index.html> --audio <vo.wav> --out <out.mp4> [--fps 30]
//
// Browser: Playwright chromium (falls back to the installed Chrome channel). Needs ffmpeg on PATH.

import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
// 0033: optional layout-geometry dump — the renderer's OWN element boxes/colours/fonts per sampled
// frame, which the engine's deterministic pre-pass (engine/src/layout-inspect.ts) inspects BEFORE the
// model final-review. Off unless --geometry-out is given, so existing renders are byte-for-byte
// unchanged; the render-film / assemble skills pass `--geometry-out board/frames.json`. The checks and
// their thresholds live in the engine; this only emits the geometry it reads. Contract + the authoring
// data-* attributes: craft/video-production/docs/frame-geometry.md.
const geometryOut = arg("--geometry-out", null)
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
// 0033 geometry capture — accumulate per-frame element boxes/colours/fonts (read from the live DOM the
// renderer just painted) when --geometry-out is set. Best-effort + guarded: any failure logs and the
// render proceeds untouched. `beat` comes from an element's data-beat (the composition authors it per
// card/scene); `hold` is derived post-loop from motion settling. See docs/frame-geometry.md.
const geomSamples = geometryOut ? [] : null
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
	if (geomSamples) {
		try {
			const els = await page.evaluate(() => {
				const toRGB = (s) => { const m = (s || "").match(/\d+(\.\d+)?/g); return m && m.length >= 3 ? [Math.round(+m[0]), Math.round(+m[1]), Math.round(+m[2])] : undefined }
				// walk up for the first non-transparent background (the element's immediate ground)
				const bgOf = (node) => { for (let n = node; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; const rgb = toRGB(c); if (rgb && !/rgba\(.*,\s*0\)/.test(c)) return rgb } return undefined }
				const out = []
				const seen = new Set()
				for (const node of document.querySelectorAll("[data-geom], .caption, h1, h2, h3, p, span, img, video, [data-locked-source]")) {
					const r = node.getBoundingClientRect()
					if (r.width <= 0 || r.height <= 0) continue
					const cs = getComputedStyle(node)
					const isText = !!(node.textContent || "").trim() && node.tagName !== "IMG" && node.tagName !== "VIDEO"
					const id = node.getAttribute("data-geom") || node.id || `${node.tagName.toLowerCase()}-${out.length}`
					if (seen.has(id)) continue
					seen.add(id)
					const rec = {
						id,
						kind: node.tagName === "IMG" || node.tagName === "VIDEO" ? (node.tagName === "VIDEO" ? "video" : "image") : isText ? "text" : "shape",
						box: { x: r.x, y: r.y, w: r.width, h: r.height },
						opacity: Number(cs.opacity),
					}
					if (isText) { rec.text = (node.textContent || "").trim().slice(0, 80); rec.color = toRGB(cs.color); rec.bgColor = bgOf(node); rec.fontFamily = cs.fontFamily; rec.fontWeight = cs.fontWeight; rec.fontSizePx = parseFloat(cs.fontSize) }
					const beat = node.getAttribute("data-beat"); if (beat != null) rec.beat = /^\d+$/.test(beat) ? Number(beat) : beat
					const rev = node.getAttribute("data-reveal"); if (rev != null) rec.revealProgress = Number(rev)
					const locked = node.getAttribute("data-locked-source"); if (locked != null) rec.lockedSourceId = locked
					out.push(rec)
				}
				return out
			})
			geomSamples.push({ t, elements: els })
		} catch (e) {
			if (i === 0) console.warn(`render: geometry capture unavailable (${e.message}); continuing render without it`)
		}
	}
	if (i % 60 === 0) process.stdout.write(`  frame ${i}/${frames}\r`)
}
await browser.close()

// 0033: finalize + write the geometry. motionDelta per element = px its box centre moved vs the previous
// sample; a frame is a `hold` when the max motionDelta across its elements has settled (<=2px) — the
// beat is composed and still. The engine then flags anything still moving / not fully revealed on a hold.
if (geomSamples && geometryOut) {
	try {
		const centre = (b) => [b.x + b.w / 2, b.y + b.h / 2]
		const framesOut = geomSamples.map((s, i) => {
			const prev = i > 0 ? geomSamples[i - 1] : null
			let maxDelta = 0
			const elements = s.elements.map((e) => {
				let motionDelta
				if (prev) { const p = prev.elements.find((x) => x.id === e.id); if (p) { const [cx, cy] = centre(e.box); const [px, py] = centre(p.box); motionDelta = Math.hypot(cx - px, cy - py); maxDelta = Math.max(maxDelta, motionDelta) } }
				const beat = e.beat; const { beat: _b, ...rest } = e
				return { ...rest, ...(motionDelta !== undefined ? { motionDelta } : {}), ...(beat !== undefined ? { _beat: beat } : {}) }
			})
			// lift a single element beat up to the frame (the composition tags one beat per card/scene)
			const beat = elements.map((e) => e._beat).find((b) => b !== undefined)
			for (const e of elements) delete e._beat
			return { t: s.t, ...(beat !== undefined ? { beat } : {}), hold: i > 0 && maxDelta <= 2, bounds: { width, height }, elements }
		})
		const geomPath = resolve(geometryOut)
		mkdirSync(dirname(geomPath), { recursive: true })
		writeFileSync(geomPath, JSON.stringify({ size: { width, height }, frames: framesOut }, null, 2))
		console.log(`render: wrote layout geometry -> ${geomPath} (${framesOut.length} frames)`)
	} catch (e) {
		console.warn(`render: could not write geometry (${e.message}); render itself is unaffected`)
	}
}

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
