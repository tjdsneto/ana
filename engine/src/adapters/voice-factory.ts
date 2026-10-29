// Voice engine selection. The worker asks for a VoiceClient by provider name; this factory builds
// it, passing the Exec seam (so every voice engine runs its binary through one audited path) and the
// per-provider config. Mirrors the SubagentRunner factory: adding a cloud TTS is one case here, not a
// render/loop change. Default is "silent" — a silent track, no TTS binary, no network, zero spend.

import type { Exec, VoiceClient } from "@core/shared"
import { KokoroVoiceClient } from "./voice-kokoro.js"
import { PiperVoiceClient } from "./voice-piper.js"
import { SilentVoiceClient } from "./voice-silent.js"

export interface VoiceConfig {
	provider: string // silent | piper | kokoro
	model?: string // piper: .onnx model path (VOICE_MODEL / PIPER_MODEL)
	voice?: string // kokoro: speaker id (VOICE_ID / KOKORO_VOICE)
	bin?: string // override the engine binary
}

export function voiceConfigFromEnv(env = process.env): VoiceConfig {
	// Coerce "" → undefined: Compose passes unset knobs as empty strings (environment: VOICE_BIN:
	// ${VOICE_BIN:-}), and an empty bin/model must fall back to the default, not become spawn("").
	return {
		provider: blank(env.VOICE_PROVIDER) ?? "silent",
		model: blank(env.VOICE_MODEL),
		voice: blank(env.VOICE_ID),
		bin: blank(env.VOICE_BIN),
	}
}

function blank(v: string | undefined): string | undefined {
	return v === undefined || v === "" ? undefined : v
}

export function makeVoice(config: VoiceConfig, exec: Exec): VoiceClient {
	switch (config.provider) {
		case "silent":
		case "fake":
		case "none":
			return new SilentVoiceClient(exec)
		case "piper":
			return new PiperVoiceClient(exec, { bin: config.bin, model: config.model })
		case "kokoro":
			return new KokoroVoiceClient(exec, { bin: config.bin, voice: config.voice })
		default:
			throw new Error(`unknown VoiceClient provider "${config.provider}"`)
	}
}
