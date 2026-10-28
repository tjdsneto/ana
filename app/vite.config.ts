import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Dev server proxies the API + WebSocket to server/api, so the browser talks to one origin and there
// is no CORS/url juggling in the app. Target is WEB_API_URL when set (Compose: http://web-api:8788),
// else localhost:WEB_API_PORT for a local run. Ports come from .env.example (web 5173, api 8788).
const apiTarget = process.env.WEB_API_URL ?? `http://localhost:${process.env.WEB_API_PORT ?? 8788}`

export default defineConfig({
	plugins: [react()],
	server: {
		host: true, // bind 0.0.0.0 so the container port is reachable
		port: Number(process.env.WEB_PORT ?? 5173),
		proxy: {
			"/api": { target: apiTarget, changeOrigin: true },
			"/ws": { target: apiTarget, ws: true },
		},
	},
})
