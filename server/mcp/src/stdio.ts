// stdio entrypoint — lets a local Claude Code session call the tools without Docker. stdout is the
// protocol channel, so all logging goes to stderr. Register with:
//   claude mcp add --transport stdio production-engine -- node /abs/path/server/mcp/dist/stdio.js

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { buildServer } from "./server.js"
import { makeStore } from "./store-factory.js"

async function main(): Promise<void> {
	const server = buildServer(makeStore())
	await server.connect(new StdioServerTransport())
	console.error("[mcp] stdio transport ready")
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
