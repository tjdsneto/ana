import React, { useEffect, useRef } from "react"
import { AbsoluteFill, continueRender, delayRender, useCurrentFrame, useVideoConfig } from "remotion"

export type Props = { html: string; fps: number }

// Derive size + duration from the injected HTML (HyperFrames shape): #stage data-width/height, and the
// composition length = the latest clip's data-start + data-duration (fallback 3s).
export const calcMeta = async ({ props }: { props: Props }) => {
	const html = props.html || ""
	const num = (re: RegExp, d: number) => {
		const m = re.exec(html)
		return m ? Number(m[1]) : d
	}
	const width = num(/data-width="(\d+)"/, 1280)
	const height = num(/data-height="(\d+)"/, 720)
	let dur = 0
	const re = /data-start="([\d.]+)"[^>]*?data-duration="([\d.]+)"/g
	let m: RegExpExecArray | null
	while ((m = re.exec(html))) dur = Math.max(dur, Number(m[1]) + Number(m[2]))
	const fps = props.fps || 30
	return { width, height, fps, durationInFrames: Math.max(1, Math.round((dur || 3) * fps)) }
}

// Render the HTML in an iframe and seek its paused GSAP timeline(s) to the current frame's time. Each
// frame delays the capture until the seek + two paints settle, so Remotion snapshots the right moment.
export const Comp: React.FC<Props> = ({ html }) => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const ref = useRef<HTMLIFrameElement>(null)

	useEffect(() => {
		const handle = delayRender(`mg frame ${frame}`)
		const seek = () => {
			const w = ref.current?.contentWindow as any
			const tls = w?.__timelines
			if (tls) for (const k in tls) { try { tls[k].time(frame / fps) } catch {} }
			requestAnimationFrame(() => requestAnimationFrame(() => continueRender(handle)))
		}
		const ready = (ref.current?.contentWindow as any)?.__timelines
		if (ready) seek()
		else {
			let tries = 0
			const t = setInterval(() => {
				if ((ref.current?.contentWindow as any)?.__timelines || tries++ > 80) {
					clearInterval(t)
					seek()
				}
			}, 25)
		}
	}, [frame, fps])

	return (
		<AbsoluteFill>
			<iframe
				ref={ref}
				srcDoc={html}
				sandbox="allow-scripts allow-same-origin"
				style={{ width: "100%", height: "100%", border: 0 }}
			/>
		</AbsoluteFill>
	)
}
