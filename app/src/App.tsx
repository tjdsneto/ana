// The dashboard UI. Left: productions. Right: the selected production's live node tree + the gate
// (inbox). It refetches on every WebSocket nudge, so the view tracks the worker in real time. Low
// ceremony on purpose (spec 06) — a window into the DB while we build, not a product surface.

import { useCallback, useEffect, useRef, useState } from "react"
import {
	approveBudget,
	approveOutput,
	getDeliverable,
	getProduction,
	getProductions,
	type ChatOutput,
	type Interaction,
	type Node,
	type NodeView,
	type ProductionDetail,
	sendFeedback,
	type UsageSummary,
} from "./api.js"
import { useLive } from "./useLive.js"

export function App() {
	const [productions, setProductions] = useState<Node[]>([])
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [detail, setDetail] = useState<ProductionDetail | null>(null)
	const [error, setError] = useState<string | null>(null)
	const selectedRef = useRef<string | null>(null)
	selectedRef.current = selectedId

	const refreshList = useCallback(async () => {
		try {
			setProductions(await getProductions())
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}, [])

	const refreshDetail = useCallback(async (id: string) => {
		try {
			setDetail(await getProduction(id))
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}, [])

	useEffect(() => {
		void refreshList()
	}, [refreshList])

	useEffect(() => {
		if (selectedId) void refreshDetail(selectedId)
		else setDetail(null)
	}, [selectedId, refreshDetail])

	const { connected } = useLive(() => {
		void refreshList()
		const id = selectedRef.current
		if (id) void refreshDetail(id)
	})

	return (
		<div className="app">
			<header>
				<h1>Engine dashboard</h1>
				<span className={`dot ${connected ? "on" : "off"}`} title={connected ? "live" : "disconnected"} />
			</header>
			{error && <div className="error" onClick={() => setError(null)}>{error} (click to dismiss)</div>}
			<div className="cols">
				<aside>
					<h2>Productions</h2>
					{productions.length === 0 && <p className="muted">No productions yet.</p>}
					<ul className="plist">
						{productions.map((p) => (
							<li key={p.id} className={p.id === selectedId ? "sel" : ""} onClick={() => setSelectedId(p.id)}>
								<div className="pname">{p.name}</div>
								<div className="pmeta">
									<Pill status={p.status} /> <span className="muted">{p.autonomyLever ?? "—"} · {p.actorKind ?? "—"}</span>
								</div>
							</li>
						))}
					</ul>
				</aside>
				<section>
					{!detail && <p className="muted">Select a production.</p>}
					{detail && <Detail detail={detail} onAction={() => selectedId && refreshDetail(selectedId)} />}
				</section>
			</div>
		</div>
	)
}

function Detail({ detail, onAction }: { detail: ProductionDetail; onAction: () => void }) {
	const children = detail.nodes.filter((n) => n.node.parentId === detail.root.id)
	return (
		<>
			<h2>
				{detail.root.name} <Pill status={detail.root.status} />
			</h2>
			<div className="rootmeta muted">
				started {fmtTime(detail.root.createdAt)} · {detail.root.autonomyLever ?? "—"} · {detail.root.actorKind ?? "—"}
			</div>
			<Gate inbox={detail.inbox} productionId={detail.root.id} budget={detail.budget} onAction={onAction} />
			<UsagePanel usage={detail.usage} />
			<h3>Node tree</h3>
			<NodeRow nv={nodeViewOf(detail, detail.root.id)} root />
			<ul className="tree">
				{children.map((nv) => (
					<li key={nv.node.id}>
						<NodeRow nv={nv} />
					</li>
				))}
			</ul>
			{detail.assets.length > 0 && (
				<>
					<h3>Assets</h3>
					<ul className="assets">
						{detail.assets.map((a) => (
							<li key={a.id}>
								<code>{a.assetType}/{a.fileType}</code> {a.name} <span className="muted">{a.storagePath}</span>
							</li>
						))}
					</ul>
				</>
			)}
		</>
	)
}

function NodeRow({ nv, root }: { nv: NodeView | null; root?: boolean }) {
	if (!nv) return null
	return (
		<div className={`node ${root ? "rootnode" : ""}`}>
			<div className="nhead">
				<strong>{nv.node.type}</strong> <span className="muted">{nv.node.name}</span> <Pill status={nv.node.status} />
				<span className="ts">{fmtTime(nv.node.createdAt)}</span>
			</div>
			{nv.versions.map(({ version, reviews }) => {
				const vints = nv.interactions.filter((i) => i.versionId === version.id)
				return (
					<div key={version.id} className="version">
						<div className="vhead">
							<span className="vn">v{version.n}</span> <Pill status={version.status} />
							<span className="ts">{fmtTime(version.createdAt)}</span>
							{version.artifactPath && <ViewArtifact versionId={version.id} />}
						</div>
						{version.feedback && <div className="fb">feedback: {version.feedback}</div>}
						{reviews.length > 0 && (
							<ul className="reviews">
								{reviews.map((r) => (
									<li key={r.id}>
										<code>{r.name}</code> <span className={`verdict ${r.verdict}`}>{r.verdict}</span>
										<span className="ts">{fmtTime(r.createdAt)}</span>
										{r.body && <div className="muted rbody">{r.body}</div>}
									</li>
								))}
							</ul>
						)}
						{vints.length > 0 && (
							<ul className="ints">
								{vints.map((it) => (
									<InteractionRow key={it.id} it={it} />
								))}
							</ul>
						)}
					</div>
				)
			})}
		</div>
	)
}

// One subagent run: role, engine/model, session, tokens, cost, duration, timestamp, status.
function InteractionRow({ it }: { it: Interaction }) {
	const review = it.role.startsWith("review:")
	return (
		<li className="int">
			<span className={`irole ${review ? "r-review" : "r-producer"}`}>{it.role}</span>
			<span className="muted">{it.engine}{it.model ? `/${it.model}` : ""}</span>
			{it.sessionId && <span className="sid" title={it.sessionId}>sess {shortId(it.sessionId)}</span>}
			<span className="tok" title="input → output tokens">{fmtNum(it.inputTokens)}→{fmtNum(it.outputTokens)} tok</span>
			{(it.cacheReadTokens || it.cacheCreationTokens) ? (
				<span className="muted" title="cache read / creation tokens">cache {fmtNum(it.cacheReadTokens)}/{fmtNum(it.cacheCreationTokens)}</span>
			) : null}
			{it.costUsd != null && it.costUsd > 0 && <span className="cost">${it.costUsd.toFixed(4)}</span>}
			{it.durationMs != null && <span className="dur">{fmtDur(it.durationMs)}</span>}
			<span className="ts">{fmtTime(it.createdAt)}</span>
		</li>
	)
}

// Rolled-up usage across the whole production.
function UsagePanel({ usage }: { usage: UsageSummary }) {
	return (
		<div className="usage">
			<h3>Usage</h3>
			<div className="ustats">
				<Stat label="interactions" value={String(usage.interactions)} />
				<Stat label="sessions" value={String(usage.sessions.length)} />
				<Stat label="tokens in" value={fmtNum(usage.inputTokens)} />
				<Stat label="tokens out" value={fmtNum(usage.outputTokens)} />
				<Stat label="cache read" value={fmtNum(usage.cacheReadTokens)} />
				<Stat label="cost" value={`$${usage.costUsd.toFixed(4)}`} />
				<Stat label="duration" value={fmtDur(usage.durationMs)} />
			</div>
		</div>
	)
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="stat">
			<div className="sv">{value}</div>
			<div className="sl muted">{label}</div>
		</div>
	)
}

function fmtTime(iso: string | null | undefined): string {
	if (!iso) return ""
	const d = new Date(iso)
	return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString()
}

function fmtDur(ms: number | null): string {
	if (ms == null) return ""
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function fmtNum(n: number | null): string {
	return n == null ? "—" : n.toLocaleString()
}

function shortId(id: string): string {
	return id.length > 10 ? `…${id.slice(-8)}` : id
}

function ViewArtifact({ versionId }: { versionId: string }) {
	const [content, setContent] = useState<string | null>(null)
	const [open, setOpen] = useState(false)
	const toggle = async () => {
		if (!open && content === null) {
			const d = await getDeliverable(versionId)
			setContent(d.content ?? `(no inline content) ${d.artifact_path ?? ""}`)
		}
		setOpen((o) => !o)
	}
	return (
		<>
			<button className="link" onClick={() => void toggle()}>
				{open ? "hide" : "view"} artifact
			</button>
			{open && <pre className="artifact">{content}</pre>}
		</>
	)
}

function Gate({ inbox, productionId, budget, onAction }: { inbox: ChatOutput[]; productionId: string; budget: ProductionDetail["budget"]; onAction: () => void }) {
	const act = async (fn: () => Promise<void>) => {
		await fn()
		onAction()
	}
	return (
		<div className="gate">
			<h3>Inbox {inbox.length > 0 && <span className="badge">{inbox.length}</span>}</h3>
			{inbox.length === 0 && <p className="muted">Nothing waiting.</p>}
			{inbox.map((o) => (
				<div key={o.id} className="out">
					<div>
						<code>{o.type}</code> {o.prompt && <span>{o.prompt}</span>}
					</div>
					{o.type === "present" ? (
						<div className="controls">
							<button onClick={() => void act(() => approveOutput(o.id))}>Approve</button>
							<button
								onClick={() => {
									const body = window.prompt("Feedback for a redo:")
									if (body) void act(() => sendFeedback(o.id, body))
								}}
							>
								Feedback
							</button>
						</div>
					) : (
						<div className="controls">
							<button onClick={() => void act(() => approveOutput(o.id))}>Ack</button>
						</div>
					)}
				</div>
			))}
			{budget && !budget.approved && (
				<div className="out">
					<div><code>budget</code> render spend not yet approved</div>
					<div className="controls">
						<button onClick={() => void act(() => approveBudget(productionId))}>Approve budget</button>
					</div>
				</div>
			)}
		</div>
	)
}

function Pill({ status }: { status: string }) {
	return <span className={`pill s-${status}`}>{status}</span>
}

function nodeViewOf(detail: ProductionDetail, nodeId: string): NodeView | null {
	return detail.nodes.find((n) => n.node.id === nodeId) ?? null
}
