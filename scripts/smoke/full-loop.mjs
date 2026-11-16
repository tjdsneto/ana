// Full-loop smoke harness — drives the production-engine MCP tools the way the thin client would, to
// prove the loop end to end: request_video -> poll get_status + inbox -> get_deliverable + approve
// each present -> until the production is done. Exercises the real MCP HTTP transport and the
// client-facing 8-tool surface (the same tools client/agent/.mcp.json exposes). It does NOT run craft.
//
// Usage:
//   node scripts/smoke/full-loop.mjs "<brief>" [options]
//   npm run smoke -- "<brief>" [options]
//
// Options:
//   --url <url>        MCP endpoint              (default http://localhost:8790/mcp)
//   --production <id>  resume an existing production instead of requesting a new one
//   --lever <l>        autonomy lever            (default high)       low | medium | high
//   --actor <k>        actor kind                (default agent)      human | agent
//   --session <id>     session id                (default smoke-<ts>)
//   --poll-ms <n>      poll interval             (default 2500)
//   --max-ms <n>       overall time cap          (default 180000)
//
// Exits 0 only when the production reaches status "done"; 1 otherwise (cap hit, stranded, or failed).
//
// Needs the stack up: the mcp-server (docker compose up -d mcp-server) and a worker. Real worker =
// real craft + spend; SUBAGENT_ENGINE=fake + stub providers = $0 but can't drive planner nodes yet
// (see the project issue log, 0001 + 0002). The client's produce-video skill is the human-facing
// counterpart to this driver.

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

const argv = process.argv.slice(2)
const flags = {}
const positional = []
for (let i = 0; i < argv.length; i++) {
	if (argv[i].startsWith("--")) {
		const key = argv[i].slice(2)
		flags[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true
	} else {
		positional.push(argv[i])
	}
}

const brief = positional[0] ?? flags.brief ?? "A 15-second launch video for a new feature."
const url = flags.url ?? "http://localhost:8790/mcp"
const lever = flags.lever ?? "high"
const actor = flags.actor ?? "agent"
const sessionId = flags.session ?? `smoke-${Date.now()}`
const pollMs = Number(flags["poll-ms"] ?? 2500)
const maxMs = Number(flags["max-ms"] ?? 180000)
const resumeId = typeof flags.production === "string" ? flags.production : null
const rootType = typeof flags.type === "string" ? flags.type : null
const rootParams = typeof flags.params === "string" ? JSON.parse(flags.params) : undefined

// Top-level status mirrors the ROOT node. The engine rolls a finished root up to "approved" (and logs
// a production.done EVENT) — there is no literal "done" node status — so "approved" on the root is the
// success terminal. It only appears once the whole tree has rolled up, so breaking on it can't fire mid-run.
const SUCCESS = new Set(["done", "delivered", "approved"])
const TERMINAL = new Set([...SUCCESS, "failed", "error", "cancelled", "canceled", "retired"])
const t0 = Date.now()
const el = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
const log = (...a) => console.log(`[${el()}]`, ...a)

const client = new Client({ name: "full-loop-smoke", version: "0.0.0" })
await client.connect(new StreamableHTTPClientTransport(new URL(url)))
log("connected", url)

async function call(name, args = {}) {
	const r = await client.callTool({ name, arguments: args })
	const text = r.content?.map((c) => c.text ?? "").join("") ?? ""
	if (r.isError) throw new Error(`${name} failed: ${text}`)
	try {
		return JSON.parse(text)
	} catch {
		return text
	}
}

const statusOf = (s) => s.status ?? s.state ?? "?"

// 1. Request a new production, or resume one by id.
let productionId
if (resumeId) {
	productionId = resumeId
	log("resume production", productionId)
} else {
	const reqArgs = { brief, session_id: sessionId, autonomy_lever: lever, actor_kind: actor }
	if (rootType) reqArgs.type = rootType
	if (rootParams) reqArgs.params = rootParams
	const req = await call("request_video", reqArgs)
	log(`request_video (type=${rootType ?? "video-project"}) ->`, JSON.stringify(req))
	productionId = req.production_id ?? req.productionId
}
if (!productionId) throw new Error("no production_id")

// 2. Pre-approve the render budget so the money gate never blocks the smoke.
try {
	log("approve_budget ->", JSON.stringify(await call("approve_budget", { production_id: productionId })))
} catch (e) {
	log("approve_budget (non-fatal):", e.message)
}

// 3. Poll + approve loop: approve every presented version to unblock the next pass.
const approved = new Set()
let lastLine = ""
while (Date.now() - t0 < maxMs) {
	const status = await call("get_status", { production_id: productionId })
	const s = statusOf(status)
	const nodes = (status.nodes ?? []).map((n) => `${n.type}:${n.status}`).join(" ")
	const line = `${s} | ${nodes}`
	if (line !== lastLine) {
		log("status:", line)
		lastLine = line
	}

	const box = await call("inbox", { production_id: productionId })
	for (const out of box.outputs ?? []) {
		if (approved.has(out.id)) continue
		if (out.type === "present") {
			let peek = ""
			if (out.version_id) {
				try {
					peek = JSON.stringify(await call("get_deliverable", { version_id: out.version_id })).slice(0, 160)
				} catch (e) {
					peek = `(get_deliverable err: ${e.message})`
				}
			}
			log(`present node=${out.node_id} ver=${out.version_id} ::`, peek)
			await call("approve", { output_id: out.id })
			log(`approved output=${out.id}`)
		} else {
			// v0 emits present only; log anything else (options/question/notify) rather than guess an answer.
			log(`output type=${out.type} id=${out.id} prompt=${out.prompt ?? ""} options=${JSON.stringify(out.options ?? null)} (not auto-handled)`)
		}
		approved.add(out.id)
	}

	if (TERMINAL.has(s)) {
		log("TERMINAL:", s)
		break
	}
	await new Promise((r) => setTimeout(r, pollMs))
}

const final = await call("get_status", { production_id: productionId })
const finalStatus = statusOf(final)
log("FINAL status:", finalStatus)
try {
	const lastNode = (final.nodes ?? []).at(-1)?.id
	if (lastNode) log("final deliverable:", JSON.stringify(await call("get_deliverable", { node_id: lastNode })).slice(0, 300))
} catch (e) {
	log("final get_deliverable:", e.message)
}
log(`approvals=${approved.size} production=${productionId}`)
await client.close()
process.exit(SUCCESS.has(finalStatus) ? 0 : 1)
