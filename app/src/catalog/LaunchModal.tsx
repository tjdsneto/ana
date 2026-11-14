import { useState } from "react"
import { launchFromTemplate } from "./catalog-api.js"
import type { AutonomyLever, Template } from "./types.js"

export function LaunchModal({ template, onLaunched, onClose }: { template: Template; onLaunched: (productionId: string) => void; onClose: () => void }) {
	const [productName, setProductName] = useState("")
	const [angle, setAngle] = useState("")
	const [autonomyLever, setLever] = useState<AutonomyLever>("high")
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function submit() {
		setBusy(true)
		setError(null)
		try {
			const { productionId } = await launchFromTemplate({ template, productName, angle, autonomyLever })
			onLaunched(productionId)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
			setBusy(false)
		}
	}

	return (
		<div className="modal-backdrop" onClick={onClose}>
			<div className="modal" onClick={(e) => e.stopPropagation()}>
				<h3>Make one like “{template.title}”</h3>
				<label>Product name<input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. AcmeDocs" /></label>
				<label>Your angle / idea<textarea value={angle} onChange={(e) => setAngle(e.target.value)} placeholder="What to carry over, for your product" /></label>
				<label>Autonomy
					<select value={autonomyLever} onChange={(e) => setLever(e.target.value as AutonomyLever)}>
						<option value="high">high — auto-approve</option>
						<option value="medium">medium — human gate</option>
						<option value="low">low — human gate</option>
					</select>
				</label>
				{error && <p className="modal-error">{error}</p>}
				<div className="modal-actions">
					<button onClick={onClose} disabled={busy}>Cancel</button>
					<button className="primary" onClick={submit} disabled={busy || !productName.trim() || !angle.trim()}>{busy ? "Starting…" : "Start production"}</button>
				</div>
			</div>
		</div>
	)
}
