// LocalRenderClient — the offline render engine: turns the storyboard into a real, playable .mp4 with
// no external API and no key. It parses the storyboard into scenes, asks the injected VoiceClient for
// each scene's narration audio, draws a title/caption card per scene (ffmpeg drawtext over a solid
// background), sizes each card to its narration, and concatenates the cards into one video.
//
// This is the piece that stays even once external asset engines (HeyGen/Higgsfield/HyperFrames) land:
// those swap the per-scene *visual source*, but ffmpeg still assembles — stitch, caption, lay audio,
// transcode. Both the render engine (RenderClient) and the voice engine (VoiceClient) are injected,
// so each swaps independently. ffmpeg/ffprobe run through the Exec port, so this unit-tests with no
// real binaries.

import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Exec, ExecRequest, Logger, RenderClient, RenderInput, RenderResult, VoiceClient } from "@core/shared"
import { NoopLogger } from "@core/shared"
import { parseScenes } from "./storyboard-parse.js"

export interface LocalRenderConfig {
	width?: number // default 1280
	height?: number // default 720
	fontFile?: string // drawtext needs a TTF; default from RENDER_FONT (baked into the image)
	bgColor?: string // card background, ffmpeg color syntax; default 0x111827
	fontColor?: string // default white
	fontSize?: number // default 40
	minSceneMs?: number // floor per scene so a short line still holds; default 2500
	motion?: boolean // animatic motion (animated gradient bg + scene fades) via RENDER_MOTION; default off
	accentColor?: string // second gradient colour for motion; default 0x1b2a4a
}

export class LocalRenderClient implements RenderClient {
	readonly provider = "local"
	private readonly cfg: Required<Omit<LocalRenderConfig, "fontFile">> & { fontFile?: string }
	private readonly log: Logger

	constructor(
		private readonly voice: VoiceClient,
		private readonly exec: Exec,
		config: LocalRenderConfig = {},
		logger?: Logger,
	) {
		this.cfg = {
			width: config.width ?? 1280,
			height: config.height ?? 720,
			fontFile: config.fontFile ?? process.env.RENDER_FONT,
			bgColor: config.bgColor ?? "0x111827",
			fontColor: config.fontColor ?? "white",
			fontSize: config.fontSize ?? 40,
			minSceneMs: config.minSceneMs ?? 2500,
			motion: config.motion ?? process.env.RENDER_MOTION === "1",
			accentColor: config.accentColor ?? "0x1b2a4a",
		}
		this.log = logger ?? new NoopLogger()
	}

	async render(input: RenderInput): Promise<RenderResult> {
		const storyboard = pickStoryboard(input.spec)
		const scenes = parseScenes(storyboard)
		const work = join(input.outDir, `local-${randomUUID().slice(0, 8)}`)
		mkdirSync(work, { recursive: true })

		const sceneFiles: string[] = []
		const audioFiles: string[] = [] // narration audio kept on disk; returned so the production retains it
		let totalMs = 0
		for (let i = 0; i < scenes.length; i++) {
			const scene = scenes[i]!
			const audioPath = join(work, `scene-${i}.wav`)
			await this.voice.synthesize({ text: scene.narration, outPath: audioPath })
			audioFiles.push(audioPath)
			const audioMs = await this.probeDurationMs(audioPath)
			const sceneMs = Math.max(this.cfg.minSceneMs, audioMs)
			totalMs += sceneMs

			const textFile = join(work, `scene-${i}.txt`)
			writeFileSync(textFile, scene.caption, "utf8")
			const scenePath = join(work, `scene-${i}.mp4`)
			const card = { textFile, audioPath, outPath: scenePath, durationMs: sceneMs }
			let res = await this.exec.run(this.cardCommand(card, this.cfg.motion))
			if (res.code !== 0 && this.cfg.motion) {
				// motion (animated gradient) is fiddlier — fall back to the proven static card (D1).
				this.log.warn("render.local.motion_fallback", { scene: i, stderr: res.stderr.trim().slice(0, 160) })
				res = await this.exec.run(this.cardCommand(card, false))
			}
			if (res.code !== 0) throw new Error(`LocalRenderClient: scene ${i} render failed (code ${res.code}): ${res.stderr.trim()}`)
			sceneFiles.push(scenePath)
		}

		const listPath = join(work, "concat.txt")
		writeFileSync(listPath, sceneFiles.map((p) => `file '${p}'`).join("\n") + "\n", "utf8")
		const outPath = join(input.outDir, `${input.kind}-${randomUUID().slice(0, 8)}.mp4`)
		const cat = await this.exec.run(this.concatCommand({ listPath, outPath }))
		if (cat.code !== 0) throw new Error(`LocalRenderClient: concat failed (code ${cat.code}): ${cat.stderr.trim()}`)

		this.log.info("render.local.done", { scenes: scenes.length, totalMs, voice: this.voice.provider, outPath })
		return {
			artifactPath: outPath,
			costEstimate: 0,
			audioFiles,
			meta: { provider: this.provider, scenes: scenes.length, durationMs: totalMs, voice: this.voice.provider },
		}
	}

