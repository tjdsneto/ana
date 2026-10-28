// Dashboard API entrypoint. Wires PgStore + the read API, then holds a dedicated pg client on
// LISTEN new_job / presentable and relays each NOTIFY to every connected browser over a WebSocket —
// so the UI refetches on a real engine event, no polling (spec 06 data flow). stdout free; logs → stderr.

import { createServer } from "node:http"
import { JsonLogger, makePool, PgStore } from "@core/shared"
import { WebSocketServer } from "ws"
import { buildApi } from "./server.js"

const logger = new JsonLogger({ bound: { svc: "dashboard-api" } })
const port = Number(process.env.WEB_API_PORT ?? 8788)

async function main(): Promise<void> {
	const pool = makePool()
	const store = new PgStore(pool)
	const app = buildApi(store, logger)
	const server = createServer(app)

	// WebSocket: one connection per browser tab; we only push (the browser refetches on a nudge).
	const wss = new WebSocketServer({ server, path: "/ws" })
	const broadcast = (event: { channel: string; payload: string }) => {
		const line = JSON.stringify(event)
		for (const client of wss.clients) {
			if (client.readyState === client.OPEN) client.send(line)
		}
	}
	wss.on("connection", () => logger.info("ws.connect", { clients: wss.clients.size }))

	// Dedicated listener client (a pooled client parked on LISTEN; reads still use the pool).
	const listener = await pool.connect()
	await listener.query("LISTEN new_job")
	await listener.query("LISTEN presentable")
	listener.on("notification", (msg) => {
		logger.debug("notify", { channel: msg.channel, payload: msg.payload })
		broadcast({ channel: msg.channel, payload: msg.payload ?? "" })
	})

	server.listen(port, () => logger.info("dashboard-api.ready", { port, ws: "/ws" }))
}

main().catch((err) => {
	logger.error("dashboard-api.fatal", { error: err instanceof Error ? err.message : String(err) })
	process.exit(1)
})
