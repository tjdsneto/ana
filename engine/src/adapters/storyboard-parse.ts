// Split a storyboard (free-form markdown from the storyboard producer) into scenes the local render
// engine can turn into cards. Tolerant by design — the producer's format is not fixed — with a
// paragraph fallback when there are no scene headings, so render never gets zero scenes.

export interface Scene {
	caption: string // drawn on the card (a title, or a clipped line)
	narration: string // spoken by the VoiceClient
}

const SCENE_HEADING = /^\s*(?:#{1,6}\s*)?(?:scene|shot)\b[\s:.\-–—]*(.*)$/i
const MD_HEADING = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/
const NARRATION_LABEL = /^\s*(?:narration|voice[\s-]?over|vo|v\/o|script|dialogue|audio|say)\s*[:\-]\s*(.*)$/i
const CAPTION_MAX = 180

// Keep the video short: cap scenes and the spoken length per scene. Real storyboards are verbose prose
// (full visual descriptions), which, read whole, make 10+ minute slideshows — so narration is clipped
// to the first sentence(s) up to NARRATION_MAX, and scenes to MAX_SCENES. Both env-tunable.
const MAX_SCENES = Math.max(1, Number(process.env.RENDER_MAX_SCENES ?? 6))
const NARRATION_MAX = Math.max(40, Number(process.env.RENDER_NARRATION_MAX ?? 140))

export function parseScenes(text: string): Scene[] {
	const raw = (text ?? "").replace(/\r\n/g, "\n").trim()
	if (!raw) return [{ caption: "(no storyboard provided)", narration: "" }]

	const lines = raw.split("\n")
	const blocks: { title?: string; body: string[] }[] = []
	for (const line of lines) {
		const sceneM = line.match(SCENE_HEADING)
		const headM = line.match(MD_HEADING)
		if (sceneM || headM) {
			const title = clean(sceneM ? sceneM[1]! : headM![1]!)
			blocks.push({ title: title || undefined, body: [] })
			continue
		}
		if (blocks.length === 0) blocks.push({ body: [] }) // preamble before the first heading
		blocks.at(-1)!.body.push(line)
	}

	// No headings at all → fall back to paragraph blocks (blank-line separated), capped.
	const hasHeadings = blocks.some((b) => b.title !== undefined)
	const scenes = (hasHeadings ? blocks : paragraphBlocks(raw)).map(toScene).filter((s) => s.caption || s.narration)
	const capped = scenes.slice(0, MAX_SCENES)
	return capped.length > 0 ? capped : [{ caption: clip(raw), narration: clipNarration(stripBody(raw)) }]
}

function toScene(block: { title?: string; body: string[] }): Scene {
	const labelled = block.body
		.map((l) => l.replace(/^\s*[-*+]\s+/, "").match(NARRATION_LABEL)?.[1]) // a label may sit behind a bullet
		.filter((v): v is string => Boolean(v && v.trim()))
		.map(clean)
	const bodyText = stripBody(block.body.join("\n"))
	const narration = clipNarration((labelled.length > 0 ? labelled.join(" ") : bodyText || block.title || "").trim())
	const caption = block.title ? clip(block.title) : clip(narration)
	return { caption, narration: narration || caption }
}

// Keep narration to the first whole sentence(s) up to NARRATION_MAX chars, so a verbose scene body
// does not become a minute of speech.
function clipNarration(text: string): string {
	const t = text.trim()
	if (t.length <= NARRATION_MAX) return t
	const sentences = t.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [t]
	let out = ""
	for (const s of sentences) {
		if (out && (out + s).length > NARRATION_MAX) break
		out += s
	}
	return (out.trim() || t.slice(0, NARRATION_MAX)).trim()
}

function paragraphBlocks(raw: string): { title?: string; body: string[] }[] {
	return raw
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(Boolean)
		.slice(0, 12)
		.map((p) => ({ body: p.split("\n") }))
}

// strip markdown decoration from one line
function clean(line: string): string {
	return line
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → text
		.replace(/[`*_>#]+/g, "") // emphasis / quote / heading marks
		.replace(/^\s*[-*+]\s+/, "") // list bullet
		.replace(/\s+/g, " ")
		.trim()
}

function stripBody(body: string): string {
	return body
		.split("\n")
		.map(clean)
		.filter(Boolean)
		.join(" ")
		.trim()
}

function clip(s: string): string {
	const c = clean(s)
	return c.length <= CAPTION_MAX ? c : `${c.slice(0, CAPTION_MAX - 1).trimEnd()}…`
}
