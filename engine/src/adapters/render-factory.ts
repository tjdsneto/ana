// Render engine selection. The worker asks for a RenderClient by provider name; this factory builds
// it. "stub" writes a text placeholder (default, zero cost); "local" assembles a real .mp4 offline
// (ffmpeg + the injected VoiceClient); heygen/higgsfield/hyperframes are reserved — the factory knows
// their names but throws until an adapter + keys land, so adding one is a single case here. Mirrors
// the SubagentRunner and VoiceClient factories.

import type { Exec, Logger, RenderClient, VoiceClient } from "@core/shared"
import { LocalRenderClient } from "./render-local.js"
import { StubRenderClient } from "./render-stub.js"

export interface RenderConfig {
	provider: string // stub | local
	font?: string // local: TTF for drawtext (RENDER_FONT)
	width?: number
	height?: number
}

export function renderConfigFromEnv(env = process.env): RenderConfig {
	return {
		provider: env.RENDER_PROVIDER ?? "stub",
		font: env.RENDER_FONT,
		width: optNum(env.RENDER_WIDTH),
		height: optNum(env.RENDER_HEIGHT),
	}
}

export interface RenderDeps {
	voice: VoiceClient
	exec: Exec
	logger?: Logger
}

export function makeRender(config: RenderConfig, deps: RenderDeps): RenderClient {
	switch (config.provider) {
		case "stub":
			return new StubRenderClient()
		case "local":
			return new LocalRenderClient(deps.voice, deps.exec, { fontFile: config.font, width: config.width, height: config.height }, deps.logger)
		case "heygen":
		case "higgsfield":
		case "hyperframes":
			throw new Error(`render provider "${config.provider}" is reserved but not implemented yet`)
		default:
			throw new Error(`unknown render provider "${config.provider}"`)
	}
}

function optNum(value: string | undefined): number | undefined {
	if (value === undefined || value === "") return undefined
	const n = Number(value)
	return Number.isFinite(n) && n > 0 ? n : undefined
}
