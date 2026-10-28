// KokoroVoiceClient — offline TTS via Kokoro-82M (open-weights). Behind the same VoiceClient port as
// piper/silent, so VOICE_PROVIDER=kokoro swaps it in with no render or loop change.
//
// NOTE: Kokoro ships in several forms (python `kokoro`, `kokoro-onnx`, community `kokoro-tts` CLIs)
// whose exact argv differ, and onnxruntime is glibc-shaped (see the engine Dockerfile base-image
// decision). The flags below are the default contract — a CLI that reads text on stdin and writes
// --output_file, with --voice selecting the speaker. Override the binary with KOKORO_BIN and the
// speaker with KOKORO_VOICE / input.voice; confirm the flags against the distribution that gets baked
// into the image before trusting a live run.

import type { Exec, VoiceClient, VoiceInput, VoiceResult } from "@core/shared"

export interface KokoroConfig {
	bin?: string // default "kokoro-tts"
	voice?: string // default speaker id (e.g. af_sarah)
}

export class KokoroVoiceClient implements VoiceClient {
	readonly provider = "kokoro"
	private readonly bin: string
	private readonly voice?: string

	constructor(
		private readonly exec: Exec,
		config: KokoroConfig = {},
	) {
		this.bin = config.bin ?? process.env.KOKORO_BIN ?? "kokoro-tts"
		this.voice = config.voice ?? process.env.KOKORO_VOICE
	}

	async synthesize(input: VoiceInput): Promise<VoiceResult> {
		const voice = input.voice ?? this.voice
		const args = ["--output_file", input.outPath]
		if (voice) args.push("--voice", voice)
		const res = await this.exec.run({ bin: this.bin, args, stdin: input.text })
		if (res.code !== 0) throw new Error(`KokoroVoiceClient: ${this.bin} failed (code ${res.code}): ${res.stderr.trim()}`)
		return { audioPath: input.outPath, provider: this.provider, voice, costEstimate: 0 }
	}
}
