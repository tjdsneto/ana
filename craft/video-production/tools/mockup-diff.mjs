#!/usr/bin/env node
// mockup-diff — the mockup-fidelity diff (issue 0049). Given a RENDERED region and the SUPPLIED, locked
// UI screenshot it was meant to reproduce, compute a 0-1 structural-similarity score. The build skills
// mark a composited screenshot with data-locked-source; the render emits the region; this tool scores
// how faithfully the render reproduced it, and the score is written into the frame geometry as
// `fidelity`, where the engine's deterministic layout-inspect check flags drift below 0.9 as a revise.
//
//   node mockup-diff.mjs --rendered <png> --source <png> [--region x,y,w,h] [--out <json>]
//
// The similarity math MIRRORS the canonical, unit-tested definition in engine/src/image-similarity.ts
// (aHash structural similarity blended with coarse RMS tone similarity). Keep the two in sync — the
// engine version is the spec. Image DECODE needs an imaging lib (sharp or pngjs); if neither is present
// this exits with a clear message rather than guessing — that path is live-deferred (no decode here).

import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

function arg(name, def) {
	const i = process.argv.indexOf(name)
	return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def
}

// ---- similarity core (mirror of engine/src/image-similarity.ts) ---------------------------------
function resample(grid, w, h) {
	const sh = grid.length
	const sw = sh ? grid[0].length : 0
	if (!sw || !sh) return Array.from({ length: h }, () => new Array(w).fill(0))
	const out = []
	for (let y = 0; y < h; y++) {
		const sy = Math.min(sh - 1, Math.floor((y * sh) / h))
		const row = []
		for (let x = 0; x < w; x++) row.push(grid[sy][Math.min(sw - 1, Math.floor((x * sw) / w))])
		out.push(row)
	}
	return out
}
function averageHash(grid, size = 8) {
	const s = resample(grid, size, size)
	let sum = 0
	for (const row of s) for (const v of row) sum += v
	const mean = sum / (size * size)
	const bits = []
	for (const row of s) for (const v of row) bits.push(v >= mean)
	return bits
}
function hashSim(a, b) {
	let m = 0
	for (let i = 0; i < a.length; i++) if (a[i] === b[i]) m++
	return a.length ? m / a.length : 0
}
function rmsSim(a, b, size = 16) {
	const ga = resample(a, size, size)
	const gb = resample(b, size, size)
	let sq = 0
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const d = ga[y][x] - gb[y][x]; sq += d * d }
	return Math.max(0, Math.min(1, 1 - Math.sqrt(sq / (size * size)) / 255))
}
function mockupFidelity(rendered, source) {
	return Math.max(0, Math.min(1, 0.6 * hashSim(averageHash(rendered, 8), averageHash(source, 8)) + 0.4 * rmsSim(rendered, source, 16)))
}

// ---- image decode -> luminance grid (live-deferred: needs an imaging lib) -----------------------
function decodeLuminance(path, region) {
	let sharp
	try {
		sharp = require("sharp")
	} catch {
		sharp = null
	}
	if (sharp) {
		// deferred: synchronous decode via sharp is async; wired here as the intended path, exercised live.
		throw new Error("mockup-diff: sharp decode path is live-only; run it in the render environment")
	}
	let PNG
	try {
		;({ PNG } = require("pngjs"))
	} catch {
		PNG = null
	}
	if (!PNG) throw new Error("mockup-diff: no imaging lib (sharp/pngjs) available to decode the screenshot — this path is live-deferred")
	const png = PNG.sync.read(readFileSync(path))
	const [rx, ry, rw, rh] = region ? region.split(",").map(Number) : [0, 0, png.width, png.height]
	const grid = []
	for (let y = 0; y < rh; y++) {
		const row = []
		for (let x = 0; x < rw; x++) {
			const idx = ((ry + y) * png.width + (rx + x)) * 4
			// Rec. 601 luma
			row.push(Math.round(0.299 * png.data[idx] + 0.587 * png.data[idx + 1] + 0.114 * png.data[idx + 2]))
		}
		grid.push(row)
	}
	return grid
}

const renderedPath = arg("--rendered", null)
const sourcePath = arg("--source", null)
const region = arg("--region", null)
const outPath = arg("--out", null)
if (!renderedPath || !sourcePath) {
	console.error("mockup-diff: --rendered and --source are required")
	process.exit(2)
}
try {
	const rendered = decodeLuminance(renderedPath, region)
	const source = decodeLuminance(sourcePath, null)
	const fidelity = mockupFidelity(rendered, source)
	const result = { fidelity: Number(fidelity.toFixed(4)), rendered: renderedPath, source: sourcePath }
	if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 2))
	console.log(JSON.stringify(result))
	process.exit(0)
} catch (e) {
	console.error(e.message)
	process.exit(3)
}