	// ── ffmpeg command builders (pure — the tests assert on these argv) ────────────────────────────

	// One scene: a background for `durationMs`, the caption drawn from a text file (so no drawtext
	// escaping), the narration as the audio track. H.264 + yuv420p + AAC so the scenes concat and play
	// everywhere. `motion` swaps the solid background for an animated gradient and adds a fade in/out —
	// the "animatic" feel — and is retried as a static card on failure (see render()).
	cardCommand(a: { textFile: string; audioPath: string; outPath: string; durationMs: number }, motion = false): ExecRequest {
		const seconds = (a.durationMs / 1000).toFixed(3)
		const { width: w, height: h } = this.cfg
		const draw = [
			this.cfg.fontFile ? `fontfile=${this.cfg.fontFile}` : undefined,
			`textfile=${a.textFile}`,
			`fontcolor=${this.cfg.fontColor}`,
			`fontsize=${this.cfg.fontSize}`,
			"x=(w-text_w)/2",
			"y=(h-text_h)/2",
			"line_spacing=12",
		]
			.filter(Boolean)
			.join(":")
		// Background source: animated gradient (motion) or a solid colour (static).
		const bgInput = motion
			? `gradients=s=${w}x${h}:c0=${this.cfg.bgColor}:c1=${this.cfg.accentColor}:duration=${seconds}:speed=0.008`
			: `color=c=${this.cfg.bgColor}:s=${w}x${h}:d=${seconds}`
		// Video filter: caption, plus (motion) a half-second fade in and out bracketing the scene.
		const fadeOut = Math.max(0, a.durationMs / 1000 - 0.5).toFixed(3)
		const vf = motion ? `drawtext=${draw},fade=t=in:st=0:d=0.5,fade=t=out:st=${fadeOut}:d=0.5` : `drawtext=${draw}`
		return {
			bin: "ffmpeg",
			args: [
				"-y",
				"-f",
				"lavfi",
				"-i",
				bgInput,
				"-i",
				a.audioPath,
				"-vf",
				vf,
				"-t",
				seconds,
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				"-c:a",
				"aac",
				"-ar",
				"24000",
				a.outPath,
			],
		}
	}

	concatCommand(a: { listPath: string; outPath: string }): ExecRequest {
		return { bin: "ffmpeg", args: ["-y", "-f", "concat", "-safe", "0", "-i", a.listPath, "-c", "copy", a.outPath] }
	}

	private async probeDurationMs(audioPath: string): Promise<number> {
		const res = await this.exec.run({
			bin: "ffprobe",
			args: ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", audioPath],
		})
		const seconds = Number.parseFloat(res.stdout.trim())
		return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0
	}
}

interface SpecShape {
	brief?: string
	upstream?: { type: string; content: string }[]
}

// The storyboard text to render: prefer the upstream storyboard artifact, else any upstream content,
// else the brief. Keeps LocalRenderClient working even if the storyboard node names its type oddly.
function pickStoryboard(spec: unknown): string {
	const s = (spec ?? {}) as SpecShape
	const up = s.upstream ?? []
	const board = up.find((u) => /storyboard|script/i.test(u.type))
	return board?.content ?? up[0]?.content ?? s.brief ?? ""
}
