// Streamable-HTTP entrypoint (the Compose target). Stateless: a fresh server + transport per POST
// (sessionIdGenerator: undefined). The Store is shared — it is stateless over its pool. Verified
// shape against @modelcontextprotocol/sdk 1.32.2. Register with:
//   claude mcp add --transport http production-engine http://localhost:8790/mcp

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { JsonLogger } from "@core/shared"
import express from "express"
import { buildServer } from "./server.js"
import { makeStore } from "./store-factory.js"

const store = makeStore()
const logger = new JsonLogger({ bound: { svc: "mcp", transport: "http" } })
const port = Number(process.env.MCP_HTTP_PORT ?? 8790)

const app = express()
app.use(express.json())

app.post("/mcp", async (req, res) => {
	const server = buildServer(store, logger)
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
	res.on("close", () => {
		void transport.close()
		void server.close()
	})
	await server.connect(transport)
	await transport.handleRequest(req, res, req.body)
})

// Stateless server: the SSE stream (GET) and session teardown (DELETE) are not supported.
app.get("/mcp", (_req, res) => res.status(405).end())
app.delete("/mcp", (_req, res) => res.status(405).end())

app.listen(port, () => logger.info("mcp.ready", { port, path: "/mcp" }))
