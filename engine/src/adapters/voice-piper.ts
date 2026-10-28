// PiperVoiceClient — offline neural TTS via piper (https://github.com/rhasspy/piper). piper reads the
// text on stdin and writes a wav to --output_file; a voice is a local .onnx model file (no network,
// no key). Config: PIPER_BIN (binary) + PIPER_MODEL (the .onnx voice), or per-call input.voice to
// override the model. Satisfies the VoiceClient port, so it drops in behind VOICE_PROVIDER=piper.

import type { Exec, VoiceClient, VoiceInput, VoiceResult } from "@core/shared"

export interface PiperConfig {
	bin?: string // default "piper"
	model?: string // path to the default .onnx voice model
}

export class PiperVoiceClient implements VoiceClient {
	readonly provider = "piper"
	private readonly bin: string
	private readonly model?: string

	constructor(
		private readonly exec: Exec,
		config: PiperConfig = {},
	) {
		this.bin = config.bin ?? process.env.PIPER_BIN ?? "piper"
		this.model = config.model ?? process.env.PIPER_MODEL
	}

	async synthesize(input: VoiceInput): Promise<VoiceResult> {
		const model = input.voice ?? this.model
		if (!model) throw new Error("PiperVoiceClient: no voice model (set PIPER_MODEL or pass input.voice)")
		const res = await this.exec.run({
			bin: this.bin,
			args: ["--model", model, "--output_file", input.outPath],
			stdin: input.text,
		})
		if (res.code !== 0) throw new Error(`PiperVoiceClient: piper failed (code ${res.code}): ${res.stderr.trim()}`)
		return { audioPath: input.outPath, provider: this.provider, voice: model, costEstimate: 0 }
	}
}
