// A small, dependency-free Markdown renderer — enough for the artifacts this dashboard shows
// (briefing, moodboard): headings, bold, inline code, bullet lists with one level of nesting, and
// GFM pipe tables. It is deliberately not a full CommonMark parser; anything it doesn't recognize
// falls through as a paragraph, so no input can break the render. Swap for react-markdown + remark-gfm
// later if the artifacts outgrow this.

import { Fragment, type ReactNode } from "react"

export function Markdown({ source }: { source: string }): ReactNode {
	const lines = source.replace(/\r\n/g, "\n").split("\n")
	const blocks: ReactNode[] = []
	let para: string[] = []
	let i = 0

	const flushPara = () => {
		if (para.length === 0) return
		blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "))}</p>)
		para = []
	}

	while (i < lines.length) {
		const line = lines[i] ?? ""
		const trimmed = line.trim()

		if (trimmed === "") {
			flushPara()
			i++
			continue
		}

		// heading
		const h = /^(#{1,6})\s+(.*)$/.exec(trimmed)
		if (h) {
			flushPara()
			const level = h[1]?.length ?? 1
			const Tag = `h${Math.min(level + 2, 6)}` as "h3" | "h4" | "h5" | "h6"
			blocks.push(<Tag key={`h${blocks.length}`} className="md-h">{inline(h[2] ?? "")}</Tag>)
			i++
			continue
		}

		// table: current line looks like a pipe row and the next is a separator row
		if (isTableRow(line) && isSeparatorRow(lines[i + 1])) {
			flushPara()
			const header = splitRow(line)
			const rows: string[][] = []
			i += 2
			while (i < lines.length && isTableRow(lines[i])) {
				rows.push(splitRow(lines[i]))
				i++
			}
			blocks.push(
				<div key={`t${blocks.length}`} className="md-tablewrap">
					<table className="md-table">
						<thead>
							<tr>{header.map((c, k) => <th key={k}>{inline(c)}</th>)}</tr>
						</thead>
						<tbody>
							{rows.map((r, ri) => (
								<tr key={ri}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>
							))}
						</tbody>
					</table>
				</div>,
			)
			continue
		}

		// list: a run of lines starting with -, * or + (with optional indent for nesting)
		if (isListItem(line)) {
			flushPara()
			const items: { depth: number; text: string }[] = []
			while (i < lines.length && isListItem(lines[i])) {
				const raw = lines[i] ?? ""
				const indent = raw.match(/^\s*/)?.[0].length ?? 0
				items.push({ depth: indent >= 2 ? 1 : 0, text: raw.replace(/^\s*[-*+]\s+/, "") })
				i++
			}
			blocks.push(renderList(items, `l${blocks.length}`))
			continue
		}

		para.push(trimmed)
		i++
	}
	flushPara()

	return <>{blocks}</>
}

function renderList(items: { depth: number; text: string }[], key: string): ReactNode {
	// Group a flat list with 0/1 depth markers into nested <ul>s.
	const top: ReactNode[] = []
	let j = 0
	while (j < items.length) {
		const item = items[j]
		if (!item) {
			j++
			continue
		}
		if (item.depth === 0) {
			const children: ReactNode[] = []
			let k = j + 1
			while (k < items.length && (items[k]?.depth ?? 0) > 0) {
				children.push(<li key={k}>{inline(items[k]?.text ?? "")}</li>)
				k++
			}
			top.push(
				<li key={j}>
					{inline(item.text)}
					{children.length > 0 && <ul>{children}</ul>}
				</li>,
			)
			j = k
		} else {
			top.push(<li key={j}>{inline(item.text)}</li>)
			j++
		}
	}
	return <ul key={key} className="md-ul">{top}</ul>
}

// Inline spans: **bold** and `code`. Everything else is text.
function inline(text: string): ReactNode {
	const parts: ReactNode[] = []
	const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g
	let last = 0
	let m: RegExpExecArray | null
	let idx = 0
	while ((m = re.exec(text)) !== null) {
		if (m.index > last) parts.push(<Fragment key={idx++}>{text.slice(last, m.index)}</Fragment>)
		if (m[2] != null) parts.push(<strong key={idx++}>{m[2]}</strong>)
		else if (m[3] != null) parts.push(<code key={idx++}>{m[3]}</code>)
		last = m.index + m[0].length
	}
	if (last < text.length) parts.push(<Fragment key={idx++}>{text.slice(last)}</Fragment>)
	return parts
}

function isTableRow(line: string | undefined): boolean {
	if (line == null) return false
	const t = line.trim()
	return t.includes("|") && !/^\s*[-*+]\s/.test(t)
}

function isSeparatorRow(line: string | undefined): boolean {
	if (line == null) return false
	return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line)
}

function isListItem(line: string | undefined): boolean {
	if (line == null) return false
	return /^\s*[-*+]\s+/.test(line)
}

function splitRow(line: string | undefined): string[] {
	let t = (line ?? "").trim()
	if (t.startsWith("|")) t = t.slice(1)
	if (t.endsWith("|")) t = t.slice(0, -1)
	return t.split("|").map((c) => c.trim())
}
