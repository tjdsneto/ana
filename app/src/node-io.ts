// What each node type reads and writes on disk, beyond its captured deliverable artifact. This answers
// "what's the input and what's the output of this step" on the dashboard: a step's INPUT is its upstream
// deps (node edges, resolved in the UI) plus the board/media files it reads here; its OUTPUT is its own
// captured deliverable (shown on the card) plus the side files it writes here.
//
// Only the build/board steps touch standalone files — the text/planning steps read their inputs as
// injected text and their output IS the captured deliverable, so they return empty here. Paths are
// relative to the artifacts root (what /api/media and the viewer modal take). Grounded in the craft
// skills + tools (voice-production, build-soundtrack, build-assets, assemble-board) and verified against
// a real production's on-disk layout.

export interface FileRef {
	label: string
	path: string // relative to the artifacts root
}

export interface NodeFileIO {
	reads: FileRef[]
	writes: FileRef[]
}

const ref = (label: string, path: string): FileRef => ({ label, path })

export function nodeFileIO(nodeType: string, productionId: string): NodeFileIO {
	const board = `${productionId}/board`
	switch (nodeType) {
		case "build-voice":
			// voice-production: vo.py reads script.txt + film.json's voice block, writes vo.wav + words.json.
			return {
				reads: [ref("script.txt", `${board}/script.txt`), ref("film.json", `${board}/film.json`)],
				writes: [ref("vo.wav", `${board}/media/vo.wav`), ref("words.json", `${board}/media/words.json`)],
			}
		case "build-soundtrack":
			// build-soundtrack: reads the board + the VO word timing, writes the music bed + summed mix + plan.
			return {
				reads: [ref("film.json", `${board}/film.json`), ref("words.json", `${board}/media/words.json`)],
				writes: [
					ref("soundtrack.wav", `${board}/audio/soundtrack.wav`),
					ref("bed.mp3", `${board}/audio/bed.mp3`),
					ref("audio-plan.json", `${board}/audio/audio-plan.json`),
				],
			}
		case "build-assets":
			// build-assets: reads what the storyboard calls for (film.json), writes the assets + their manifest.
			return {
				reads: [ref("film.json", `${board}/film.json`)],
				writes: [ref("assets.json", `${productionId}/assets/assets.json`)],
			}
		case "assemble-board":
			// assemble-board: composes the approved cards into the board's film.json (its captured artifact).
			return { reads: [], writes: [ref("film.json", `${board}/film.json`)] }
		default:
			return { reads: [], writes: [] }
	}
}
