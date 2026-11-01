#!/usr/bin/env node
// remotion adapter — render a HyperFrames-style HTML composition via Remotion (the swappable alternative
// to the hyperframes backend; same HTML input, same .mp4 output). Copies the bundled remotion-template
// project to a temp dir, injects the HTML as props, installs, and renders. Local; Remotion drives
// headless Chromium (the system one via $CHROME_PATH when set — e.g. the baked chromium in the engine
// image — else Remotion fetches its own). Needs Node >=18.
//
//   node craft/tools/motion-graphics/remotion.mjs --html comp.html --out clip.mp4 [--fps 30]
//
// Same composition contract as the hyperframes backend (see the motion-graphics skill): #stage with
// data-width/height + timed clips, a paused GSAP timeline on window.__timelines. calcMeta (in the
// template) derives size + duration from it.
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE = join(HERE, "remotion-template")

export async function render({ html, out, fps }) {
	if (!existsSync(html)) throw new Error(`remotion: html not found: ${html}`)
	const proj = mkdtempSync(join(tmpdir(), "mg-remotion-"))
	cpSync(TEMPLATE, proj, { recursive: true })
	writeFileSync(join(proj, "props.json"), JSON.stringify({ html: readFileSync(html, "utf8"), fps: Number(fps) || 30 }))

	execFileSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"],
		{ cwd: proj, stdio: ["ignore", "inherit", "inherit"] })

	const outAbs = resolve(out)
	mkdirSync(dirname(outAbs), { recursive: true })
	const browser = process.env.CHROME_PATH ? ["--browser-executable", process.env.CHROME_PATH] : []
	execFileSync("npx", ["remotion", "render", "src/index.ts", "mg", outAbs, "--props=props.json", "--log=error", ...browser],
		{ cwd: proj, stdio: ["ignore", "inherit", "inherit"] })
	process.stdout.write(`remotion: rendered -> ${outAbs}\n`)
}

function parseArgs(argv) {
	const a = { html: null, out: null, fps: null }
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--html") a.html = argv[++i]
		else if (argv[i] === "--out") a.out = argv[++i]
		else if (argv[i] === "--fps") a.fps = argv[++i]
		else throw new Error(`remotion: unknown arg ${argv[i]}`)
	}
	if (!a.html || !a.out) throw new Error("remotion: --html and --out are required")
	return a
}

if (import.meta.url === `file://${process.argv[1]}`) {
	render(parseArgs(process.argv.slice(2))).catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1) })
}
