// The dashboard UI. Left: productions. Right: the selected production rendered as a column of big
// stage cards (briefing, script, moodboard, storyboard, render, …). Each card expands to a revision
// timeline: every version with the artifact rendered in its proper form, the feedback that version
// received, and the producer/reviewer run behind it (model, session, tokens, cost, duration). It
// refetches on every WebSocket nudge, so the view tracks the worker in real time.

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
	approveBudget,
	approveOutput,
	boardUrlByVersion,
	emitsBoard,
	fetchMediaText,
	getDeliverable,
	getProduction,
	getProductions,
	getVideos,
	isVideoPath,
	listNodeMedia,
	type MediaFile,
	mediaDirsForNodeType,
	mediaUrlByPath,
	videoUrlByPath,
	videoUrlByVersion,
	type ChatOutput,
	type Interaction,
	type Node as EngineNode,
	type NodeView,
	type ProductionDetail,
	type ProductionListItem,
	type Review,
	sendFeedback,
	type UsageSummary,
	type Version,
	type VideoFile,
} from "./api.js"
import { Markdown } from "./markdown.js"
import { fileViewKind, isBoardShape, isCard, isFilm, pairVoiceClips, parseJsonLoose, prettyJson, splitScriptLines, type VoicePair } from "./media-view.js"
import { type FileRef, nodeFileIO } from "./node-io.js"
import { subtreeUsage } from "./rollup.js"
import { siblingIndex, stepPhase } from "./step-phase.js"
import { stepDescription } from "./step-info.js"
import { useLive } from "./useLive.js"

type Tab = "productions" | "videos"

export function App() {
	const [tab, setTab] = useState<Tab>("productions")
	const [productions, setProductions] = useState<ProductionListItem[]>([])
	// The selected production lives in the URL (?p=<id>) so a view is shareable and survives reload.
	const [selectedId, setSelectedId] = useState<string | null>(() => productionIdFromUrl())
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

	// Set the selection and reflect it in the URL (and vice versa on back/forward).
	const selectProduction = (id: string | null) => {
		setSelectedId(id)
		const url = new URL(location.href)
		if (id) url.searchParams.set("p", id)
		else url.searchParams.delete("p")
		history.pushState({ p: id }, "", url)
	}

	useEffect(() => {
		const onPop = () => setSelectedId(productionIdFromUrl())
		window.addEventListener("popstate", onPop)
		return () => window.removeEventListener("popstate", onPop)
	}, [])

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
							<button key={p.id} className={`prod ${p.id === selectedId ? "sel" : ""} ${isActive(p.status) ? "active" : ""} ${isPending(p.status) ? "pending" : ""}`} onClick={() => selectProduction(p.id)}>
								<div className="ptitle">{p.name}</div>
								<div className="pmeta">
									{p.awaitingFeedback ? <StatusChip status="awaiting feedback" /> : <StatusChip status={p.status} />}
									{isActive(p.status) && !p.awaitingFeedback && <Spinner label="running" />}
									<span className="muted">{fmtTime(p.createdAt)}</span>
								</div>
							</button>
						))}
					</aside>
					<main className="detail">
						{!detail && <p className="muted pad">Select a production.</p>}
						{detail && <Detail detail={detail} videos={videos} onAction={() => selectedId && refreshDetail(selectedId)} />}
					</main>
				</div>
			)}
		</div>
	)
}

// The production's full id, shown plainly and copied on click (with brief confirmation).
function ProdId({ id }: { id: string }) {
	const [copied, setCopied] = useState(false)
	const copy = () => {
		void navigator.clipboard?.writeText(id).then(
			() => {
				setCopied(true)
				setTimeout(() => setCopied(false), 1200)
			},
			() => {},
		)
	}
	return (
		<button className="prodid" onClick={copy} title="Copy id">
			<span className="prodid-k">ID</span>
			<span className="prodid-v">{id}</span>
			<span className="prodid-copy">{copied ? "copied" : "copy"}</span>
		</button>
	)
}

function productionIdFromUrl(): string | null {
	try {
		return new URLSearchParams(location.search).get("p")
	} catch {
		return null
	}
}

