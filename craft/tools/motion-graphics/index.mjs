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
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname, resolve, extname, isAbsolute } from "node:path"
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

// Inline local asset references (src="…" and CSS url(…)) as data URIs so the composition is
// self-contained before it reaches a backend. HyperFrames copies the HTML into its own temp project
// dir, so a relative src="assets/x.png" 404s there (media_load_failed); inlining makes local paths
// work regardless of where the backend serves the file. Remote refs (http/https/data/blob/#) are left
// untouched. Returns a prepared HTML path (a temp file when anything was inlined, else the original).
const MIME = {
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
	".gif": "image/gif", ".svg": "image/svg+xml", ".avif": "image/avif",
	".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
	".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
	".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
}

export function isLocalRef(ref) {
	return ref.trim() !== "" && !/^(data:|https?:|blob:|\/\/|#)/i.test(ref)
}

export function inlineAssets(htmlPath) {
	const baseDir = dirname(htmlPath)
	const html = readFileSync(htmlPath, "utf8")
	let changed = false
	const toDataUri = (ref) => {
		if (!isLocalRef(ref)) return null
		const abs = isAbsolute(ref) ? ref : resolve(baseDir, ref)
		if (!existsSync(abs)) return null
		const mime = MIME[extname(abs).toLowerCase()] || "application/octet-stream"
		changed = true
		return `data:${mime};base64,${readFileSync(abs).toString("base64")}`
	}
	let out = html.replace(/(\ssrc\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, ref) => {
		const d = toDataUri(ref); return d ? `${pre}${q}${d}${q}` : m
	})
	out = out.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (m, q, ref) => {
		const d = toDataUri(ref); return d ? `url(${q}${d}${q})` : m
	})
	if (!changed) return htmlPath
	const prepared = join(mkdtempSync(join(tmpdir(), "mg-prep-")), "composition.html")
	writeFileSync(prepared, out)
	return prepared
}

async function main() {
	const a = parseArgs(process.argv.slice(2))
	const backend = pickBackend(process.env.MOTION_GFX_BACKEND, a.backend)
	const here = dirname(fileURLToPath(import.meta.url))
	const mod = await import(pathToFileURL(join(here, `${backend}.mjs`)).href)
	const prepared = inlineAssets(a.html)   // self-contain local assets so both backends load them
	try {
		await mod.render({ html: prepared, out: a.out, fps: a.fps })
	} finally {
		if (prepared !== a.html) { try { rmSync(dirname(prepared), { recursive: true, force: true }) } catch {} }
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1) })
}
