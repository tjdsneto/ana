// SilentVoiceClient — the zero-dependency voice engine: no TTS, just a silent audio track sized to
// the estimated narration length (via ffmpeg's anullsrc). It is the default VOICE_PROVIDER and the
// fake the local-render tests run against, so a video still assembles (correct scene timing, no
// speech) with no TTS binary and no model on the box. Swap it for piper/kokoro to get real speech.

import type { Exec, VoiceClient, VoiceInput, VoiceResult } from "@core/shared"
import { estimateSpeechMs } from "./voice-util.js"

export class SilentVoiceClient implements VoiceClient {
	readonly provider = "silent"
	constructor(private readonly exec: Exec) {}

	async synthesize(input: VoiceInput): Promise<VoiceResult> {
		const durationMs = estimateSpeechMs(input.text)
		const seconds = (durationMs / 1000).toFixed(3)
		// anullsrc = a silent source; -t caps it to the estimated length. 24kHz mono is plenty for a
		// placeholder track and keeps files tiny.
		const res = await this.exec.run({
			bin: "ffmpeg",
			args: ["-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", seconds, input.outPath],
		})
		if (res.code !== 0) throw new Error(`SilentVoiceClient: ffmpeg anullsrc failed (code ${res.code}): ${res.stderr.trim()}`)
		return { audioPath: input.outPath, provider: this.provider, durationMs, costEstimate: 0 }
	}
}