function Detail({ detail, videos, onAction }: { detail: ProductionDetail; videos: VideoFile[]; onAction: () => void }) {
	const stages = childrenOf(detail, detail.root.id)
	const fv = finalVideoOf(detail)
	const head = (
		<>
			<h2>{detail.root.name} {awaitingFeedback(detail) ? <StatusChip status="awaiting feedback" /> : <><StatusChip status={detail.root.status} />{isActive(detail.root.status) && <Spinner label="production running" />}</>}</h2>
			<div className="hmeta muted">
				<span>started {fmtTime(detail.root.createdAt)}</span>
				<span>· {detail.root.autonomyLever ?? "—"}</span>
				<span>· {detail.root.actorKind ?? "—"}</span>
			</div>
			<ProdId id={detail.root.id} />
		</>
	)
	return (
		<>
			{fv ? (
				<section className="hero">
					<div className="hero-info">{head}</div>
					<div className="hero-media">
						<video className="hero-video" controls preload="metadata" src={videoUrlByVersion(fv.versionId)} />
						<span className="hero-cap">Final cut · {titleCase(fv.nodeType)} v{fv.n} · {fv.status}{detail.root.status === "approved" ? "" : detail.root.status === "cancelled" ? " (production cancelled)" : awaitingFeedback(detail) ? " (awaiting your feedback)" : " (production still running)"}</span>
					</div>
				</section>
			) : (
				<div className="phead">{head}</div>
			)}
			<div className="phead">
				<UsageStrip usage={detail.usage} />
			</div>
			<Gate inbox={detail.inbox} productionId={detail.root.id} budget={detail.budget} onAction={onAction} cancelled={detail.root.status === "cancelled"} />
			<div className="stages">
				{stages.length === 0 && <p className="muted pad">No stages yet — the worker hasn't expanded this production.</p>}
				{stages.map((nv) => (
					<StageCard key={nv.node.id} nv={nv} detail={detail} videos={videos} />
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

// The info affordance on a step card: a small ⓘ that reveals the step's FIXED description (what this
// kind of step does, from the type registry) on hover or click. It's a span, not a button — it lives
// inside the card's header button, so it stops propagation to avoid toggling the card. Hidden for a
// type with no description.
function StepInfo({ nodeType }: { nodeType: string }) {
	const desc = stepDescription(nodeType)
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
	const icoRef = useRef<HTMLSpanElement>(null)
	if (!desc) return null
	// Position the popover under the icon with fixed coords, then portal it to <body>. The step card has
	// `overflow: hidden` (rounded corners), which would clip an in-card absolutely-positioned popover —
	// especially when the card is collapsed and the popover sits below the header. A body portal escapes it.
	const reveal = () => {
		const r = icoRef.current?.getBoundingClientRect()
		if (!r) return
		const left = Math.min(r.left, window.innerWidth - 360) // keep it inside the viewport's right edge
		setPos({ top: r.bottom + 6, left: Math.max(8, left) })
	}
	const hide = () => setPos(null)
	const toggle = (e: { stopPropagation: () => void }) => {
		e.stopPropagation()
		pos ? hide() : reveal()
	}
	return (
		<span className="step-info" onMouseEnter={reveal} onMouseLeave={hide}>
			<span ref={icoRef} className="step-info-ico" role="button" tabIndex={0} aria-label="What this step does" onClick={toggle} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggle(e)}>
				ⓘ
			</span>
			{pos && createPortal(<span className="step-info-pop" role="tooltip" style={{ top: pos.top, left: pos.left }}>{desc}</span>, document.body)}
		</span>
	)
}

// One major pipeline step as a big card. Collapsed = name + status + latest version + a preview.
// Expanded = the revision timeline, plus any child nodes nested as their own stage cards.
function StageCard({ nv, detail, videos, depth = 0 }: { nv: NodeView; detail: ProductionDetail; videos: VideoFile[]; depth?: number }) {
	const [open, setOpen] = useState(() => needsAttention(nv.node.status))
	const kids = [...childrenOf(detail, nv.node.id)].sort((a, b) => a.node.position - b.node.position)
	const versions = [...nv.versions].sort((a, b) => a.version.n - b.version.n)
	const latest = versions[versions.length - 1]

	// Number a node within a fanned-out set of the same type (Card 1 … Card N). For a leaf, derive the
	// *real* live phase (producing / reviewing / queued / waiting) instead of the coarse node.status, which
	// reads "in-progress" for every fanned leaf whether a worker holds it or it's just waiting in the queue.
	const siblings = childrenOf(detail, nv.node.parentId ?? "").map((s) => ({ id: s.node.id, type: s.node.type, position: s.node.position }))
	const idx = siblingIndex(nv.node.id, siblings)
	const label = idx ? `${titleCase(nv.node.type)} ${idx}` : titleCase(nv.node.type)
	const slug = nv.node.name !== nv.node.type ? nv.node.name : null
	const isLeaf = kids.length === 0
	const phase = isLeaf ? stepPhase(nv) : null
	const chipStatus = phase ?? nv.node.status
	// Visual weight follows the derived phase, not the raw node.status — otherwise a leaf parked back to
	// `pending` between redo rounds reads as dimmed "not started" while its chip says "revising". Dim only
	// what truly isn't moving (queued / waiting); accent what a worker holds (producing); leave the rest
	// (reviewing / revising / approved) at full strength.
	const activeEdge = phase ? phase === "producing" : isActive(nv.node.status)
	const dim = phase ? phase === "queued" || phase === "waiting" : isPending(nv.node.status)
	const spinning = phase ? phase === "producing" : isActive(nv.node.status)

	return (
		<section className={`stage ${open ? "open" : ""} ${depth > 0 ? "nested" : ""} ${activeEdge ? "active" : ""} ${dim ? "pending" : ""}`}>
			<button className="stage-head" onClick={() => setOpen((o) => !o)}>
				<span className="stage-ico" aria-hidden="true"><StageIcon type={nv.node.type} /></span>
				<span className="stage-main">
					<span className="stage-name">
						{label}
						{slug && <span className="stage-slug">{slug}</span>}
						<StepInfo nodeType={nv.node.type} />
						<StatusChip status={chipStatus} />
						{spinning && <Spinner label={`${label} ${phase ?? "running"}`} />}
					</span>
					<span className="stage-prev">{stageMeta(nv, latest, videos, detail)}</span>
				</span>
				<span className="stage-right">
					<Chevron />
				</span>
			</button>
			<div className="stage-body">
				{/* Input at the top — it's how you read a step: what it takes in (its upstream deps + the board
				    files it reads, or the original request for the intake step). The dep chips ARE the
				    step-to-step dependency; each opens the upstream it builds on. Output sits at the bottom. */}
				<NodeIO nv={nv} detail={detail} side="input" />
				{/* An expand node (e.g. build) has no artifact of its own — don't claim "nothing produced"
				    when it fanned into the sub-steps shown below; only a truly empty node gets that line. */}
				{versions.length === 0 && kids.length === 0 && <p className="muted">Nothing produced yet.</p>}
				{versions.length === 0 && kids.length > 0 && <p className="muted">No artifact of its own — expands into the sub-steps below.</p>}
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
				{/* The produced media, experienced: build-voice pairs each clip with the line it reads;
				    other build nodes get audio players / an image gallery. */}
				{nv.node.type === "build-voice" ? (
					<VoiceMedia productionId={detail.root.id} />
				) : (
					<NodeMedia productionId={detail.root.id} nodeType={nv.node.type} />
				)}
				{/* Output at the bottom — this step's own deliverable + the files it writes. */}
				<NodeIO nv={nv} detail={detail} side="output" />
				{kids.length > 0 && (
					<>
						<div className="sub-h">Sub-steps</div>
						<div className="stages nested-stages">
							{kids.map((k) => (
								<StageCard key={k.node.id} nv={k} detail={detail} videos={videos} depth={depth + 1} />
							))}
						</div>
					</>
				)}
			</div>
		</section>
	)
}

// Who approved this version, shown on an approved version row only when it's recorded: a human via the
// gate, or the engine auto-approving on high autonomy (agent), or the engine forcing it past unresolved
// review (agent-escalated). Rendered only when `by` is set (pre-tracking rows just show the status chip).
function ApprovedBadge({ by, at }: { by: "human" | "agent" | "agent-escalated"; at: string | null }) {
	const label = by === "human" ? "approved by a human" : by === "agent" ? "auto-approved by the engine" : "force-approved by the engine"
	const title = at ? `${label} · ${new Date(at).toLocaleString()}` : label
	return (
		<span className={`approved-by ${by}`} title={title}>
			{by === "human" ? "👤" : "🤖"} {label}
			{at && <span className="muted"> · {fmtTime(at)}</span>}
		</span>
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
	const active = isActive(version.status)
	return (
		<div className={`rev ${isLast ? "cur" : ""} ${revStatus && !isLast ? "fail" : ""} ${active ? "active" : ""}`}>
			<div className="rev-mark"><span className="rev-dot">v{version.n}</span><span className="rev-line" /></div>
			<div className="rev-content">
				<div className="rev-top">
					<StatusChip status={version.status} />
					{active && <Spinner label={`producing v${version.n}`} />}
					<span className="rev-time">{fmtTime(version.createdAt)}</span>
					{version.status === "approved" && version.approvedBy && <ApprovedBadge by={version.approvedBy} at={version.approvedAt} />}
					{producer && <RunButton interaction={producer} title={`${titleCase(nodeType)} · producer · v${version.n}`} versionId={version.id} />}
				</div>
				<div className="rev-art">
					{emitsBoard(nodeType) && <BoardImage versionId={version.id} />}
					<ArtifactView versionId={version.id} artifactPath={version.artifactPath} nodeType={nodeType} n={version.n} isLast={isLast} />
				</div>
				{version.feedback && <div className="feeds note-feedback"><b>Sent back:</b> {version.feedback}</div>}
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
				{/* A revise on the last version only drives a v2 if the version is still OPEN. If it's already
				    approved (e.g. an advisory reviewer on an agreement step, or a forced approval), no v2
				    runs — say that instead of promising a redo that will never happen. */}
				{isLast &&
					reviews.some((r) => r.verdict === "revise") &&
					(version.status === "approved" ? (
						<div className="feeds">
							<span>A reviewer suggested changes, but this step was approved anyway (advisory / forced) — no revision will run.</span>
						</div>
					) : (
						<div className="feeds">
							<Loop />
							<span>Open feedback — a <b>v{version.n + 1}</b> run will address it next.</span>
						</div>
					))}
			</div>
		</div>
	)
}

// The media a node actually produced, surfaced so you can hear/see it in place: audio players for
// build-voice / build-soundtrack, a thumbnail gallery for build-assets. Which dirs hold a node type's
// media is a craft convention (mediaDirsForNodeType); this fetches them lazily and renders nothing when
// a node type has no media or none was written. An image opens full-size in a new tab on click.
function NodeMedia({ productionId, nodeType }: { productionId: string; nodeType: string }) {
	const specs = mediaDirsForNodeType(nodeType)
	const [files, setFiles] = useState<MediaFile[]>([])
	const [imgPage, setImgPage] = useState(0)
	const IMG_PAGE_SIZE = 12
	useEffect(() => {
		if (specs.length === 0) return
		let alive = true
		void Promise.all(specs.map((s) => listNodeMedia(productionId, s.dir, s.kinds).catch(() => [] as MediaFile[])))
			.then((lists) => {
				if (!alive) return
				// de-dupe by path (a dir can be listed by more than one spec)
				const seen = new Set<string>()
				const merged: MediaFile[] = []
				for (const f of lists.flat()) {
					if (!seen.has(f.path)) {
						seen.add(f.path)
						merged.push(f)
					}
				}
				setFiles(merged)
			})
		return () => {
			alive = false
		}
	}, [productionId, nodeType, specs.length])

	if (specs.length === 0 || files.length === 0) return null
	const audio = files.filter((f) => f.kind === "audio")
	const images = files.filter((f) => f.kind === "image")
	const label = specs.map((s) => s.label).join(" · ")
	return (
		<div className="node-media">
			<div className="sub-h">{label} — produced files <span className="muted">{files.length}</span></div>
			{audio.length > 0 && (
				<ul className="audio-list">
					{audio.map((f) => (
						<li key={f.path} className="audio-row">
							<span className="audio-name">{f.name}</span>
							<audio controls preload="none" src={mediaUrlByPath(f.path)} />
							<span className="muted">{fmtBytes(f.sizeBytes)}</span>
						</li>
					))}
				</ul>
			)}
			{images.length > 0 && (() => {
				// Paginate the grid: a build-assets node can hold dozens of images and the full grid takes
				// over the card. Show one page at a time with a pager; clamp the page if the list shrank.
				const pageCount = Math.ceil(images.length / IMG_PAGE_SIZE)
				const page = Math.min(imgPage, pageCount - 1)
				const start = page * IMG_PAGE_SIZE
				const shown = images.slice(start, start + IMG_PAGE_SIZE)
				return (
					<>
						<div className="asset-grid">
							{shown.map((f) => (
								<a key={f.path} className="asset-thumb" href={mediaUrlByPath(f.path)} target="_blank" rel="noreferrer" title={`${f.name} · ${fmtBytes(f.sizeBytes)}`}>
									<img src={mediaUrlByPath(f.path)} alt={f.name} loading="lazy" />
									<span className="asset-name">{f.name}</span>
								</a>
							))}
						</div>
						{pageCount > 1 && (
							<div className="asset-pager">
								<button type="button" disabled={page <= 0} onClick={() => setImgPage(page - 1)}>‹ Prev</button>
								<span className="muted">{start + 1}–{start + shown.length} of {images.length}</span>
								<button type="button" disabled={page >= pageCount - 1} onClick={() => setImgPage(page + 1)}>Next ›</button>
							</div>
						)}
					</>
				)
			})()}
		</div>
	)
}

// build-voice stitches per-scene clips (board/media/vo/piper/sNN.wav), one per script line, into the
// single narration. Instead of a flat list of anonymous clips, show each small clip beside the small
// line it reads (script line N ↔ scene N). The source files it reads/writes live in the Input/Output
// panel above (NodeIO); this is the produced voice, auditioned line by line.
function VoiceMedia({ productionId }: { productionId: string }) {
	const [pairs, setPairs] = useState<VoicePair[]>([])

	useEffect(() => {
		let alive = true
		const clipsP = listNodeMedia(productionId, "board/media/vo", ["audio"]).catch(() => [] as MediaFile[])
		const scriptP = fetchMediaText(`${productionId}/board/script.txt`)
			.then(splitScriptLines)
			.catch(() => [] as string[])
		void Promise.all([scriptP, clipsP]).then(([lines, clips]) => {
			if (!alive) return
			setPairs(pairVoiceClips(lines, clips.map((c) => ({ name: c.name, path: c.path }))))
		})
		return () => {
			alive = false
		}
	}, [productionId])

	if (pairs.length === 0) return null
	return (
		<div className="node-media">
			<div className="sub-h">Script &amp; voice — line by line <span className="muted">{pairs.length}</span></div>
			<ol className="vo-lines">
				{pairs.map((p) => (
					<li key={p.n} className="vo-line">
						<span className="vo-n">{p.n}</span>
						<span className="vo-text">{p.text || <em className="muted">(no line)</em>}</span>
						{p.clip ? <audio controls preload="none" src={mediaUrlByPath(p.clip.path)} /> : <span className="muted vo-missing">no clip</span>}
					</li>
				))}
			</ol>
		</div>
	)
}

// One side of the Input / Output panel for a node, so Input can sit at the top of the card and Output
// at the bottom — the way a step reads. INPUT = its upstream deps (as the DAG recorded them, each
// opening that dep's deliverable) + the board files it reads off disk; the intake step (briefing) also
// shows the production's original request, its true input. OUTPUT = its own captured deliverable + the
// side files it writes. Renders nothing when that side is empty.
function NodeIO({ nv, detail, side }: { nv: NodeView; detail: ProductionDetail; side: "input" | "output" }) {
	const [open, setOpen] = useState<ViewerTarget | null>(null)
	const io = nodeFileIO(nv.node.type, detail.root.id)

	const fileChip = (f: FileRef) => (
		<button key={f.path} type="button" className="file-chip" onClick={() => setOpen({ name: f.label, path: f.path })}>
			{f.label}
		</button>
	)

	if (side === "input") {
		// Resolve each dep node-id to {label, versionId} — its type + latest version — so the chip opens
		// the upstream's actual deliverable. Unknown/version-less deps are dropped.
		const depRefs = (nv.node.deps ?? [])
			.map((id) => {
				const dn = detail.nodes.find((x) => x.node.id === id)
				const v = dn?.versions[dn.versions.length - 1]?.version
				return dn && v ? { label: titleCase(dn.node.type), versionId: v.id } : null
			})
			.filter((x): x is { label: string; versionId: string } => x != null)
		// The intake step has no upstream node — its input is the request the production was asked with.
		const request = nv.node.type === "briefing" ? requestText(detail.root) : null

		if (depRefs.length === 0 && io.reads.length === 0 && request == null) return null
		return (
			<div className="node-io">
				<div className="io-row">
					<span className="io-label io-in">Input</span>
					<span className="io-chips">
						{request != null && (
							<span className="io-seg">
								<span className="io-seg-l">request</span>
								<button type="button" className="file-chip io-dep" onClick={() => setOpen({ name: "Original request", text: request })}>
									the brief
								</button>
							</span>
						)}
						{/* The dep chips are the step-to-step dependency: the upstream steps this one builds on. */}
						{depRefs.length > 0 && (
							<span className="io-seg">
								<span className="io-seg-l">depends on</span>
								{depRefs.map((d) => (
									<button key={d.versionId} type="button" className="file-chip io-dep" onClick={() => setOpen({ name: d.label, versionId: d.versionId })}>
										{d.label}
									</button>
								))}
							</span>
						)}
						{io.reads.length > 0 && (
							<span className="io-seg">
								<span className="io-seg-l">reads</span>
								{io.reads.map(fileChip)}
							</span>
						)}
					</span>
				</div>
				{open && <FileViewer target={open} onClose={() => setOpen(null)} />}
			</div>
		)
	}

	// side === "output"
	const ownLatest = nv.versions[nv.versions.length - 1]?.version
	if (ownLatest == null && io.writes.length === 0) return null
	return (
		<div className="node-io">
			<div className="io-row">
				<span className="io-label io-out">Output</span>
				<span className="io-chips">
					<span className="io-seg">
						<span className="io-seg-l">produces</span>
						{ownLatest && (
							<button type="button" className="file-chip io-deliver" onClick={() => setOpen({ name: `${titleCase(nv.node.type)} deliverable`, versionId: ownLatest.id })}>
								deliverable
							</button>
						)}
						{io.writes.map(fileChip)}
					</span>
				</span>
			</div>
			{open && <FileViewer target={open} onClose={() => setOpen(null)} />}
		</div>
	)
}

// The production's original request, as the caller asked for it — the brief (root.description) plus any
// intake params. This is the input to the intake step (briefing). Empty string → nothing to show.
function requestText(root: EngineNode): string {
	const brief = (root.description ?? "").trim()
	// Show the intake params too, unless the only key is `brief` (it just duplicates the description).
	const extraKeys = Object.keys(root.params ?? {}).filter((k) => k !== "brief")
	const params = extraKeys.length > 0 ? `\n\n---\nIntake params:\n\n\`\`\`json\n${JSON.stringify(root.params, null, 2)}\n\`\`\`` : ""
	return brief + params
}

// What the viewer modal shows: a produced file by artifacts-root path, a node's deliverable by version
// id (fetched), or inline text already in hand (the request). Deliverable + inline text render as markdown.
type ViewerTarget = { name: string; path: string } | { name: string; versionId: string } | { name: string; text: string }

// A single input/output item opened in a modal. A file path: audio/image/video play inline, json/text
// are fetched and shown as text (JSON re-indented), with an "open raw" link. A version id: the
// deliverable's content, rendered as markdown.
function FileViewer({ target, onClose }: { target: ViewerTarget; onClose: () => void }) {
	const isFile = "path" in target
	const isInline = "text" in target // content already in hand (the request) — no fetch
	const kind = isFile ? fileViewKind(target.name) : "deliverable"
	const needsFetch = isFile ? kind === "json" || kind === "text" : !isInline
	const [text, setText] = useState<string | null>(isInline ? (target as { text: string }).text : null)
	const [err, setErr] = useState<string | null>(null)
	const [loading, setLoading] = useState(needsFetch)
	const [raw, setRaw] = useState(false)

	useEffect(() => {
		if (!needsFetch) return
		let alive = true
		const p = isFile ? fetchMediaText(target.path) : getDeliverable((target as { versionId: string }).versionId).then((d) => d.content ?? "")
		void p
			.then((t) => alive && setText(t))
			.catch(() => alive && setErr("Couldn't load this."))
			.finally(() => alive && setLoading(false))
		return () => {
			alive = false
		}
	}, [isFile, needsFetch, isFile ? target.path : "versionId" in target ? target.versionId : ""])

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [onClose])

	// Pick how to render the text: in its proper visual form, not raw JSON. A film.json → the film view;
	// a storyboard/plan → the beat board; a card → its plate; a deliverable → markdown; other JSON gets
	// pretty-printed. A "Raw" toggle always falls back to the source for the structured views.
	const parsed = text != null ? parseJsonLoose(text) : null
	const view = isFilm(parsed) ? "film" : isCard(parsed) ? "card" : isBoardShape(parsed) ? "board" : !isFile ? "markdown" : kind === "json" ? "json" : "text"
	const structured = view === "film" || view === "card" || view === "board"
	// Everything that isn't a pure media element (audio/image/video file) renders in the text area below.
	const textual = !isFile || (kind !== "audio" && kind !== "image" && kind !== "video")

	const url = isFile ? mediaUrlByPath(target.path) : null
	return (
		<div className="modal-backdrop" onClick={onClose}>
			<div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
				<div className="modal-head">
					<h3>{target.name}</h3>
					{structured && (
						<span className="seg" role="group" aria-label="View mode">
							<button className={raw ? "" : "on"} onClick={() => setRaw(false)}>Rendered</button>
							<button className={raw ? "on" : ""} onClick={() => setRaw(true)}>JSON</button>
						</span>
					)}
					{url && <a className="modal-dl" href={url} target="_blank" rel="noreferrer">open raw ↗</a>}
					<button className="modal-x" onClick={onClose} aria-label="Close">×</button>
				</div>
				<div className="modal-body">
					{isFile && kind === "audio" && url && <audio className="file-audio" controls autoPlay src={url} />}
					{isFile && kind === "image" && url && <img className="file-img" src={url} alt={target.name} />}
					{isFile && kind === "video" && url && <video className="file-video" controls src={url} />}
					{textual &&
						(loading ? (
							<p className="muted">Loading…</p>
						) : err ? (
							<p className="muted">{err}</p>
						) : raw || view === "json" ? (
							<pre className="raw">{prettyJson(text ?? "")}</pre>
						) : view === "film" ? (
							<FilmView content={text ?? ""} />
						) : view === "card" ? (
							<CardPlate content={text ?? ""} />
						) : view === "board" ? (
							<StoryboardBoard content={text ?? ""} />
						) : view === "markdown" ? (
							<div className="md"><Markdown source={text ?? ""} /></div>
						) : (
							<pre className="raw">{text}</pre>
						))}
				</div>
			</div>
		</div>
	)
}

// film.json shown as a readable film rather than raw JSON: a voice/size header, the VO script numbered,
// and the camera cues as a shot list — each shot is a plate framed on the word it fires on, with its
// zoom move. (Plate thumbnails are skipped: the plate HTML references fonts/assets by absolute server
// paths that don't resolve in the browser, so they'd render blank.)
function FilmView({ content }: { content: string }) {
	const parsed = parseJsonLoose(content)
	if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return <pre className="raw">{content}</pre>
	const film = parsed as Record<string, unknown>
	const size = film.size as [number, number] | undefined
	const voice = (film.voice ?? {}) as Record<string, unknown>
	const script = (Array.isArray(film.script) ? film.script : []) as string[]
	const camera = (Array.isArray(film.camera) ? film.camera : []) as Record<string, unknown>[]
	const plates = (film.plates != null && typeof film.plates === "object" ? film.plates : {}) as Record<string, unknown>
	return (
		<div className="film-view">
			<div className="sb-theme">
				{size && <span>{size[0]}×{size[1]}</span>}
				{voice.id != null && (
					<span>voice <span className="tag">{String(voice.id)}</span>{voice.speed != null ? ` speed ${String(voice.speed)}` : ""}</span>
				)}
				<span>{script.length} lines</span>
				<span>{camera.length} shots</span>
				<span>{Object.keys(plates).length} plates</span>
			</div>
			{script.length > 0 && (
				<>
					<div className="sub-h">Voiceover</div>
					<ol className="film-script">
						{script.map((l, i) => (
							<li key={i}>{l}</li>
						))}
					</ol>
				</>
			)}
			{camera.length > 0 && (
				<>
					<div className="sub-h">Shots — camera moves</div>
					<ol className="film-shots">
						{camera.map((c, i) => (
							<li key={i} className="film-shot">
								<span className="shot-n">{i + 1}</span>
								<span className="shot-plate">{String(c.plate ?? "—")}</span>
								{c.at != null && <span className="shot-at">on “{String(c.at)}”</span>}
								{(c.zoom != null || c.to_zoom != null) && <span className="muted">zoom {String(c.zoom ?? 1)}→{String(c.to_zoom ?? c.zoom ?? 1)}</span>}
							</li>
						))}
					</ol>
				</>
			)}
		</div>
	)
}

// The rendered storyboard board (one card per beat) for this version — the exact regions the render
// will frame. Streams from /api/board; hides itself if this version has no board (older versions).
function BoardImage({ versionId }: { versionId: string }) {
	const [ok, setOk] = useState(true)
	if (!ok) return null
	return (
		<figure className="board-sheet">
			<img src={boardUrlByVersion(versionId)} alt="storyboard board — one card per beat" loading="lazy" onError={() => setOk(false)} />
			<figcaption>Board — one card per beat (what the render will frame)</figcaption>
		</figure>
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
			) : kind === "markdown" && looksLikePlan(content) ? (
				// A plan/fan-out node (brainstorm-how, build-scenes, …) writes its children as a JSON array
				// of {name, brief}. Those land in a .md artifact (markdown kind) but are not prose — render
				// them as a board, like the storyboard, instead of dumping the raw ```json.
				<StoryboardBoard content={content} />
			) : kind === "markdown" ? (
				<div className="md"><Markdown source={content} /></div>
			) : kind === "script" ? (
				<ScriptView content={content} />
			) : kind === "storyboard" ? (
				<StoryboardBoard content={content} />
			) : kind === "card" ? (
				<CardPlate content={content} />
			) : (
				<pre className="raw">{content}</pre>
			)}
		</>
	)
}

// Card: the composed plate rendered in-app, so you see the beat as pixels — not the raw JSON. The card
// artifact is JSON {id, vo_line, camera, plate_html} (sometimes fenced in ```json). We extract plate_html
// and render it in a sandboxed iframe (no scripts — the plate is static HTML/CSS, the way the render
// screenshots it as a still). Falls back to raw JSON if the shape is unexpected.
function CardPlate({ content }: { content: string }) {
	let html: string | null = null
	let vo: string | undefined
	try {
		let t = content.trim()
		const fenced = t.match(/`{2,}(?:json)?\s*([\s\S]*?)`{2,}/) // tolerate ```json AND the two-backtick ``json producers sometimes emit
		if (fenced?.[1]) t = fenced[1]
		else {
			const s = t.indexOf("{")
			const e = t.lastIndexOf("}")
			if (s >= 0 && e > s) t = t.slice(s, e + 1)
		}
		const card = JSON.parse(t) as { plate_html?: string; vo_line?: string }
		html = card.plate_html ?? null
		vo = card.vo_line
	} catch {
		html = null
	}
	if (!html) return <pre className="raw">{content}</pre>
	return (
		<figure className="card-plate">
			<div className="plate-wrap">
				<iframe className="plate-frame" title="card plate" sandbox="" srcDoc={html} />
			</div>
			{vo && <figcaption>“{vo}”</figcaption>}
		</figure>
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
	let parsed: unknown
	try {
		let t = content.trim()
		const fenced = t.match(/`{2,}(?:json)?\s*([\s\S]*?)`{2,}/) // storyboard/plan artifacts are often fenced in ```json (sometimes a two-backtick ``json)
		if (fenced?.[1]) t = fenced[1]
		else {
			const s = t.search(/[[{]/)
			if (s > 0) t = t.slice(s)
		}
		parsed = JSON.parse(t)
	} catch {
		return <pre className="raw">{content}</pre>
	}
	// Two shapes: the card-PLAN — a top-level array of {name, brief}, i.e. the storyboard before any card
	// renders — or a film.json object (theme/voice/beats). Normalize both to a beats list.
	const obj = (Array.isArray(parsed) ? {} : (parsed ?? {})) as Record<string, unknown>
	const theme = (obj.theme ?? {}) as Record<string, string>
	const voice = (obj.voice ?? {}) as Record<string, unknown>
	const size = obj.size as [number, number] | undefined
	const beatsRaw = (Array.isArray(parsed) ? parsed : Array.isArray(obj.beats) ? obj.beats : Array.isArray(obj.scenes) ? obj.scenes : Array.isArray(obj.script) ? obj.script : []) as unknown[]
	const beats = beatsRaw.map((b) => (typeof b === "string" ? { vo: b } : (b as Record<string, unknown>)))
	if (beats.length === 0) return <pre className="raw">{content}</pre>
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
							{(b.name ?? b.label ?? b.beat ?? b.time) != null && (
								<div className="bn">{String(b.name ?? b.label ?? b.beat ?? "")}{b.time != null ? <span className="tag">{String(b.time)}</span> : null}</div>
							)}
							{(b.vo ?? b.line ?? b.text) != null && <div className="vo">{String(b.vo ?? b.line ?? b.text)}</div>}
							{(b.brief ?? b.capture ?? b.onscreen) != null && (
								// Clamp the long brief to a few lines so a beat stays scannable; full text on hover.
								<div className="cap" title={String(b.brief ?? b.capture ?? b.onscreen)}>{String(b.brief ?? b.capture ?? b.onscreen)}</div>
							)}
						</div>
					</div>
				))}
			</div>
		</>
	)
}

// A plan/fan-out artifact is a JSON array of child seeds ({name, brief}) — the thing a plan node emits
// before its children render. It arrives in a .md file (so its kind is "markdown"), often wrapped in a
// code fence (```json, or a two-backtick ``json). Detect that shape so it renders as a board instead of
// raw text — while leaving genuine prose markdown (e.g. a build-assets report) alone.
function parsePlanArray(content: string): Record<string, unknown>[] | null {
	try {
		let t = content.trim()
		const fenced = t.match(/`{2,}(?:json)?\s*([\s\S]*?)`{2,}/)
		if (fenced?.[1]) t = fenced[1].trim()
		else {
			const s = t.search(/[[{]/)
			if (s < 0) return null
			t = t.slice(s)
		}
		const parsed = JSON.parse(t)
		if (!Array.isArray(parsed)) return null
		const objs = parsed.filter((x) => x != null && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[]
		if (objs.length === 0) return null
		// Every item must name/brief itself (a concept or scene seed) — this is what keeps a prose report
		// that merely contains a JSON snippet from being mistaken for a plan.
		const planLike = objs.length === parsed.length && objs.every((o) => "name" in o || "brief" in o || "label" in o || "vo" in o)
		return planLike ? objs : null
	} catch {
		return null
	}
}

function looksLikePlan(content: string): boolean {
	return parsePlanArray(content) != null
}

// One reviewer verdict, flat (no accordion): label + verdict chip. For a revise, the feedback shows
// inline (that is the actionable part); the full reviewer run — telemetry + raw output — is behind the
// run-details modal, so there is nothing left to expand.
function ReviewCard({ review, interaction }: { review: Review; interaction?: Interaction }) {
	const detail = review.verdict === "revise" ? stripVerdict(review.body) : null
	// A review with no settled verdict yet is still running — show a spinner instead of a chip.
	const running = !/^(pass|revise|fail|failed|denied)$/i.test((review.verdict ?? "").trim())
	const [open, setOpen] = useState(false)
	// Only a review with feedback to read is collapsible; a pass (or a running one) is just the head.
	const collapsible = detail != null
	const toggle = () => collapsible && setOpen((o) => !o)
	return (
		<div className={`verdict flat ${collapsible ? "collapsible" : ""} ${open ? "open" : ""} ${running ? "active" : ""}`}>
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
					{running ? (
						<span className="vd-running"><Spinner label="reviewing" />reviewing</span>
					) : (
						<VerdictChip verdict={review.verdict} />
					)}
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
	if (it.numTurns != null) rows.push(["turns", String(it.numTurns)])
	if (it.durationMs != null) rows.push(["wall time", fmtDur(it.durationMs)])
	if (it.apiDurationMs != null) rows.push(["API time", fmtDur(it.apiDurationMs)])
	// wall − api is the time NOT spent calling the model: tool execution and rate-limit backoff. A big
	// gap here (not a big API time) is why a run can take 31 minutes — the model waited, it didn't think.
	if (it.durationMs != null && it.apiDurationMs != null && it.durationMs - it.apiDurationMs > 0) {
		rows.push(["waiting (tools / rate-limit)", fmtDur(it.durationMs - it.apiDurationMs)])
	}
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

function Gate({ inbox, productionId, budget, onAction, cancelled }: { inbox: ChatOutput[]; productionId: string; budget: ProductionDetail["budget"]; onAction: () => void; cancelled?: boolean }) {
	const act = async (fn: () => Promise<void>) => {
		await fn()
		onAction()
	}
	if (inbox.length === 0 && !(budget && !budget.approved)) return null
	// A cancelled production is terminal: its gate items are leftovers, not live asks. Keep them visible
	// for the record but disable every action — approving/feeding back a cancelled production does nothing.
	return (
		<div className="gate">
			<div className="gate-head">Inbox <span className="badge">{inbox.length}</span></div>
			{cancelled && <div className="gate-note">Production cancelled — these items are closed; no action can be taken.</div>}
			{inbox.map((o) => (
				<div key={o.id} className="out">
					<div><code>{o.type}</code> {o.prompt && <span>{o.prompt}</span>}</div>
					{o.type === "present" ? (
						<div className="controls">
							<button disabled={cancelled} onClick={() => void act(() => approveOutput(o.id))}>Approve</button>
							<button className="secondary" disabled={cancelled} onClick={() => {
								const body = window.prompt("Feedback for a redo:")
								if (body) void act(() => sendFeedback(o.id, body))
							}}>Feedback</button>
						</div>
					) : (
						<div className="controls"><button disabled={cancelled} onClick={() => void act(() => approveOutput(o.id))}>Ack</button></div>
					)}
				</div>
			))}
			{budget && !budget.approved && (
				<div className="out">
					<div><code>budget</code> render spend not yet approved</div>
					<div className="controls"><button disabled={cancelled} onClick={() => void act(() => approveBudget(productionId))}>Approve budget</button></div>
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
		case "cancelled":
			return "danger"
		case "in-progress":
		case "producing":
		case "queued-running":
			return "info"
		case "review":
		case "reviewing":
		case "revising":
		case "needs-work":
		case "presentable":
		case "awaiting feedback":
			return "warn"
		default:
			return "muted"
	}
}

function needsAttention(status: string): boolean {
	return ["in-progress", "producing", "review", "needs-work", "presentable", "escalated", "denied"].includes(status)
}

// Lifecycle buckets for the live view. Active = work is running right now (show a spinner, full
// opacity). Pending = not started yet (dim it). Everything else (done/approved/failed) renders normally.
const ACTIVE_STATUSES = ["in-progress", "producing", "queued-running", "running", "review", "reviewing"]
const PENDING_STATUSES = ["pending", "queued", "blocked", "waiting", "not-started"]

function isActive(status: string): boolean {
	return ACTIVE_STATUSES.includes(status)
}

function isPending(status: string): boolean {
	return PENDING_STATUSES.includes(status)
}

// A production that isn't finished yet but has gate items waiting (a present, a question/options, or an
// unapproved render budget) is blocked on the human, not running. Surface that as its own state so the
// header reads "awaiting feedback" instead of a misleading "in-progress" + spinner.
function awaitingFeedback(detail: ProductionDetail): boolean {
	if (["approved", "done", "failed", "denied", "cancelled"].includes(detail.root.status)) return false
	return detail.inbox.length > 0 || (!!detail.budget && !detail.budget.approved)
}

// A spinning ring marking the one thing currently executing. Respects prefers-reduced-motion (the CSS
// stops the animation and leaves a static ring).
function Spinner({ label }: { label?: string }) {
	return (
		<span className="spinner" role="status" aria-label={label ?? "running"} title={label ?? "running"}>
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
				<path d="M12 3a9 9 0 1 0 9 9" />
			</svg>
		</span>
	)
}

function artifactKind(nodeType: string, path: string | null): "video" | "markdown" | "script" | "storyboard" | "card" | "text" {
	if (isVideoPath(path)) return "video"
	const t = nodeType.toLowerCase()
	const ext = path ? path.split(".").pop()?.toLowerCase() : null
	if (t === "card") return "card" // a composed card: its artifact carries plate_html we can render in-app
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

// The collapsed card's sub-line: version (vN of N), then the step's telemetry — runs, cost, duration —
// rolled up over the node AND its whole subtree, so a parent like storyboard or build reflects the
// fanned-out cards/scenes beneath it (most of a production's time lives there). A "↳ N sub-steps" tail
// flags that the figure is a subtree total and where to drill. Rolling up is also what makes the
// top-level rows add up to the production's total duration. Only parts that have data show.
function stageMeta(nv: NodeView, latest: { version: Version; reviews: Review[] } | undefined, videos: VideoFile[], detail: ProductionDetail): string {
	const u = subtreeUsage(detail.nodes, nv.node.id)
	// An expand node (e.g. build) has no version of its own but holds work in its subtree — describe
	// that instead of "Nothing produced yet"; a truly empty node keeps the empty state.
	if (!latest && u.runs === 0) return "Nothing produced yet."

	const parts: string[] = []
	const n = nv.versions.length
	if (latest) parts.push(n > 1 ? `v${latest.version.n} of ${n}` : `v${latest.version.n}`)

	if (u.runs > 0) parts.push(`${u.runs} run${u.runs === 1 ? "" : "s"}`)
	if (u.costUsd > 0) parts.push(`$${u.costUsd.toFixed(2)}`)
	// Elapsed wall-clock first — the honest "how long it took". The subtree's summed subagent time
	// (compute) is shown alongside only when concurrency made it clearly larger, so a parent whose fanned
	// cards ran in parallel reads "4m 8s · 44m compute", not a misleading flat "44m".
	if (u.wallMs > 0) {
		parts.push(fmtDur(u.wallMs))
		if (u.durationMs > u.wallMs * 1.25 && u.durationMs - u.wallMs > 30000) parts.push(`${fmtDur(u.durationMs)} compute`)
	} else if (u.durationMs > 0) {
		parts.push(fmtDur(u.durationMs))
	}

	// Step-specific fact: a render's finished file size, matched from the videos list by path.
	if (latest?.version.artifactPath && isVideoPath(latest.version.artifactPath)) {
		const vid = findVideo(videos, latest.version.artifactPath)
		if (vid) parts.push(fmtBytes(vid.sizeBytes))
	}

	// Flag that the figures above are a subtree roll-up, and where the time went.
	if (u.descNodeCount > 0) parts.push(`↳ ${u.descNodeCount} sub-step${u.descNodeCount === 1 ? "" : "s"}`)
	return parts.join(" · ")
}

// Match a version's stored (possibly absolute) artifact path to a VideoFile whose `path` is relative
// to the artifacts root, by suffix.
function findVideo(videos: VideoFile[], artifactPath: string): VideoFile | undefined {
	const norm = artifactPath.replace(/\\/g, "/")
	return videos.find((v) => norm.endsWith(v.path))
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
