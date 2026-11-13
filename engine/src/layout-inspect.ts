// Deterministic layout inspection — a generic, dependency-free pre-pass over a rendered composition's
// own LAYOUT GEOMETRY (element boxes, colours, fonts, per-frame motion/reveal), run BEFORE any model
// reviewer. It catches the enumerable defect class a VLM judge grades worst and most expensively
// (clipping, collision, never-settling, reveal-stops-short, low contrast, too many type systems) at
// roughly zero marginal cost, and emits directives in the engine's existing REOPEN contract so the
// holistic-review seam can short-circuit an Opus pass on an obviously broken render (issue 0033).
//
// Generic by design: the engine knows nothing about video. This module operates on a domain-neutral 2D
// layout schema (frames of boxes) and names no pipeline step — the caller supplies the reopen target
// type. The renderer owns EMITTING this geometry from its own layout (see the craft frames-geometry
// contract); this module only reads and judges it, so it unit-tests against synthetic fixtures with no
// render. Pure + dependency-free (mirrors film-manifest.ts), so it runs anywhere.

// A rectangle in frame pixels: top-left (x, y) + size (w, h).
export interface LayoutBox {
	x: number
	y: number
	w: number
	h: number
}

// sRGB 0-255. Kept as a tuple so the schema carries no colour-space dependency.
export type LayoutColor = [number, number, number]

export interface LayoutElement {
	id: string
	kind?: "text" | "image" | "shape" | "video" | (string & {})
	text?: string // present on a text element; its string content
	box: LayoutBox
	opacity?: number // 0-1; absent = treated as fully opaque (1)
	color?: LayoutColor // foreground (text) colour, for the contrast check
	bgColor?: LayoutColor // the immediate background behind the element, for the contrast check
	fontFamily?: string // CSS font-family (the type-system check clusters on this)
	fontWeight?: number | string
	fontSizePx?: number // rendered size in px; decides the contrast threshold (large text is laxer)
	revealProgress?: number // 0-1 on a progressive reveal (1 = fully revealed); checked on a hold frame
	motionDelta?: number // px the element moved vs the previous sampled frame; checked on a hold frame
	lockedSourceId?: string // 0049: this element composites a supplied, locked source asset (a UI screenshot)
	fidelity?: number // 0049: 0-1 structural similarity of the rendered region to that locked source
}

// One sampled frame of the rendered composition. A frame is either mid-motion or a HOLD (a beat's
// settle), which decides whether the temporal checks (never-settling, reveal-stops-short) apply.
export interface LayoutFrame {
	t: number // timecode in seconds
	beat?: number | string // which beat/step this frame belongs to; a 1-based number lets the reopen target one fanned-out unit
	hold?: boolean // true = a settle frame (end of a beat's reveal) — everything should be composed and still
	bounds: { width: number; height: number } // the frame's own pixel bounds
	safeInsetPx?: number // optional safe-area inset; clipping is judged against bounds, not this (advisory)
	elements: LayoutElement[]
}

export interface LayoutGeometry {
	size?: { width: number; height: number }
	frames: LayoutFrame[]
}

export type DefectCheck =
	| "clipping"
	| "collision"
	| "never-settling"
	| "reveal-stops-short"
	| "low-contrast"
	| "too-many-type-systems"
	| "mockup-fidelity"

export interface LayoutDefect {
	check: DefectCheck
	beat?: number | string // the frame's beat, so the caller can target one fanned-out unit on reopen
	t: number // the timecode the defect was seen at
	message: string // human-readable: what's wrong + where
	elementId?: string
}

export interface InspectOptions {
	// clipping: px a box may cross the frame bound before it counts (sub-pixel rounding tolerance).
	clipTolerancePx: number
	// collision: two opaque text boxes overlapping by more than this fraction of the smaller box = a hit.
	collisionOverlapFraction: number
	// an element at/below this opacity is treated as not-yet-revealed, so it never triggers collision.
	opaqueThreshold: number
	// never-settling: px of motion on a HOLD frame that counts as "still animating".
	settleMotionPx: number
	// reveal-stops-short: a reveal below this progress on a HOLD frame stopped short.
	revealMinProgress: number
	// low-contrast: WCAG contrast ratio floors — normal text vs large text (>= largeTextPx or bold+).
	contrastMinNormal: number
	contrastMinLarge: number
	largeTextPx: number
	// too-many-type-systems: max distinct font families allowed in one frame before it's a tell.
	maxTypeSystems: number
	// mockup-fidelity (0049): a locked-source element below this similarity has drifted = revise.
	fidelityMin: number
}

export const DEFAULT_INSPECT_OPTIONS: InspectOptions = {
	clipTolerancePx: 2,
	collisionOverlapFraction: 0.12,
	opaqueThreshold: 0.6,
	settleMotionPx: 2,
	revealMinProgress: 0.98,
	contrastMinNormal: 4.5, // WCAG AA, normal text
	contrastMinLarge: 3.0, // WCAG AA, large text
	largeTextPx: 32,
	// A coherent system is often a display + a body face; 3+ distinct families in one frame is the tell
	// the north-star rubric (#6 consistent typography) and the Sadia call flagged. Calibration is a
	// judgment call — tune against real geometry once the renderer emits it.
	maxTypeSystems: 2,
	fidelityMin: 0.9,
}

