#!/usr/bin/env node
// motion-graphics — swappable HTML→video backend for programmatic motion graphics / animated captions
// / overlays. Same job as the Family-A html render, but pluggable: an HTML composition in, an .mp4 out,
// the backend chosen by $MOTION_GFX_BACKEND (default hyperframes). A craft tool (not engine code); the
// `motion-graphics` worker skill authors the HTML and calls this. No engine port (spec-09 Decision #5).
//
// Backends (both LOCAL — HyperFrames is OSS Apache-2.0, not a hosted API; Remotion is source-available):
//   - hyperframes (default): heygen-com/hyperframes, `npx hyperframes render`. HTML-native + GSAP,
//     matches our existing HTML/GSAP craft. Needs Node >=22 + ffmpeg (Puppeteer drives Chromium).
//   - remotion: renders the SAME HTML composition inside a Remotion project (iframe + per-frame GSAP
//     seek); installs the bundled template on first use. Needs Node >=18 + ffmpeg + Chromium.
//
//   MOTION_GFX_BACKEND=hyperframes node craft/tools/motion-graphics/index.mjs --html comp.html --out clip.mp4 [--fps 30]
//
// pickBackend is pure (unit-tested in tests/motion-graphics.test.mjs).
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export function pickBackend(env, flag) {
	const b = (flag || env || "hyperframes").toLowerCase()
	if (b !== "hyperframes" && b !== "remotion") {
		throw new Error(`motion-graphics: unknown backend "${b}" (expected hyperframes|remotion)`)
	}
	return b
}

function parseArgs(argv) {
	const a = { html: null, out: null, fps: null, backend: null }
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--html") a.html = argv[++i]
		else if (argv[i] === "--out") a.out = argv[++i]
		else if (argv[i] === "--fps") a.fps = argv[++i]
		else if (argv[i] === "--backend") a.backend = argv[++i]
		else throw new Error(`motion-graphics: unknown arg ${argv[i]}`)
	}
	if (!a.html) throw new Error("motion-graphics: --html <composition file> is required")
	if (!a.out) throw new Error("motion-graphics: --out <mp4> is required")
	return a
}

async function main() {
	const a = parseArgs(process.argv.slice(2))
	const backend = pickBackend(process.env.MOTION_GFX_BACKEND, a.backend)
	const here = dirname(fileURLToPath(import.meta.url))
	const mod = await import(pathToFileURL(join(here, `${backend}.mjs`)).href)
	await mod.render({ html: a.html, out: a.out, fps: a.fps })
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1) })
}
