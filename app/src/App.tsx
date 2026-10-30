// The dashboard UI. Left: productions. Right: the selected production rendered as a column of big
// stage cards (briefing, script, moodboard, storyboard, render, …). Each card expands to a revision
// timeline: every version with the artifact rendered in its proper form, the feedback that version
// received, and the producer/reviewer run behind it (model, session, tokens, cost, duration). It
// refetches on every WebSocket nudge, so the view tracks the worker in real time.

import { useEffect, useRef, useState } from "react"
import {
	approveBudget,
	approveOutput,
	getDeliverable,
	getProduction,
	getProductions,
	getVideos,
	isVideoPath,
	videoUrlByPath,
	videoUrlByVersion,
	type ChatOutput,
	type Interaction,
	type Node,
	type NodeView,
	type ProductionDetail,
	type Review,
	sendFeedback,
	type UsageSummary,
	type Version,
	type VideoFile,
} from "./api.js"
import { Markdown } from "./markdown.js"
import { useLive } from "./useLive.js"

type Tab = "productions" | "videos"

export function App() {
	const [tab, setTab] = useState<Tab>("productions")
	const [productions, setProductions] = useState<Node[]>([])
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [detail, setDetail] = useState<ProductionDetail | null>(null)
	const [videos, setVideos] = useState<VideoFile[]>([])
	const [error, setError] = useState<string | null>(null)
	const selectedRef = useRef<string | null>(null)
	selectedRef.current = selectedId

	const refreshList = async () => {
		try {
			setProductions(await getProductions())
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}

	const refreshDetail = async (id: string) => {
		try {
			setDetail(await getProduction(id))
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}

	const refreshVideos = async () => {
		try {
			setVideos(await getVideos())
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}

	useEffect(() => {
		void refreshList()
		void refreshVideos()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	useEffect(() => {
		if (selectedId) void refreshDetail(selectedId)
		else setDetail(null)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedId])

	const { connected } = useLive(() => {
		void refreshList()
		void refreshVideos()
		const id = selectedRef.current
		if (id) void refreshDetail(id)
	})

	return (
		<div className="app">
			<header className="topline">
				<div className="brand">
					<span className={`dot ${connected ? "on" : "off"}`} title={connected ? "live" : "disconnected"} />
					<h1>Engine</h1>
					<span className="sub">production dashboard</span>
				</div>
				<nav className="tabs">
					<button className={tab === "productions" ? "on" : ""} onClick={() => setTab("productions")}>Productions</button>
					<button className={tab === "videos" ? "on" : ""} onClick={() => setTab("videos")}>
						Videos {videos.length > 0 && <span className="badge">{videos.length}</span>}
					</button>
				</nav>
			</header>
			{error && <div className="error" onClick={() => setError(null)}>{error} (click to dismiss)</div>}
			{tab === "videos" ? (
				<Gallery videos={videos} />
			) : (
				<div className="shell">
					<aside className="rail">
						<div className="rail-head"><span>Productions</span><span>{productions.length}</span></div>
						{productions.length === 0 && <p className="muted pad">No productions yet.</p>}
						{productions.map((p) => (
							<button key={p.id} className={`prod ${p.id === selectedId ? "sel" : ""}`} onClick={() => setSelectedId(p.id)}>
								<div className="ptitle">{p.name}</div>
								<div className="pmeta">
									<StatusChip status={p.status} />
									<span className="muted">{fmtTime(p.createdAt)}</span>
								</div>
							</button>
						))}
					</aside>
					<main className="detail">
						{!detail && <p className="muted pad">Select a production.</p>}
						{detail && <Detail detail={detail} onAction={() => selectedId && refreshDetail(selectedId)} />}
					</main>
				</div>
			)}
		</div>
	)
}

function Detail({ detail, onAction }: { detail: ProductionDetail; onAction: () => void }) {
	const stages = childrenOf(detail, detail.root.id)
	const fv = finalVideoOf(detail)
	const head = (
		<>
			<h2>{detail.root.name} <StatusChip status={detail.root.status} /></h2>
			<div className="hmeta muted">
				<span>started {fmtTime(detail.root.createdAt)}</span>
				<span>· {detail.root.autonomyLever ?? "—"}</span>
				<span>· {detail.root.actorKind ?? "—"}</span>
				<span className="idtag" title={detail.root.id}>{shortId(detail.root.id)}</span>
			</div>
		</>
	)
	return (
		<>
			{fv ? (
				<section className="hero">
					<div className="hero-media">
						<video className="hero-video" controls preload="metadata" src={videoUrlByVersion(fv.versionId)} />
						<span className="hero-cap">Final cut · {titleCase(fv.nodeType)} v{fv.n} · {fv.status}{detail.root.status !== "approved" ? " (production still running)" : ""}</span>
					</div>
					<div className="hero-info">{head}</div>
				</section>
			) : (
				<div className="phead">{head}</div>
			)}
			<div className="phead">
				<UsageStrip usage={detail.usage} />
			</div>
			<Gate inbox={detail.inbox} productionId={detail.root.id} budget={detail.budget} onAction={onAction} />
			<div className="stages">
				{stages.length === 0 && <p className="muted pad">No stages yet — the worker hasn't expanded this production.</p>}
				{stages.map((nv) => (
					<StageCard key={nv.node.id} nv={nv} detail={detail} />
				))}
			</div>
			{detail.assets.length > 0 && (
				<div className="stage">
					<div className="stage-body open-static">
						<div className="sub-h">Assets</div>
						<ul className="assets">
							{detail.assets.map((a) => (
								<li key={a.id}><code>{a.assetType}/{a.fileType}</code> {a.name} <span className="muted">{a.storagePath}</span></li>
							))}
						</ul>
					</div>
				</div>
			)}
		</>
	)
}

// One major pipeline step as a big card. Collapsed = name + status + latest version + a preview.
// Expanded = the revision timeline, plus any child nodes nested as their own stage cards.
function StageCard({ nv, detail, depth = 0 }: { nv: NodeView; detail: ProductionDetail; depth?: number }) {
	const [open, setOpen] = useState(() => needsAttention(nv.node.status))
	const kids = childrenOf(detail, nv.node.id)
	const versions = [...nv.versions].sort((a, b) => a.version.n - b.version.n)
	const latest = versions[versions.length - 1]
	const nRevise = versions.reduce((s, v) => s + v.reviews.filter((r) => r.verdict === "revise").length, 0)

	return (
		<section className={`stage ${open ? "open" : ""} ${depth > 0 ? "nested" : ""}`}>
			<button className="stage-head" onClick={() => setOpen((o) => !o)}>
				<span className="stage-ico" aria-hidden="true"><StageIcon type={nv.node.type} /></span>
				<span className="stage-main">
					<span className="stage-name">
						{titleCase(nv.node.type)}
						<StatusChip status={nv.node.status} />
						{nRevise > 0 && <span className="chip danger">{nRevise} revise</span>}
					</span>
					<span className="stage-prev">{previewOf(nv, latest)}</span>
				</span>
				<span className="stage-right">
					<Chevron />
				</span>
			</button>
			<div className="stage-body">
				{versions.length === 0 && <p className="muted">Nothing produced yet.</p>}
				{versions.length > 0 && (
					<div className="revs">
						{versions.map((vw, i) => (
							<VersionBlock
								key={vw.version.id}
								vw={vw}
								interactions={nv.interactions}
								nodeType={nv.node.type}
								isLast={i === versions.length - 1}
								nextN={versions[i + 1]?.version.n ?? null}
							/>
						))}
					</div>
				)}
				{kids.length > 0 && (
					<>
						<div className="sub-h">Sub-steps</div>
						<div className="stages nested-stages">
							{kids.map((k) => (
								<StageCard key={k.node.id} nv={k} detail={detail} depth={depth + 1} />
							))}
						</div>
					</>
				)}
			</div>
		</section>
	)
}

// One attempt in the timeline: the producer run, the artifact it produced, and the feedback it got.
function VersionBlock({
	vw,
	interactions,
	nodeType,
	isLast,
	nextN,
}: {
	vw: { version: Version; reviews: Review[] }
	interactions: Interaction[]
	nodeType: string
	isLast: boolean
	nextN: number | null
}) {
	const { version, reviews } = vw
	const producer = interactions.find((i) => i.versionId === version.id && i.role === "producer")
	const revStatus = version.status === "needs-work" || version.status === "revise" || version.status === "denied"
	return (
		<div className={`rev ${isLast ? "cur" : ""} ${revStatus && !isLast ? "fail" : ""}`}>
			<div className="rev-mark"><span className="rev-dot">v{version.n}</span><span className="rev-line" /></div>
			<div className="rev-content">
				<div className="rev-top">
					<StatusChip status={version.status} />
					<span className="rev-time">{fmtTime(version.createdAt)}</span>
					{producer && <RunButton interaction={producer} title={`${titleCase(nodeType)} · producer · v${version.n}`} versionId={version.id} />}
				</div>
				<div className="rev-art">
					<ArtifactView versionId={version.id} artifactPath={version.artifactPath} nodeType={nodeType} n={version.n} isLast={isLast} />
				</div>
				{version.feedback && <div className="feeds note-feedback"><b>Human feedback:</b> {version.feedback}</div>}
				{reviews.length > 0 && (
					<>
						<div className="sub-h">Feedback this version received</div>
						{reviews.map((r) => (
							<ReviewCard key={r.id} review={r} interaction={interactions.find((i) => i.versionId === version.id && i.role === `review:${r.kind}`)} />
						))}
					</>
				)}
				{nextN != null && (
					<div className="feeds">
						<ArrowDown />
						<span>Handed to the producer to write <b>v{nextN}</b>.</span>
					</div>
				)}
				{isLast && reviews.some((r) => r.verdict === "revise") && (
					<div className="feeds">
						<Loop />
						<span>Open feedback — a <b>v{version.n + 1}</b> run will address it next.</span>
					</div>
				)}
			</div>
		</div>
	)
}

// Renders the artifact in its proper form, by kind, with a Rendered / Raw toggle. Video streams
// inline (the same player the Videos tab uses); text is fetched lazily and parsed per kind.
function ArtifactView({
	versionId,
	artifactPath,
	nodeType,
	n,
	isLast,
}: {
	versionId: string
	artifactPath: string | null
	nodeType: string
	n: number
	isLast: boolean
}) {
	const video = isVideoPath(artifactPath)
	const [raw, setRaw] = useState(false)
	const [content, setContent] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)
	const [missing, setMissing] = useState<string | null>(null)

	useEffect(() => {
		if (video) return
		let alive = true
		setLoading(true)
		void getDeliverable(versionId)
			.then((d) => {
				if (!alive) return
				if (d.content != null) setContent(d.content)
				else setMissing(d.artifact_path ?? "(no artifact written yet)")
			})
			.catch((e) => alive && setMissing(e instanceof Error ? e.message : String(e)))
			.finally(() => alive && setLoading(false))
		return () => {
			alive = false
		}
	}, [versionId, video])

	const kind = artifactKind(nodeType, artifactPath)
	const label = `${nodeType}${artifactPath ? ` · ${baseName(artifactPath)}` : ""} · v${n}${isLast ? " (current)" : ""}`

	return (
		<>
			<div className="arthead">
				<span className="lab">{label}</span>
				{!video && content != null && kind !== "text" && (
					<span className="seg" role="group" aria-label="View mode">
						<button className={raw ? "" : "on"} onClick={() => setRaw(false)}>{kind === "storyboard" ? "Board" : "Rendered"}</button>
						<button className={raw ? "on" : ""} onClick={() => setRaw(true)}>{kind === "storyboard" ? "JSON" : "Raw"}</button>
					</span>
				)}
			</div>
			{video ? (
				<>
					<video className="vinline" controls preload="metadata" src={videoUrlByVersion(versionId)} />
					{artifactPath && <p className="note">{baseName(artifactPath)}</p>}
				</>
			) : loading ? (
				<p className="muted">Loading artifact…</p>
			) : missing ? (
				<p className="note">No inline content yet — <code>{baseName(missing)}</code> not written.</p>
			) : content == null ? (
				<p className="muted">—</p>
			) : raw || kind === "text" ? (
				<pre className="raw">{content}</pre>
			) : kind === "markdown" ? (
				<div className="md"><Markdown source={content} /></div>
			) : kind === "script" ? (
				<ScriptView content={content} />
			) : kind === "storyboard" ? (
				<StoryboardBoard content={content} />
			) : (
				<pre className="raw">{content}</pre>
			)}
		</>
	)
}

// Script: the spoken VO, one line per beat, numbered, with a rough word count.
function ScriptView({ content }: { content: string }) {
	const lines = content.split("\n").map((l) => l.trim()).filter(Boolean)
	const words = lines.join(" ").split(/\s+/).filter(Boolean).length
	return (
		<>
			<div className="vo-list">
				{lines.map((l, i) => (
					<div key={i} className="vo-line"><span className="n">{i + 1}</span><span>{l}</span></div>
				))}
			</div>
			<div className="meter"><span>Words <b>{words}</b></span><span>Lines <b>{lines.length}</b></span></div>
		</>
	)
}

// Storyboard: the word-anchored film.json shown as a visual beat board — theme swatches, voice, and
// one card per beat. Falls back to raw JSON if the shape is unexpected.
function StoryboardBoard({ content }: { content: string }) {
	let data: Record<string, unknown>
	try {
		data = JSON.parse(content) as Record<string, unknown>
	} catch {
		return <pre className="raw">{content}</pre>
	}
	const theme = (data.theme ?? {}) as Record<string, string>
	const voice = (data.voice ?? {}) as Record<string, unknown>
	const size = data.size as [number, number] | undefined
	const beatsRaw = (Array.isArray(data.beats) ? data.beats : Array.isArray(data.scenes) ? data.scenes : Array.isArray(data.script) ? data.script : []) as unknown[]
	const beats = beatsRaw.map((b) => (typeof b === "string" ? { vo: b } : (b as Record<string, unknown>)))
	return (
		<>
			<div className="sb-theme">
				{size && <span>{size[0]}×{size[1]}</span>}
				{voice.id != null && <span>voice <span className="tag">{String(voice.id)}</span>{voice.speed != null ? ` speed ${String(voice.speed)}` : ""}</span>}
				{Object.keys(theme).length > 0 && (
					<span className="swatches">
						{Object.entries(theme).map(([k, v]) => (
							<span key={k} className="sw" style={{ background: v }} title={`${k} ${v}`} />
						))}
					</span>
				)}
			</div>
			<div className="beats">
				{beats.length === 0 && <pre className="raw">{content}</pre>}
				{beats.map((b, i) => (
					<div key={i} className="beat">
						<span className="t">beat {i + 1}</span>
						<div>
							{(b.beat != null || b.label != null || b.time != null) && (
								<div className="bn">{String(b.label ?? b.beat ?? "")}{b.time != null ? <span className="tag">{String(b.time)}</span> : null}</div>
							)}
							{(b.vo ?? b.line ?? b.text) != null && <div className="vo">{String(b.vo ?? b.line ?? b.text)}</div>}
							{(b.capture ?? b.onscreen) != null && <div className="cap">{String(b.capture ?? b.onscreen)}</div>}
						</div>
					</div>
				))}
			</div>
		</>
	)
}

// One reviewer verdict, flat (no accordion): label + verdict chip. For a revise, the feedback shows
// inline (that is the actionable part); the full reviewer run — telemetry + raw output — is behind the
// run-details modal, so there is nothing left to expand.
function ReviewCard({ review, interaction }: { review: Review; interaction?: Interaction }) {
	const detail = review.verdict === "revise" ? stripVerdict(review.body) : null
	const [open, setOpen] = useState(false)
	// Only a review with feedback to read is collapsible; a pass is just the one-line head.
	const collapsible = detail != null
	const toggle = () => collapsible && setOpen((o) => !o)
	return (
		<div className={`verdict flat ${collapsible ? "collapsible" : ""} ${open ? "open" : ""}`}>
			<div
				className={`vd-head ${collapsible ? "clickable" : ""}`}
				onClick={toggle}
				role={collapsible ? "button" : undefined}
				tabIndex={collapsible ? 0 : undefined}
				onKeyDown={collapsible ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle()) : undefined}
			>
				<span className="vd-label">{reviewLabel(review)}</span>
				<span className="vd-right">
					{interaction && <RunButton interaction={interaction} title={`${reviewLabel(review)} · reviewer`} output={review.body} />}
					<VerdictChip verdict={review.verdict} />
					{collapsible && <Chevron small />}
				</span>
			</div>
			{detail && (
				<div className="vd-foot">
					<p className="vd-text">{detail}</p>
				</div>
			)}
		</div>
	)
}

// Strip a leading "VERDICT: pass|revise" line so only the reviewer's actual reasoning remains.
function stripVerdict(body: string | null): string | null {
	if (!body) return null
	const s = body.replace(/^\s*VERDICT:\s*(pass|revise)\s*[-–.:]?\s*/i, "").trim()
	return s || null
}

// The review axis as a human label: "Quality review", "Conformance review". Falls back to the
// reviewer's own name (or kind) title-cased if it is something else.
function reviewLabel(review: Review): string {
	const base = (review.name || review.kind || "review").trim()
	return /review$/i.test(base) ? titleCase(base) : `${titleCase(base)} review`
}

// The run detail is noise in the timeline, so it is collapsed to a small button: model + duration.
// Click opens a modal with the full telemetry spelled out, plus the prompt and output. `versionId`
// (producer) lazy-loads the artifact as the output; `output` (reviewer) passes the verdict text in.
function RunButton({ interaction, title, versionId, output }: { interaction: Interaction; title: string; versionId?: string; output?: string | null }) {
	const [open, setOpen] = useState(false)
	return (
		<>
			<button className="run-btn" onClick={(e) => { e.stopPropagation(); setOpen(true) }} title="Show the subagent run">
				<EngineMark engine={interaction.engine} />
				<span>{interaction.model ?? interaction.engine}</span>
				{interaction.durationMs != null && <span className="muted">· {fmtDur(interaction.durationMs)}</span>}
				<span className="muted">· run details</span>
			</button>
			{open && <RunModal interaction={interaction} title={title} versionId={versionId} output={output} onClose={() => setOpen(false)} />}
		</>
	)
}

// Which engine produced the run. A Claude run gets the Claude burst mark; anything else (the fake
// runner, or a future engine) gets a neutral dot.
function EngineMark({ engine }: { engine: string }) {
	if (/claude/i.test(engine)) return <ClaudeMark />
	return <span className="run-dot" />
}

// The Claude "burst" mark — rounded spokes radiating from the centre, in Anthropic's clay orange.
// Drawn inline so it needs no asset and inherits crisp rendering at small sizes.
function ClaudeMark({ size = 13 }: { size?: number }) {
	const spokes = 12
	const lines = Array.from({ length: spokes }, (_, i) => {
		const a = (Math.PI * 2 * i) / spokes
		const inner = 1.6
		const outer = i % 3 === 0 ? 10 : 7.5
		return (
			<line
				key={i}
				x1={12 + Math.cos(a) * inner}
				y1={12 + Math.sin(a) * inner}
				x2={12 + Math.cos(a) * outer}
				y2={12 + Math.sin(a) * outer}
			/>
		)
	})
	return (
		<svg className="claude-mark" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#d97757" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
			{lines}
		</svg>
	)
}

// Modal for one subagent run: telemetry at the top, then prompt + output. Prompt is not persisted by
// the engine yet, so that section shows an empty state until it is.
function RunModal({ interaction, title, versionId, output, onClose }: { interaction: Interaction; title: string; versionId?: string; output?: string | null; onClose: () => void }) {
	const [body, setBody] = useState<string | null>(output ?? null)
	const [loading, setLoading] = useState(versionId != null && output == null)

	useEffect(() => {
		if (versionId == null || output != null) return
		let alive = true
		void getDeliverable(versionId)
			.then((d) => alive && setBody(d.content ?? null))
			.catch(() => alive && setBody(null))
			.finally(() => alive && setLoading(false))
		return () => {
			alive = false
		}
	}, [versionId, output])

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [onClose])

	return (
		<div className="modal-backdrop" onClick={onClose}>
			<div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
				<div className="modal-head">
					<h3>{title}</h3>
					<button className="modal-x" onClick={onClose} aria-label="Close">×</button>
				</div>
				<TelemGrid it={interaction} />
				<div className="modal-body">
					<div className="sub-h">Prompt</div>
					{interaction.prompt ? <pre className="raw">{interaction.prompt}</pre> : <p className="muted run-empty">Not recorded — this run predates prompt capture.</p>}
					<div className="sub-h">Output</div>
					{loading ? <p className="muted">Loading…</p> : body ? <pre className="raw">{body}</pre> : <p className="muted">—</p>}
				</div>
			</div>
		</div>
	)
}

// One subagent run's telemetry as a labelled grid — every field spelled out (no →, no /).
function TelemGrid({ it }: { it: Interaction }) {
	const rows: [string, string][] = [["model", it.model ?? it.engine]]
	if (it.sessionId) rows.push(["session", shortId(it.sessionId)])
	rows.push(["input tokens", fmtNum(it.inputTokens)])
	rows.push(["output tokens", fmtNum(it.outputTokens)])
	if (it.cacheReadTokens != null) rows.push(["cache read", fmtNum(it.cacheReadTokens)])
	if (it.cacheCreationTokens != null) rows.push(["cache write", fmtNum(it.cacheCreationTokens)])
	if (it.costUsd != null) rows.push(["cost", `$${it.costUsd.toFixed(4)}`])
	if (it.durationMs != null) rows.push(["duration", fmtDur(it.durationMs)])
	return (
		<dl className="telem-grid">
			{rows.map(([k, v]) => (
				<div key={k}>
					<dt>{k}</dt>
					<dd>{v}</dd>
				</div>
			))}
		</dl>
	)
}

function UsageStrip({ usage }: { usage: UsageSummary }) {
	return (
		<div className="usage">
			<Stat label="interactions" value={String(usage.interactions)} />
			<Stat label="sessions" value={String(usage.sessions.length)} />
			<Stat label="tokens in" value={fmtNum(usage.inputTokens)} />
			<Stat label="tokens out" value={fmtNum(usage.outputTokens)} />
			<Stat label="cache read" value={fmtNum(usage.cacheReadTokens)} />
			<Stat label="cost" value={`$${usage.costUsd.toFixed(2)}`} />
			<Stat label="duration" value={fmtDur(usage.durationMs)} />
		</div>
	)
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="stat">
			<div className="sv">{value}</div>
			<div className="sl">{label}</div>
		</div>
	)
}

// The Videos tab: every produced .mp4 on disk, grouped by folder, each with an inline player.
function Gallery({ videos }: { videos: VideoFile[] }) {
	if (videos.length === 0) return <p className="muted pad">No videos produced yet.</p>
	const groups = new Map<string, VideoFile[]>()
	for (const v of videos) {
		const key = v.dir || "(root)"
		const list = groups.get(key) ?? []
		list.push(v)
		groups.set(key, list)
	}
	return (
		<div className="gallery">
			{[...groups.entries()].map(([dir, vids]) => (
				<div key={dir} className="vgroup">
					<h3 className="vgroup-h"><code>{dir}</code> <span className="muted">{vids.length}</span></h3>
					<div className="vgrid">
						{vids.map((v) => (
							<figure key={v.path} className="vcard">
								<video controls preload="metadata" src={videoUrlByPath(v.path)} />
								<figcaption>
									<span className="vname">{v.name}</span>
									<span className="muted">{fmtBytes(v.sizeBytes)} · {fmtTime(new Date(v.mtimeMs).toISOString())}</span>
								</figcaption>
							</figure>
						))}
					</div>
				</div>
			))}
		</div>
	)
}

function Gate({ inbox, productionId, budget, onAction }: { inbox: ChatOutput[]; productionId: string; budget: ProductionDetail["budget"]; onAction: () => void }) {
	const act = async (fn: () => Promise<void>) => {
		await fn()
		onAction()
	}
	if (inbox.length === 0 && !(budget && !budget.approved)) return null
	return (
		<div className="gate">
			<div className="gate-head">Inbox <span className="badge">{inbox.length}</span></div>
			{inbox.map((o) => (
				<div key={o.id} className="out">
					<div><code>{o.type}</code> {o.prompt && <span>{o.prompt}</span>}</div>
					{o.type === "present" ? (
						<div className="controls">
							<button onClick={() => void act(() => approveOutput(o.id))}>Approve</button>
							<button className="secondary" onClick={() => {
								const body = window.prompt("Feedback for a redo:")
								if (body) void act(() => sendFeedback(o.id, body))
							}}>Feedback</button>
						</div>
					) : (
						<div className="controls"><button onClick={() => void act(() => approveOutput(o.id))}>Ack</button></div>
					)}
				</div>
			))}
			{budget && !budget.approved && (
				<div className="out">
					<div><code>budget</code> render spend not yet approved</div>
					<div className="controls"><button onClick={() => void act(() => approveBudget(productionId))}>Approve budget</button></div>
				</div>
			)}
		</div>
	)
}

// ---- chips, icons, helpers ----

function StatusChip({ status }: { status: string }) {
	return <span className={`chip ${chipVariant(status)}`}><span className="g" />{status}</span>
}

function VerdictChip({ verdict }: { verdict: string }) {
	const v = verdict === "pass" ? "ok" : verdict === "revise" ? "danger" : "muted"
	return <span className={`chip ${v}`}>{verdict}</span>
}

function chipVariant(status: string): string {
	switch (status) {
		case "approved":
		case "done":
		case "pass":
			return "ok"
		case "denied":
		case "escalated":
		case "revise":
		case "failed":
			return "danger"
		case "in-progress":
		case "producing":
		case "queued-running":
			return "info"
		case "review":
		case "needs-work":
		case "presentable":
			return "warn"
		default:
			return "muted"
	}
}

function needsAttention(status: string): boolean {
	return ["in-progress", "producing", "review", "needs-work", "presentable", "escalated", "denied"].includes(status)
}

function artifactKind(nodeType: string, path: string | null): "video" | "markdown" | "script" | "storyboard" | "text" {
	if (isVideoPath(path)) return "video"
	const t = nodeType.toLowerCase()
	const ext = path ? path.split(".").pop()?.toLowerCase() : null
	if (t.includes("storyboard") || ext === "json") return "storyboard"
	if (t.includes("script")) return "script"
	if (ext === "md" || ext === "markdown" || ["briefing", "moodboard", "brief", "review", "polish", "coverage", "craft"].some((k) => t.includes(k))) return "markdown"
	return "text"
}

function StageIcon({ type }: { type: string }) {
	const t = type.toLowerCase()
	const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
	if (t.includes("render") || t.includes("video") || t.includes("film"))
		return <svg {...common}><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
	if (t.includes("storyboard"))
		return <svg {...common}><rect x="2" y="4" width="14" height="12" rx="2" /><path d="M16 8l6-3v12l-6-3" /></svg>
	if (t.includes("mood"))
		return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
	if (t.includes("script"))
		return <svg {...common}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
	if (t.includes("polish"))
		return <svg {...common}><path d="M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8L12 14.6 7 18.2l1.9-5.8L4 8.8h6.1z" /></svg>
	return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></svg>
}

function Chevron({ small }: { small?: boolean }) {
	const s = small ? 14 : 16
	return <svg className="chev" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 6l6 6-6 6" /></svg>
}

function ArrowDown() {
	return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
}

function Loop() {
	return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
}

function previewOf(nv: NodeView, latest?: { version: Version; reviews: Review[] }): string {
	if (!latest) return "Nothing produced yet."
	const n = nv.versions.length
	const lead = n > 1 ? `v${latest.version.n} of ${n}` : `v${latest.version.n}`
	if (latest.version.artifactPath && isVideoPath(latest.version.artifactPath)) return `${lead} · ${baseName(latest.version.artifactPath)}`
	return lead
}

function titleCase(s: string): string {
	return s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function baseName(p: string): string {
	const parts = p.split("/")
	// Keep the last two segments (e.g. "render-v3/film.mp4") — but drop a parent that is just the
	// production's nd_ id, which is noise in a caption, leaving only the filename.
	const parent = parts[parts.length - 2]
	if (parent && /^nd_[0-9a-f]+$/i.test(parent)) return parts[parts.length - 1] ?? p
	return parts.slice(-2).join("/")
}

function fmtTime(iso: string | null | undefined): string {
	if (!iso) return ""
	const d = new Date(iso)
	return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString()
}

function fmtDur(ms: number | null): string {
	if (ms == null) return ""
	if (ms < 1000) return `${ms}ms`
	const s = ms / 1000
	if (s < 60) return `${s.toFixed(1)}s`
	const total = Math.round(s)
	const h = Math.floor(total / 3600)
	const m = Math.floor((total % 3600) / 60)
	const sec = total % 60
	return h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`
}

function fmtNum(n: number | null): string {
	return n == null ? "—" : n.toLocaleString()
}

function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
	return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function shortId(id: string): string {
	return id.length > 10 ? `…${id.slice(-8)}` : id
}

function childrenOf(detail: ProductionDetail, id: string): NodeView[] {
	return detail.nodes.filter((n) => n.node.parentId === id)
}

// The one video to show at the top: the finished cut. Prefer an approved render; among candidates,
// render nodes win, then the most recent, then the highest version. Null when no video exists yet.
function finalVideoOf(detail: ProductionDetail): { versionId: string; n: number; nodeType: string; status: string } | null {
	type Cand = { versionId: string; n: number; nodeType: string; status: string; created: string; render: boolean }
	const cands: Cand[] = []
	for (const nv of detail.nodes) {
		for (const vw of nv.versions) {
			const v = vw.version
			if (v.artifactPath && isVideoPath(v.artifactPath)) {
				cands.push({
					versionId: v.id,
					n: v.n,
					nodeType: nv.node.type,
					status: v.status,
					created: v.createdAt ?? "",
					render: nv.node.type.toLowerCase().includes("render") || nv.node.type.toLowerCase().includes("film"),
				})
			}
		}
	}
	if (cands.length === 0) return null
	const approved = cands.filter((c) => c.status === "approved")
	const pool = approved.length > 0 ? approved : cands
	pool.sort((a, b) => {
		if (a.render !== b.render) return a.render ? -1 : 1
		if (a.created !== b.created) return a.created < b.created ? 1 : -1
		return b.n - a.n
	})
	const top = pool[0]
	return top ? { versionId: top.versionId, n: top.n, nodeType: top.nodeType, status: top.status } : null
}
