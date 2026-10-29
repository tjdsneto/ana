// Dev harness (NOT product): seed a set of briefs and drive the human gate unattended, so a full
// production runs end to end with no operator at the keyboard. It is a Store/services client like the
// MCP server and the dashboard — it never calls the engine directly. Run it alongside the worker:
//   docker compose run --rm --no-deps engine-worker node engine/dist/auto-pilot/index.js
//
// Briefs are runtime data, never baked into source (the repo stays brand-free). Point
// AUTOPILOT_BRIEFS_FILE at a JSON array of brief strings (mount it into the container); otherwise a
// single generic placeholder brief is used.
//
// Behaviour: seed each brief as a production (idempotent — matched by description); then loop:
// approve budget, approve each presented output, and inject ONE feedback round (default on the
// `script` node, capped by AUTOPILOT_MAX_FEEDBACK) to exercise the denied→revise→approve path. Stops
// when every production is approved or the time budget runs out.

import { readFileSync } from "node:fs"
import { makeDbPool, PgStore } from "@core/shared"
import { approve, approveBudget, requestVideo, submitFeedback } from "@core/services"

const DEFAULT_BRIEF =
	"Create a 20-second promotional video introducing a small-business productivity app. Tone: upbeat and friendly. Cover the problem it solves, one standout feature, and end with a clear call to action."

const SESSION = process.env.AUTOPILOT_SESSION ?? "autopilot"
const FEEDBACK_TYPE = process.env.AUTOPILOT_FEEDBACK ?? "script" // node type to give one feedback round
const MAX_FEEDBACK = Number(process.env.AUTOPILOT_MAX_FEEDBACK ?? 1) // total feedback rounds across all productions
const MAX_SECONDS = Number(process.env.AUTOPILOT_MAX_SECONDS ?? 5400) // 90 min default
const POLL_MS = Number(process.env.AUTOPILOT_POLL_MS ?? 4000)

function loadBriefs(): string[] {
	const file = process.env.AUTOPILOT_BRIEFS_FILE
	if (!file) return [DEFAULT_BRIEF]
	const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
	if (Array.isArray(parsed) && parsed.every((b) => typeof b === "string" && b.trim())) return parsed as string[]
	throw new Error(`AUTOPILOT_BRIEFS_FILE must be a JSON array of non-empty strings: ${file}`)
}

function log(event: string, extra: Record<string, unknown> = {}): void {
	process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), svc: "auto-pilot", event, ...extra })}\n`)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
	const dbPool = makeDbPool()
	const store = new PgStore(dbPool)
	const briefs = loadBriefs()

	// seed (idempotent): one production per brief, matched by the stored description.
	const existing = await store.listProductions()
	for (const brief of briefs) {
		if (existing.some((p) => p.description === brief)) continue
		const r = await requestVideo(store, { brief, sessionId: SESSION, autonomyLever: "high", actorKind: "agent" })
		log("seeded", { productionId: r.production_id })
	}

	const fedback = new Set<string>() // node ids already given a feedback round
	let feedbackLeft = MAX_FEEDBACK
	const deadline = Date.now() + MAX_SECONDS * 1000

	while (Date.now() < deadline) {
		const prods = await store.listProductions()
		if (prods.length > 0 && prods.every((p) => p.status === "approved")) {
			log("all_approved", { productions: prods.length })
			break
		}
		for (const p of prods) {
			if (p.status === "approved") continue
			const budget = await store.getBudget(p.id)
			if (budget && !budget.approved) {
				await approveBudget(store, { productionId: p.id })
				log("budget_approved", { productionId: p.id })
			}
			for (const out of await store.pendingOutputs(p.id)) {
				const node = out.nodeId ? await store.getNode(out.nodeId) : null
				if (out.type === "present" && node?.type === FEEDBACK_TYPE && feedbackLeft > 0 && !fedback.has(node.id)) {
					fedback.add(node.id)
					feedbackLeft--
					await submitFeedback(store, { outputId: out.id, body: "Tighten the hook in the opening line and make the closing call to action more specific and concrete." })
					log("feedback", { node: node.type, outputId: out.id })
				} else {
					await approve(store, { outputId: out.id })
					log("approve", { node: node?.type ?? "?", type: out.type, outputId: out.id })
				}
			}
		}
		await sleep(POLL_MS)
	}

	log("done")
	await dbPool.end()
}

main().catch((err) => {
	log("fatal", { error: err instanceof Error ? err.message : String(err) })
	process.exit(1)
})