function opacityOf(el: LayoutElement): number {
	return el.opacity ?? 1
}

// WCAG relative luminance of an sRGB colour (0-255 per channel).
function relativeLuminance([r, g, b]: LayoutColor): number {
	const lin = (c: number): number => {
		const s = c / 255
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

// WCAG contrast ratio between two colours (1:1 .. 21:1).
export function contrastRatio(a: LayoutColor, b: LayoutColor): number {
	const la = relativeLuminance(a)
	const lb = relativeLuminance(b)
	const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
	return (hi + 0.05) / (lo + 0.05)
}

// Overlap area of two boxes as a fraction of the SMALLER box's area (0 = disjoint, 1 = the smaller box
// is fully inside the larger). 0 when either box has no area.
export function overlapFraction(a: LayoutBox, b: LayoutBox): number {
	const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
	const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
	const inter = ix * iy
	if (inter <= 0) return 0
	const areaA = a.w * a.h
	const areaB = b.w * b.h
	const smaller = Math.min(areaA, areaB)
	return smaller > 0 ? inter / smaller : 0
}

function normFamily(family: string | undefined): string | undefined {
	if (!family) return undefined
	// first family in a CSS stack, lowercased, quotes/space stripped — so "Museo Sans", serif and
	// 'museo sans' cluster together but a genuinely different face does not.
	const first = family.split(",")[0] ?? family
	return first.replace(/['"]/g, "").trim().toLowerCase() || undefined
}

function isLargeText(el: LayoutElement, largeTextPx: number): boolean {
	const size = el.fontSizePx ?? 0
	const weight = typeof el.fontWeight === "number" ? el.fontWeight : Number(el.fontWeight)
	const bold = Number.isFinite(weight) ? weight >= 700 : false
	// WCAG: large = >= 18pt (~24px), or >= 14pt (~18.66px) bold. largeTextPx is the regular-weight floor.
	return size >= largeTextPx || (bold && size >= largeTextPx * 0.75)
}

// Inspect one frame against the geometry checks. Each check is independent and reads only the frame, so
// a missing optional field (no colour, no motionDelta) simply means that check does not fire for that
// element — the pre-pass never fabricates a defect from absent data.
export function inspectFrame(frame: LayoutFrame, opts: InspectOptions = DEFAULT_INSPECT_OPTIONS): LayoutDefect[] {
	const defects: LayoutDefect[] = []
	const { width, height } = frame.bounds
	const at = (message: string, check: DefectCheck, elementId?: string): LayoutDefect => ({ check, beat: frame.beat, t: frame.t, message, elementId })

	const visibleText = frame.elements.filter((e) => e.kind === "text" && opacityOf(e) >= opts.opaqueThreshold)

	for (const el of frame.elements) {
		if (opacityOf(el) < opts.opaqueThreshold) continue // not yet revealed — don't judge its position

		// 1. clipping — a box crossing the frame bounds
		const { x, y, w, h } = el.box
		const over: string[] = []
		if (x < -opts.clipTolerancePx) over.push("left")
		if (y < -opts.clipTolerancePx) over.push("top")
		if (x + w > width + opts.clipTolerancePx) over.push("right")
		if (y + h > height + opts.clipTolerancePx) over.push("bottom")
		if (over.length > 0) {
			defects.push(at(`element "${el.id}"${el.text ? ` ("${el.text.slice(0, 40)}")` : ""} is clipped at the ${over.join("/")} frame edge — scale it down or move it inside the frame`, "clipping", el.id))
		}

		// 5. low contrast — text whose colour is too close to its immediate background
		if (el.kind === "text" && el.color && el.bgColor) {
			const ratio = contrastRatio(el.color, el.bgColor)
			const floor = isLargeText(el, opts.largeTextPx) ? opts.contrastMinLarge : opts.contrastMinNormal
			if (ratio < floor) {
				defects.push(at(`text "${el.id}"${el.text ? ` ("${el.text.slice(0, 40)}")` : ""} has contrast ${ratio.toFixed(2)}:1 against its background (needs >= ${floor}:1) — darken/lighten the text or change the ground`, "low-contrast", el.id))
			}
		}

		// temporal checks only apply on a HOLD frame (a beat's settle)
		if (frame.hold) {
			// 3. never-settling — still moving at a hold
			if (el.motionDelta !== undefined && el.motionDelta > opts.settleMotionPx) {
				defects.push(at(`element "${el.id}" is still moving (${el.motionDelta.toFixed(1)}px) at the beat's hold — nothing should animate once the beat settles`, "never-settling", el.id))
			}
			// 4. reveal-stops-short — a progressive reveal that never completed
			if (el.revealProgress !== undefined && el.revealProgress < opts.revealMinProgress) {
				defects.push(at(`reveal of "${el.id}" stops short at ${(el.revealProgress * 100).toFixed(0)}% on the beat's hold — the reveal must reach full content before the hold`, "reveal-stops-short", el.id))
			}
		}

		// 7. mockup-fidelity (0049) — a locked source asset the render drifted from
		if (el.lockedSourceId && el.fidelity !== undefined && el.fidelity < opts.fidelityMin) {
			defects.push(at(`rendered region "${el.id}" matches its locked source "${el.lockedSourceId}" only ${(el.fidelity * 100).toFixed(0)}% (needs >= ${(opts.fidelityMin * 100).toFixed(0)}%) — composite the supplied screenshot as-is, do not regenerate the UI`, "mockup-fidelity", el.id))
		}
	}

	// 2. collision — two opaque text runs overlapping (checked pairwise once)
	for (let i = 0; i < visibleText.length; i++) {
		for (let j = i + 1; j < visibleText.length; j++) {
			const a = visibleText[i]
			const b = visibleText[j]
			if (!a || !b) continue
			if (overlapFraction(a.box, b.box) > opts.collisionOverlapFraction) {
				defects.push(at(`text "${a.id}" and "${b.id}" overlap mid-frame — collision; separate them or stagger their timing`, "collision", a.id))
			}
		}
	}

	// 6. too-many-type-systems — distinct font families in one frame
	const families = new Set<string>()
	for (const el of frame.elements) {
		if (el.kind !== "text" || opacityOf(el) < opts.opaqueThreshold) continue
		const f = normFamily(el.fontFamily)
		if (f) families.add(f)
	}
	if (families.size > opts.maxTypeSystems) {
		defects.push(at(`${families.size} distinct type systems in one frame (${[...families].join(", ")}) — consolidate to one coherent system (north-star #6)`, "too-many-type-systems"))
	}

	return defects
}

// Inspect the whole geometry. Returns every defect across every frame, in frame order.
export function inspectLayout(geometry: LayoutGeometry, opts: InspectOptions = DEFAULT_INSPECT_OPTIONS): LayoutDefect[] {
	const out: LayoutDefect[] = []
	for (const frame of geometry.frames ?? []) out.push(...inspectFrame(frame, opts))
	return out
}

// Collapse defects into the engine's REOPEN directive lines, grouped by beat so each fanned-out unit is
// named once. The caller supplies the reopen target TYPE (the engine stays generic — the craft type.json
// names which pipeline step owns the rendered frames). A numeric beat becomes the 1-based `[n]` selector
// parseReopen understands; a non-numeric or absent beat reopens every node of the type and carries the
// beat label in the reason. Output is exactly the `REOPEN: <type>[<n>] — <reason>` contract the holistic
// loop already parses, so the pre-pass needs no new channel.
export function defectsToReopenLines(defects: LayoutDefect[], reopenTarget: string): string[] {
	if (defects.length === 0) return []
	const byBeat = new Map<string, { index?: number; label?: string; reasons: string[] }>()
	for (const d of defects) {
		const isNumeric = typeof d.beat === "number" && Number.isFinite(d.beat)
		const key = d.beat === undefined ? "*" : String(d.beat)
		const entry = byBeat.get(key) ?? { index: isNumeric ? (d.beat as number) : undefined, label: isNumeric ? undefined : d.beat === undefined ? undefined : String(d.beat), reasons: [] }
		entry.reasons.push(`${d.check}: ${d.message}`)
		byBeat.set(key, entry)
	}
	const lines: string[] = []
	for (const { index, label, reasons } of byBeat.values()) {
		const target = index !== undefined ? `${reopenTarget}[${index}]` : reopenTarget
		const reason = (label ? `beat ${label} — ` : "") + reasons.join("; ")
		lines.push(`REOPEN: ${target} — deterministic pre-check: ${reason}`)
	}
	return lines
}

// A readable report the pre-pass records as the holistic-review version's artifact (so the dashboard
// shows WHY it reopened, not just a verdict). Begins with the VERDICT + REOPEN lines the engine parses,
// then the per-defect detail for the human. A clean pre-check returns a pass with no reopen.
export function renderPrecheckReport(defects: LayoutDefect[], reopenTarget: string): string {
	const lines = defectsToReopenLines(defects, reopenTarget)
	if (defects.length === 0) return "VERDICT: pass\n\n## Deterministic layout pre-check\nNo geometry defects found; handing off to the model reviewer."
	const detail = defects.map((d) => `- [${d.check}] ${typeof d.beat === "number" ? `beat ${d.beat} ` : ""}@${d.t.toFixed(2)}s — ${d.message}`).join("\n")
	return ["VERDICT: revise", ...lines, "", "## Deterministic layout pre-check", `${defects.length} geometry defect(s) caught before the model reviewer — short-circuited to a reopen (zero model cost):`, detail].join("\n")
}

// Parse a geometry JSON string into LayoutGeometry. Fail-safe: a malformed or non-object payload yields
// an empty geometry (no frames), so a broken emitter degrades to "nothing to check" rather than throwing
// and failing the holistic-review dispatch.
export function parseGeometry(json: string): LayoutGeometry {
	try {
		const v = JSON.parse(json) as unknown
		if (v && typeof v === "object" && Array.isArray((v as LayoutGeometry).frames)) return v as LayoutGeometry
	} catch {
		// fall through
	}
	return { frames: [] }
}
