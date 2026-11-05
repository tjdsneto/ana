// Pure helpers for the dashboard media views: classify a file for the viewer modal, pair the per-scene
// voice clips with their script lines, split the script, and pretty-print JSON. No React, no fetch —
// unit-tested in media-view.test.ts.

export type FileViewKind = "audio" | "image" | "video" | "json" | "text"

const AUDIO_RE = /\.(wav|mp3|m4a|aac|ogg|flac)$/i
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i
const VIDEO_RE = /\.(mp4|mov|webm|mkv)$/i
const JSON_RE = /\.json$/i

// How the file-viewer modal should render a file, keyed off its extension. Anything that isn't a known
// audio/image/video/json type is shown as plain text (txt, md, srt, …) — the modal fetches and <pre>s it.
export function fileViewKind(name: string): FileViewKind {
	if (AUDIO_RE.test(name)) return "audio"
	if (IMAGE_RE.test(name)) return "image"
	if (VIDEO_RE.test(name)) return "video"
	if (JSON_RE.test(name)) return "json"
	return "text"
}

// The scene number a per-scene voice clip encodes in its basename: "s03.wav" → 3. null when the name
// doesn't follow that convention, so the caller can fall back to list order.
export function sceneNumFromName(name: string): number | null {
	const m = /^s(\d+)\./i.exec(name)
	return m?.[1] ? Number.parseInt(m[1], 10) : null
}

// Split a script.txt into its spoken lines: trimmed, blank lines dropped, original order kept. Each
// surviving line is one scene's narration (line N ↔ scene N).
export function splitScriptLines(raw: string): string[] {
	return raw
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
}

export interface VoicePair {
	n: number // 1-based scene index
	text: string // the script line for this scene ("" when there are more clips than lines)
	clip?: { name: string; path: string } // the voice clip for this scene, if one exists
}

// Pair each script line with its per-scene voice clip so the card can show the small text beside the
// small audio instead of one big file. A clip named sNN pairs to line NN; if no clip uses that
// convention, clips pair to lines by order. Rows cover the union of lines and clips, so a missing clip
// (clip undefined) or a trailing extra clip (empty text) still shows rather than being silently dropped.
export function pairVoiceClips(lines: string[], clips: Array<{ name: string; path: string }>): VoicePair[] {
	const sorted = [...clips].sort((a, b) => {
		const na = sceneNumFromName(a.name)
		const nb = sceneNumFromName(b.name)
		if (na != null && nb != null) return na - nb
		return a.name < b.name ? -1 : 1
	})
	const hasSceneNums = sorted.some((c) => sceneNumFromName(c.name) != null)
	const count = Math.max(lines.length, sorted.length)
	const rows: VoicePair[] = []
	for (let i = 0; i < count; i++) {
		const n = i + 1
		const clip = hasSceneNums ? sorted.find((c) => sceneNumFromName(c.name) === n) : sorted[i]
		rows.push({ n, text: lines[i] ?? "", clip })
	}
	return rows
}

// Re-indent JSON for the viewer modal; if the text doesn't parse (truncated, not JSON), show it as-is.
export function prettyJson(raw: string): string {
	try {
		return JSON.stringify(JSON.parse(raw), null, 2)
	} catch {
		return raw
	}
}
