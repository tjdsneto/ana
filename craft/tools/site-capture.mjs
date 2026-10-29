// site-capture — real screens for Family A: capture each plate to a high-res JPG + its mark rects.
//
// A craft TOOL (not engine code): the capture/storyboard skill calls it. Re-authored from the
// reference plates.mjs (real-ui-launch-film) with one addition — a plate can be a LIVE url, not only
// a saved HTML file, so "visit a site with eyes" works directly (spec 09).
//
//   node craft/tools/site-capture.mjs --spec film.json --out <workdir>
//
// Reads film.json: capture.{width, base, redact, remove, hide}, plates.{name:{url|file, js?}},
// marks.{key: cssSelector}. Writes <out>/assets/shots/<name>.jpg + <out>/src/shots.json (per plate:
// mark rects [x,y,w,h] in capture px + _h full height). shots.json + the JPGs feed build.py.
//
// Browser: Playwright chromium, falling back to the installed Google Chrome channel. Fully local.

import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const require = createRequire(import.meta.url)
const { chromium } = require("playwright")

function arg(name, def) {
	const i = process.argv.indexOf(name)
	return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const specPath = arg("--spec", null)
const outDir = arg("--out", null)
if (!specPath || !outDir) {
	console.error("site-capture: --spec <film.json> and --out <workdir> are required")
	process.exit(2)
}

const film = JSON.parse(readFileSync(specPath, "utf8"))
const cap = { width: 1440, base: "", redact: [], remove: [], hide: [], maxHeight: 2400, ...(film.capture || {}) }
const base = cap.base || "https://capture.local/"
const specDir = dirname(resolve(specPath))

mkdirSync(join(outDir, "assets/shots"), { recursive: true })
mkdirSync(join(outDir, "src"), { recursive: true })

const browser = await chromium
	.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
	.catch(() => chromium.launch({ channel: "chrome" }))
	.catch((e) => {
		console.error(`site-capture: no browser for Playwright — ${e.message}`)
		process.exit(3)
	})
const ctx = await browser.newContext({ viewport: { width: cap.width, height: Math.round((cap.width * 9) / 16) }, deviceScaleFactor: 2 })

// Page-side cleanup shared by both modes: redact [from,to] pairs in text/inputs/attrs, remove/hide
// selectors, then run the plate's optional mutation JS (to show a different UI state).
const cleanup = ({ cap, js }) => {
	const walk = (fn) => {
		const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
		let n
		while ((n = w.nextNode())) fn(n)
	}
	for (const [a, b] of cap.redact) {
		walk((n) => { if (n.nodeValue.includes(a)) n.nodeValue = n.nodeValue.split(a).join(b) })
		document.querySelectorAll("input, textarea").forEach((e) => { if (e.value && e.value.includes(a)) e.value = e.value.split(a).join(b) })
		document.querySelectorAll("[title],[alt],[placeholder]").forEach((e) => ["title", "alt", "placeholder"].forEach((k) => {
			const v = e.getAttribute(k)
			if (v && v.includes(a)) e.setAttribute(k, v.split(a).join(b))
		}))
	}
	cap.remove.forEach((s) => document.querySelectorAll(s).forEach((e) => e.remove()))
	cap.hide.forEach((s) => document.querySelectorAll(s).forEach((e) => (e.style.visibility = "hidden")))
	if (js) new Function(js)()
}

const measure = ({ marks, maxH, vh }) => {
	const r = {}
	for (const [k, s] of Object.entries(marks || {})) {
		const e = document.querySelector(s)
		if (!e) continue
		const b = e.getBoundingClientRect()
		if (b.width) r[k] = [Math.round(b.x), Math.round(b.y + scrollY), Math.round(b.width), Math.round(b.height)]
	}
	r._h = Math.max(vh, Math.min(maxH, document.documentElement.scrollHeight))
	return r
}

const vh = Math.round((cap.width * 9) / 16)
const out = {}
for (const [name, p] of Object.entries(film.plates)) {
	const spec = typeof p === "string" ? { file: p } : p
	// Recording plate: a dedicated context captures the whole session to a video (for a "playing
	// around on the real site" flow clip), converted to mp4. Otherwise the shared context.
	const recording = !!spec.record
	const pctx = recording
		? await browser.newContext({ viewport: { width: cap.width, height: vh }, deviceScaleFactor: 1, recordVideo: { dir: join(outDir, "assets/clips"), size: { width: cap.width, height: vh } } })
		: ctx
	if (recording) mkdirSync(join(outDir, "assets/clips"), { recursive: true })
	const page = await pctx.newPage()
	if (spec.url) {
		// live mode: navigate the real site
		await page.goto(spec.url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {})
	} else {
		// saved mode: serve the saved HTML at the real base URL so relative fonts/images resolve
		const html = readFileSync(join(specDir, spec.file), "utf8").replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`)
		const url = new URL("__plate__.html", base).href
		await page.route(url, (r) => r.fulfill({ status: 200, contentType: "text/html", body: html }))
		await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {})
	}
	// Pre-capture steps: drive a real app into the state worth shooting (dismiss onboarding, pick a
	// template, open a panel). Each step is {click|waitFor|fill|wait|remove}. This is what makes capture
	// "eyes on a site" rather than goto-only.
	for (const step of spec.steps || []) {
		try {
			if (step.click) await page.click(step.click, { timeout: step.timeout || 15000 }).catch(() => {})
			if (step.waitFor) await page.waitForSelector(step.waitFor, { state: "visible", timeout: step.timeout || 20000 }).catch(() => {})
			if (step.fill) await page.fill(step.fill[0], step.fill[1]).catch(() => {})
			if (step.wait) await page.waitForTimeout(step.wait)
			if (step.remove) await page.evaluate((sels) => sels.forEach((s) => document.querySelectorAll(s).forEach((e) => e.remove())), step.remove)
		} catch (e) {
			console.log(`  step skipped (${JSON.stringify(step)}): ${String(e).slice(0, 80)}`)
		}
	}
	await page.evaluate(cleanup, { cap, js: spec.js || "" })
	await page.waitForTimeout(300)
	const rects = await page.evaluate(measure, { marks: film.marks, maxH: cap.maxHeight, vh })
	await page.screenshot({ path: join(outDir, `assets/shots/${name}.jpg`), type: "jpeg", quality: 90, fullPage: true, clip: { x: 0, y: 0, width: cap.width, height: rects._h } })
	out[name] = rects
	console.log(`${name}: ${cap.width}x${rects._h}, marks: ${Object.keys(rects).filter((k) => k !== "_h").join(" ") || "(none)"}`)
	if (recording) {
		const vid = page.video()
		await page.close()
		await pctx.close() // flushes the video to disk
		const webm = await vid.path()
		const mp4 = join(outDir, `assets/clips/${name}.mp4`)
		const ff = spawnSync("ffmpeg", ["-y", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", mp4], { stdio: "ignore" })
		if (ff.status === 0) {
			rmSync(webm, { force: true }) // drop the raw Playwright webm; keep the mp4
			console.log(`  clip -> assets/clips/${name}.mp4`)
		} else {
			console.log(`  clip: ffmpeg failed (webm kept: ${webm})`)
		}
	} else {
		await page.close()
	}
}
writeFileSync(join(outDir, "src/shots.json"), JSON.stringify(out, null, 1))
await browser.close()
console.log(`shots.json: ${Object.keys(out).length} plate(s) -> ${outDir}/src/shots.json`)
