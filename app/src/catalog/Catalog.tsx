import { useMemo, useState } from "react"
import { filterTemplates } from "./catalog-api.js"
import type { Template } from "./types.js"

export function Catalog({ templates, onSelect }: { templates: Template[]; onSelect: (slug: string) => void }) {
	const [tier, setTier] = useState<string>("")
	const [tag, setTag] = useState<string>("")
	const tiers = useMemo(() => Array.from(new Set(templates.map((t) => t.tier))), [templates])
	const tags = useMemo(() => Array.from(new Set(templates.flatMap((t) => t.tags))), [templates])
	const shown = useMemo(() => filterTemplates(templates, { tier: tier || undefined, tag: tag || undefined }), [templates, tier, tag])

	if (templates.length === 0) return <div className="catalog-empty">No templates yet. Run the promote script to populate the catalog.</div>

	return (
		<div className="catalog">
			<div className="catalog-filters">
				<select value={tier} onChange={(e) => setTier(e.target.value)}>
					<option value="">All tiers</option>
					{tiers.map((t) => (<option key={t} value={t}>{t}</option>))}
				</select>
				{tags.length > 0 && (
					<select value={tag} onChange={(e) => setTag(e.target.value)}>
						<option value="">All tags</option>
						{tags.map((t) => (<option key={t} value={t}>{t}</option>))}
					</select>
				)}
			</div>
			{shown.length === 0 ? (
				<div className="catalog-empty">No templates match this filter.</div>
			) : (
				<div className="catalog-grid">
					{shown.map((t) => (
						<button key={t.slug} className="catalog-card" onClick={() => onSelect(t.slug)}>
							<img src={`/catalog/${t.posterPath}`} alt={t.title} loading="lazy" />
							<div className="catalog-card-body">
								<span className="catalog-tier">{t.tier}</span>
								<strong>{t.title}</strong>
								<span className="catalog-meta">{t.creator} → {t.product}</span>
							</div>
						</button>
					))}
				</div>
			)}
		</div>
	)
}
