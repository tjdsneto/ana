// LocalRenderClient + the render/voice factories, driven through the FakeExec seam — no real ffmpeg,
// ffprobe, piper or kokoro on the box. Asserts the assembly flow (one card + one probe per scene, one
// concat) and that both engines are swappable by provider name.

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RenderInput, VoiceClient, VoiceInput, VoiceResult } from "@core/shared"
import { writeFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { FakeExec } from "./exec-fake.js"
import { LocalRenderClient } from "./render-local.js"
import { makeRender, renderConfigFromEnv } from "./render-factory.js"
import { makeVoice, voiceConfigFromEnv } from "./voice-factory.js"

class FakeVoice implements VoiceClient {
	readonly provider = "fake"
	calls = 0
	async synthesize(input: VoiceInput): Promise<VoiceResult> {
		this.calls++
		writeFileSync(input.outPath, "")
		return { audioPath: input.outPath, provider: this.provider, durationMs: 2000, costEstimate: 0 }
	}
}

const STORYBOARD = ["## Scene 1", "Narration: Meet the product.", "", "## Scene 2", "Narration: Ship in one click."].join("\n")

function outDir(): string {
	return mkdtempSync(join(tmpdir(), "render-"))
}

describe("LocalRenderClient", () => {
	it("assembles one card + one probe per scene, then a single concat, into an .mp4", async () => {
		const voice = new FakeVoice()
		const exec = new FakeExec((req) => (req.bin === "ffprobe" ? { stdout: "2.000\n" } : undefined))
		const render = new LocalRenderClient(voice, exec)

		const input: RenderInput = { kind: "render", spec: { upstream: [{ type: "storyboard", content: STORYBOARD }] }, outDir: outDir() }
		const out = await render.render(input)

		expect(out.artifactPath.endsWith(".mp4")).toBe(true)
		expect(out.meta?.scenes).toBe(2)
		expect(out.meta?.provider).toBe("local")
		expect(out.meta?.voice).toBe("fake")
		expect(voice.calls).toBe(2)
		expect(exec.calls.filter((c) => c.bin === "ffprobe")).toHaveLength(2) // one duration probe per scene
		const ffmpeg = exec.calls.filter((c) => c.bin === "ffmpeg")
		expect(ffmpeg).toHaveLength(3) // 2 scene cards + 1 concat
		expect(ffmpeg.at(-1)!.args).toContain("concat") // last ffmpeg is the concat
		expect(ffmpeg[0]!.args.join(" ")).toContain("drawtext") // cards draw the caption
	})

	it("falls back to a placeholder scene when there is no storyboard", async () => {
		const voice = new FakeVoice()
		const exec = new FakeExec((req) => (req.bin === "ffprobe" ? { stdout: "1.500\n" } : undefined))
		const render = new LocalRenderClient(voice, exec)
		const out = await render.render({ kind: "render", spec: {}, outDir: outDir() })
		expect(out.meta?.scenes).toBe(1)
		expect(voice.calls).toBe(1)
	})
})

describe("render + voice factories — swappable by provider", () => {
	const voice = new FakeVoice()
	const exec = new FakeExec()

	it("builds render engines by name and reserves the hosted ones", () => {
		expect(makeRender({ provider: "stub" }, { voice, exec }).provider).toBe("stub")
		expect(makeRender({ provider: "local" }, { voice, exec }).provider).toBe("local")
		expect(() => makeRender({ provider: "heygen" }, { voice, exec })).toThrow(/reserved/)
		expect(() => makeRender({ provider: "nope" }, { voice, exec })).toThrow(/unknown/)
	})

	it("builds voice engines by name", () => {
		expect(makeVoice({ provider: "silent" }, exec).provider).toBe("silent")
		expect(makeVoice({ provider: "piper" }, exec).provider).toBe("piper")
		expect(makeVoice({ provider: "kokoro" }, exec).provider).toBe("kokoro")
		expect(() => makeVoice({ provider: "nope" }, exec)).toThrow(/unknown/)
	})

	it("defaults to stub render + silent voice", () => {
		expect(renderConfigFromEnv({}).provider).toBe("stub")
		expect(voiceConfigFromEnv({}).provider).toBe("silent")
	})
})
