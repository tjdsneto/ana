// stdio entrypoint — lets a local Claude Code session call the tools without Docker. stdout is the
// protocol channel, so all logging goes to stderr. Register with:
//   claude mcp add --transport stdio production-engine -- node /abs/path/server/mcp/dist/stdio.js

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { JsonLogger } from "@app/shared"
import { buildServer } from "./server.js"
import { makeStore } from "./store-factory.js"

const logger = new JsonLogger({ bound: { svc: "mcp", transport: "stdio" } })

async function main(): Promise<void> {
	const server = buildServer(makeStore(), logger)
	await server.connect(new StdioServerTransport())
	logger.info("mcp.ready")
}

main().catch((err) => {
	logger.error("mcp.fatal", { error: err instanceof Error ? err.message : String(err) })
	process.exit(1)
})
