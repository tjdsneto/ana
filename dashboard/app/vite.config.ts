import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Dev server proxies the API + WebSocket to dashboard/api, so the browser talks to one origin and
// there is no CORS/url juggling in the app. Ports come from .env.example (app 5173, api 8788).
export default defineConfig({
	plugins: [react()],
	server: {
		port: Number(process.env.DASHBOARD_APP_PORT ?? 5173),
		proxy: {
			"/api": { target: `http://localhost:${process.env.DASHBOARD_API_PORT ?? 8788}`, changeOrigin: true },
			"/ws": { target: `http://localhost:${process.env.DASHBOARD_API_PORT ?? 8788}`, ws: true },
		},
	},
})
