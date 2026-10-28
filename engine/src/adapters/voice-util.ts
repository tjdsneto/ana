// Shared helpers for the voice adapters.

// Rough spoken-duration estimate from word count (default ~150 wpm), floored so a one-word scene
// still gets a visible beat. Used by the silent adapter to size its track; real TTS engines produce
// their own length (the local assembler ffprobes the actual audio, so this is only a fallback).
export function estimateSpeechMs(text: string, wpm = 150): number {
	const words = text.trim().split(/\s+/).filter(Boolean).length
	const ms = (words / wpm) * 60_000
	return Math.max(1200, Math.round(ms))
}
