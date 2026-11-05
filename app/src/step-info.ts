// The fixed, per-type description of each pipeline step — what the step IS, independent of any one
// production. Mirrors the `description` field in each engine/types/<type>/type.json (the type registry's
// own one-line summary). Surfaced behind the info icon on a step card so the role of the step is one
// hover away. Keep in sync with the type.json descriptions if they change.

const STEP_DESCRIPTIONS: Record<string, string> = {
	"video-project":
		"Root two-phase production: briefing → research → WHAT brainstorm (brainstorm → brainstorm-select) → HOW brainstorm (brainstorm-how → brainstorm-how-select). The HOW winner materializes the rest of the spine — script → moodboard → storyboard → board → build → assemble → polish → final review — as siblings.",
	briefing: "Agreement step that extracts and confirms the request's key points (goal, audience, tone, length, must-include messages); client approval is the gate.",
	research: "Explores and captures the video's subject, then outputs the research dossier (verified vs. unverified facts, captured assets + focus marks).",
	brainstorm: "Planner that seeds the distinct video concepts to explore (default 3) from the briefing + research, fanned out into parallel idea agents.",
	idea: "Develops one seeded concept into a full treatment — a candidate, not the final storyboard.",
	"brainstorm-select": "Judges the developed concepts and outputs the single winning concept in full — the spec the script is written from.",
	"brainstorm-how": "Planner that seeds the distinct production approaches to explore (default 3) from the brief + the winning concept + the capability registry, fanned out into parallel how-idea agents.",
	"how-idea": "Develops one seeded production approach into a concrete candidate DAG over the universal spine — a candidate, not the frozen pipeline.",
	"brainstorm-how-select": "Judges the candidate production approaches and emits the single winning approach as the frozen production DAG — the sibling spine the engine materializes.",
	script: "Writes the short, tight video script that delivers the brief's messages in the target length, hook first and lines speakable.",
	moodboard: "Defines the visual direction — palette, typography, imagery references, motion feel — consistent with the brief's tone.",
	storyboard: "Planner that lays out the board beats (one card per beat) from the approved script + moodboard, owning whole-board coherence; fanned out into card nodes.",
	card: "Root-capable leaf that composes one card/beat — its plate HTML file (plates/<id>.html) and camera params — per the moodboard + craft bar.",
	"assemble-board": "Composite leaf that stitches the approved cards into the final film.json (playback order, shared font) the render consumes; reviewed for board consistency.",
	build: "Checklist step that fans out production of assets, voice, soundtrack, and scenes (scenes depend on assets + voice).",
	"build-assets": "Leaf that produces the assets the scenes draw from — captured real-UI plates, images, characters, or 3D assets the storyboard calls for.",
	"build-voice": "Leaf that produces the voiceover and its word timing — the shared timeline clock the scenes anchor to — for the whole video.",
	"build-soundtrack": "Leaf that produces the music track and declares the audio tracks (voice / music / sfx) the mix will sum.",
	"build-scenes": "Planner that breaks the approved storyboard (film.json) into one independent scene per storyboard scene, in playback order, fanned out.",
	scene: "Root-capable leaf that produces one scene by its realization method (authored-composite / authored-continuous / whole-clip-generative / edit-footage / motion-graphics).",
	clip: "Root-capable leaf that cuts one clip from a provided footage asset (the wanted span/crop).",
	assemble: "Composite leaf that stitches the production's approved scene clips into the finished video file; reviewed for consistency and audio.",
	polish: "Tightens timing, captions, and audio levels; fixes the rough edges from the render pass.",
	"final-review": "Holistic whole-production review; on revise it reopens named upstream nodes (approved → pending) and cascades, capped by maxGlobalRevisions.",
}

// The fixed description for a node type, or null when the type has none (so the info icon is hidden).
export function stepDescription(nodeType: string): string | null {
	return STEP_DESCRIPTIONS[nodeType] ?? null
}
