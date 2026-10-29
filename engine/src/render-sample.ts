// Dev utility: render a sample storyboard straight through the RenderClient/VoiceClient ports, with
// no DB and no gated pipeline — the quickest proof that a real .mp4 comes out. Defaults to the local
// ffmpeg engine + piper (override with RENDER_PROVIDER / VOICE_PROVIDER). Run inside the engine image:
//   docker compose run --rm --no-deps engine-worker node engine/dist/render-sample.js

import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { JsonLogger } from "@core/shared"
import { NodeExec } from "./adapters/exec-node.js"
import { makeRender, renderConfigFromEnv } from "./adapters/render-factory.js"
import { makeVoice, voiceConfigFromEnv } from "./adapters/voice-factory.js"

const SAMPLE = [
	"## Scene 1 — Hook",
	"Narration: Shipping a video used to take a studio. Not anymore.",
	"",
	"## Scene 2 — Product",
	"Narration: Describe your idea. The agent writes it, boards it, and renders it.",
	"",
	"## Scene 3 — Call to action",
	"Narration: A finished video in minutes. No crew, no keys.",
].join("\n")

async function main(): Promise<void> {
	process.env.RENDER_PROVIDER ??= "local"
	process.env.VOICE_PROVIDER ??= "piper"
	const logger = new JsonLogger({ bound: { svc: "render-sample" } })
	const exec = new NodeExec()
	const voice = makeVoice(voiceConfigFromEnv(), exec)
	const render = makeRender(renderConfigFromEnv(), { voice, exec, logger })

	const outDir = join(process.env.ARTIFACTS_DIR ?? "/data/artifacts", "sample")
	mkdirSync(outDir, { recursive: true })
	const result = await render.render({ kind: "sample", spec: { upstream: [{ type: "storyboard", content: SAMPLE }] }, outDir })

	process.stdout.write(`${JSON.stringify({ render: render.provider, voice: voice.provider, ...result }, null, 2)}\n`)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
