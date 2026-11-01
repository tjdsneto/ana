#!/usr/bin/env node
// hyperframes adapter — render an HTML composition to MP4 via heygen-com/hyperframes (local, OSS).
// Drops the caller's HTML as index.html in a temp project and runs `npx hyperframes render`, then
// collects the produced mp4. Needs Node >=22 + ffmpeg; `npx hyperframes` fetches Chromium on first run.
//
//   node craft/tools/motion-graphics/hyperframes.mjs --html comp.html --out clip.mp4
//
// The HTML is a HyperFrames composition: a #stage element with data-composition-id / data-width /
// data-height, timed clips (data-start/data-duration/data-track-index), and a paused GSAP timeline
// registered on window.__timelines (see the motion-graphics skill for the shape).
import { execFileSync } from "node:child_process"
import { mkdtempSync, copyFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"

function newestMp4(dir) {
	let best = null, bestT = -1
	const walk = (d) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name)
			if (e.isDirectory()) walk(p)
			else if (e.name.toLowerCase().endsWith(".mp4")) {
				const t = statSync(p).mtimeMs
				if (t > bestT) { bestT = t; best = p }
			}
		}
	}
	walk(dir)
	return best
}

export async function render({ html, out }) {
	if (!existsSync(html)) throw new Error(`hyperframes: html not found: ${html}`)
	const proj = mkdtempSync(join(tmpdir(), "hf-"))
	copyFileSync(html, join(proj, "index.html"))
	// render in the project dir; npx --yes auto-installs hyperframes if absent
	execFileSync("npx", ["--yes", "hyperframes", "render"], { cwd: proj, stdio: ["ignore", "inherit", "inherit"] })
	const mp4 = newestMp4(proj)
	if (!mp4) throw new Error(`hyperframes: render produced no .mp4 under ${proj}`)
	mkdirSync(dirname(out) || ".", { recursive: true })
	copyFileSync(mp4, out)
	process.stdout.write(`hyperframes: rendered -> ${out}\n`)
}

function parseArgs(argv) {
	const a = { html: null, out: null }
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--html") a.html = argv[++i]
		else if (argv[i] === "--out") a.out = argv[++i]
		else if (argv[i] === "--fps") i++ // accepted for a uniform CLI; hyperframes reads timing from the HTML
		else throw new Error(`hyperframes: unknown arg ${argv[i]}`)
	}
	if (!a.html || !a.out) throw new Error("hyperframes: --html and --out are required")
	return a
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const a = parseArgs(process.argv.slice(2))
	render(a).catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1) })
}
