import { useState } from "react"
import { LaunchModal } from "./LaunchModal.js"
import type { Template } from "./types.js"

export function TemplateDetail({ template, onLaunched, onBack }: { template: Template; onLaunched: (productionId: string) => void; onBack: () => void }) {
	const [launching, setLaunching] = useState(false)
	return (
		<div className="template-detail">
			<button className="link" onClick={onBack}>← Catalog</button>
			<header className="template-head">
				<video src={`/catalog/${template.videoPath}`} poster={`/catalog/${template.posterPath}`} controls />
				<div>
					<h2>{template.title}</h2>
					<p className="catalog-meta">{template.creator} → {template.product} · {template.tier} · {template.aspect} · ~{Math.round(template.durationSec)}s</p>
					<p className="template-one-idea">{template.oneIdea}</p>
					<button className="primary" onClick={() => setLaunching(true)}>Make one like this</button>
				</div>
			</header>
			<section><h4>Hook</h4><p>{template.hook}</p></section>
			<section><h4>CTA</h4><p>{template.cta}</p></section>
			<section><h4>Why it works</h4><p>{template.whyItWorks}</p></section>
			<section><h4>Look</h4><p>{template.look}</p></section>
			<section><h4>Tools</h4><p>{template.tools.join(", ")}</p></section>
			<section>
				<h4>Storyboard</h4>
				<ol className="template-beats">{template.storyboard.map((b, i) => (<li key={i}><strong>{b.t}</strong> — {b.job}: {b.whatHappens}</li>))}</ol>
			</section>
			<section>
				<h4>Scorecard</h4>
				<ul className="template-score">{template.scorecard.map((s, i) => (<li key={i} className={`v-${s.verdict}`}><strong>{s.check}</strong>: {s.verdict} — {s.note}</li>))}</ul>
			</section>
			{launching && <LaunchModal template={template} onLaunched={onLaunched} onClose={() => setLaunching(false)} />}
		</div>
	)
}
