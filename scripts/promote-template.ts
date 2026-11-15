import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { Template, TemplateBeat, TemplateScore, TemplateTier } from "@core/shared"

// Research input shapes (only the fields we consume).
interface ManifestRow {
	slug: string
	title: string
	creator: string
	product: string
	tier: TemplateTier
	durationSec: number
	w: number
	h: number
}

// The research dissection stores `look` as a structured object; the catalog contract wants a single
// readable string summary (design spec §5.2). Accept either and flatten in the transform.
interface LookObject {
	palette?: string
	type?: string
	motion?: string
	motifs?: string[]
	sound?: string
}
interface DataJson {
	oneIdea: string
	hook: string
	cta: string
	summary: string
	whyItWorks: string
	tools: string[]
	look: string | LookObject
	storyboard: TemplateBeat[]
	remakePrompts: string[]
	scorecard: TemplateScore[]
}

function aspectOf(w: number, h: number): string {
	if (!w || !h) return "9:16"
	if (w === h) return "1:1"
	return w > h ? "16:9" : "9:16"
}

// Flatten a structured look object (palette/type/motion/motifs/sound) into one readable string; pass a
// plain string through unchanged.
function flattenLook(look: string | LookObject | undefined): string {
	if (!look) return ""
	if (typeof look === "string") return look
	const parts: string[] = []
	if (look.palette) parts.push(`Palette: ${look.palette}`)
	if (look.type) parts.push(`Type: ${look.type}`)
	if (look.motion) parts.push(`Motion: ${look.motion}`)
	if (look.motifs?.length) parts.push(`Motifs: ${look.motifs.join("; ")}`)
	if (look.sound) parts.push(`Sound: ${look.sound}`)
	return parts.join("\n")
}

// Pure: merge a manifest row + its dissection + tags into a Template with /catalog-relative asset paths.
export function toCatalogRecord(row: ManifestRow, data: DataJson, tags: string[]): Template {
	return {
		slug: row.slug,
		title: row.title,
		creator: row.creator,
		product: row.product,
		tier: row.tier,
		tags,
		posterPath: `assets/${row.slug}.poster.jpg`,
		videoPath: `assets/${row.slug}.mp4`,
		durationSec: row.durationSec,
		aspect: aspectOf(row.w, row.h),
		oneIdea: data.oneIdea,
		hook: data.hook,
		cta: data.cta,
		summary: data.summary,
		whyItWorks: data.whyItWorks,
		tools: data.tools ?? [],
		look: flattenLook(data.look),
		storyboard: data.storyboard ?? [],
		remakePrompts: data.remakePrompts ?? [],
		scorecard: data.scorecard ?? [],
	}
}

// ── I/O shell (not unit-tested; exercised by Task 3) ──────────────────────────────────────────
const REPO = resolve(dirname(new URL(import.meta.url).pathname), "..")
// The research tree is a sibling of the MAIN repo checkout (`../research`). When this script is run
// from a git worktree (e.g. repo-wt/<branch>), that relative path does not resolve, so allow an
// explicit override: RESEARCH_DIR=/abs/path/to/research/artifact.
const RESEARCH = process.env.RESEARCH_DIR ? resolve(process.env.RESEARCH_DIR) : resolve(REPO, "..", "research", "artifact")
const OUT_DIR = join(REPO, "app", "public", "catalog")
const OUT_JSON = join(OUT_DIR, "catalog.json")
const OUT_ASSETS = join(OUT_DIR, "assets")

async function exists(p: string): Promise<boolean> {
	try {
		await access(p)
		return true
	} catch {
		return false
	}
}

async function loadManifest(): Promise<ManifestRow[]> {
	const raw = JSON.parse(await readFile(join(RESEARCH, "build", "manifest.json"), "utf8"))
	// manifest.json is an object { videos: [...] } (or possibly a bare array) — normalize + keep rows with a slug.
	return (Array.isArray(raw) ? raw : raw.videos ?? []).filter((r: { slug?: string }) => typeof r?.slug === "string")
}

async function promoteSlug(row: ManifestRow): Promise<Template | null> {
	const dataPath = join(RESEARCH, "data", `${row.slug}.json`)
	if (!(await exists(dataPath))) {
		console.warn(`skip ${row.slug}: no data/${row.slug}.json`)
		return null
	}
	const data: DataJson = JSON.parse(await readFile(dataPath, "utf8"))
	const rec = toCatalogRecord(row, data, []) // tags left empty here; v1 does not surface research TAGS map
	// A catalog card's detail page plays the video, so a record with no committed .mp4 is a broken
	// entry (its <video> 404s). Skip it entirely rather than list a video-less template.
	const videoSrc = join(RESEARCH, "assets", "videos", `${row.slug}.mp4`)
	if (!(await exists(videoSrc))) {
		console.warn(`skip ${row.slug}: missing video asset ${videoSrc}`)
		return null
	}
	await mkdir(OUT_ASSETS, { recursive: true })
	await copyFile(videoSrc, join(OUT_ASSETS, `${row.slug}.mp4`))
	const posterSrc = join(RESEARCH, "assets", "frames", `${row.slug}.poster.jpg`)
	if (await exists(posterSrc)) await copyFile(posterSrc, join(OUT_ASSETS, `${row.slug}.poster.jpg`))
	else console.warn(`warn ${row.slug}: missing poster ${posterSrc}`)
	return rec
}

async function main(): Promise<void> {
	const args = process.argv.slice(2)
	const all = args.includes("--all")
	const tierArg = args.find((a) => a.startsWith("--tier="))
	const tiers = tierArg ? tierArg.slice("--tier=".length).split(",") : null
	const slugArgs = args.filter((a) => !a.startsWith("--"))
	const manifest = await loadManifest()
	// --all promotes every manifest row across every tier (video-less rows are still skipped per-record);
	// otherwise filter by --tier=a,b or an explicit slug list.
	const selected = all ? manifest : manifest.filter((r) => (tiers ? tiers.includes(r.tier) : slugArgs.includes(r.slug)))
	if (selected.length === 0) {
		console.error("no matching slugs/tiers; pass --all, <slug> ..., or --tier=north-star,launch-reel")
		process.exit(1)
	}
	const records: Template[] = []
	for (const row of selected) {
		const rec = await promoteSlug(row)
		if (rec) records.push(rec)
	}
	await mkdir(OUT_DIR, { recursive: true })
	await writeFile(OUT_JSON, JSON.stringify(records, null, 2) + "\n")
	console.log(`wrote ${records.length} template(s) → ${OUT_JSON}`)
}

// Run main() only as a script, not when imported by the test.
if (import.meta.url === `file://${process.argv[1]}`) void main()
