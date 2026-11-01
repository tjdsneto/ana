// EDL (Edit Decision List) — the cut plan for the clip / edit-footage leaf, executed by
// craft/tools/edl-apply.mjs. The editor-mode analogue of the storyboard: a control artifact Claude
// writes and a tool applies, turning a caller-provided asset into a derived asset. Kept on the
// contract surface so every TS consumer (and the tool's docs) share one shape.

export interface EdlSegment {
	/** keep-range start, in seconds (>= 0) */
	in: number
	/** keep-range end, in seconds (> in) */
	out: number
}

export interface EdlCrop {
	x: number
	y: number
	w: number
	h: number
}

export interface EdlAudio {
	/** downmix to N channels (e.g. 1 = mono) */
	channels?: number
	/** gain applied to the selection, in dB */
	gainDb?: number
}

export interface Edl {
	/** the provided asset: an assetId or a path edl-apply resolves */
	source: string
	/** ordered keep-ranges, concatenated in order; omit or empty = keep the whole asset */
	segments?: EdlSegment[]
	/** optional crop (video only), in pixels */
	crop?: EdlCrop
	/** optional audio channel/gain adjustment */
	audio?: EdlAudio
	/** reserved for the motion-graphics/caption skill — not applied by edl-apply */
	captions?: { text: string; start: number; end: number }[]
}
