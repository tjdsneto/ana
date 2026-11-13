// Deterministic image similarity — a pure, dependency-free metric for the mockup-fidelity check (issue
// 0049): how faithfully a rendered region reproduces a supplied, locked UI screenshot. It operates on
// LUMINANCE GRIDS (number[][], 0-255), never on encoded images, so it has no image-decode dependency and
// unit-tests against synthetic grids. Whoever holds the pixels (the renderer / the craft mockup-diff
// tool) decodes the two images to luminance grids, calls `mockupFidelity`, and writes the resulting 0-1
// score into the frame geometry as `fidelity`; the engine's layout-inspect check then flags drift below
// a threshold. This module is the single, tested definition of that score.
//
// The score blends two cheap, robust signals that catch different failure modes:
//   • average-hash (aHash) Hamming similarity — structure/layout: did the UI get re-composed? (robust to
//     small brightness/scale changes, sensitive to moved/removed blocks).
//   • coarse normalized RMS similarity on a downscaled grid — tone/content: is the region broadly the
//     same picture? (catches a recolour or a wholesale regenerate the aHash might miss).

export type LuminanceGrid = number[][] // row-major, [y][x], 0-255

function gridDims(grid: LuminanceGrid): { w: number; h: number } {
	const h = grid.length
	const w = h > 0 ? (grid[0]?.length ?? 0) : 0
	return { w, h }
}

// Nearest-neighbour downscale (or upscale) to an exact w×h. Deterministic and dependency-free — box
// filtering would be marginally better but adds no robustness the aHash + RMS blend needs here.
export function resampleGrid(grid: LuminanceGrid, w: number, h: number): LuminanceGrid {
	const { w: sw, h: sh } = gridDims(grid)
	if (sw === 0 || sh === 0) return Array.from({ length: h }, () => new Array(w).fill(0))
	const out: LuminanceGrid = []
	for (let y = 0; y < h; y++) {
		const sy = Math.min(sh - 1, Math.floor((y * sh) / h))
		const row: number[] = []
		for (let x = 0; x < w; x++) {
			const sx = Math.min(sw - 1, Math.floor((x * sw) / w))
			row.push(grid[sy]?.[sx] ?? 0)
		}
		out.push(row)
	}
	return out
}

// The average hash: downscale to size×size, then one bit per cell — 1 if the cell is at/above the grid
// mean, else 0. Returns the bit array (length size*size).
export function averageHash(grid: LuminanceGrid, size = 8): boolean[] {
	const small = resampleGrid(grid, size, size)
	let sum = 0
	for (const row of small) for (const v of row) sum += v
	const mean = sum / (size * size)
	const bits: boolean[] = []
	for (const row of small) for (const v of row) bits.push(v >= mean)
	return bits
}

// Fraction of matching bits between two equal-length hashes (1 = identical, 0.5 = random, 0 = inverted).
export function hashSimilarity(a: boolean[], b: boolean[]): number {
	const n = Math.min(a.length, b.length)
	if (n === 0) return 0
	let match = 0
	for (let i = 0; i < n; i++) if (a[i] === b[i]) match++
	return match / n
}

// Coarse normalized RMS similarity: downscale both to size×size, RMS of per-cell differences over 255,
// similarity = 1 - rms (clamped). 1 = identical tone/content; lower = recoloured or regenerated.
export function rmsSimilarity(a: LuminanceGrid, b: LuminanceGrid, size = 16): number {
	const ga = resampleGrid(a, size, size)
	const gb = resampleGrid(b, size, size)
	let sq = 0
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const d = (ga[y]?.[x] ?? 0) - (gb[y]?.[x] ?? 0)
			sq += d * d
		}
	}
	const rms = Math.sqrt(sq / (size * size)) / 255
	return Math.max(0, Math.min(1, 1 - rms))
}

// The mockup-fidelity score (0-1): how faithfully `rendered` reproduces the locked `source`. Blends the
// structural aHash similarity and the coarse RMS similarity. 1 = pixel-identical layout + tone; a
// re-composed or regenerated UI scores well below the 0.9 default threshold the layout-inspect check uses.
export function mockupFidelity(rendered: LuminanceGrid, source: LuminanceGrid, opts: { hashSize?: number; rmsSize?: number; hashWeight?: number } = {}): number {
	const hashSize = opts.hashSize ?? 8
	const rmsSize = opts.rmsSize ?? 16
	const hashWeight = opts.hashWeight ?? 0.6
	const structural = hashSimilarity(averageHash(rendered, hashSize), averageHash(source, hashSize))
	const tone = rmsSimilarity(rendered, source, rmsSize)
	return Math.max(0, Math.min(1, hashWeight * structural + (1 - hashWeight) * tone))
}
