// WebSocket hook — opens /ws and calls onEvent on each engine NOTIFY relayed by the API. The UI
// refetches on a nudge; we don't stream state over the socket. Reconnects on drop (dev-grade).

import { useEffect, useRef, useState } from "react"

export interface LiveEvent {
	channel: string // "new_production" | "presentable" | "production_changed"
	payload: string // production id for new_production/presentable; empty for production_changed (refetch selected)
}

export function useLive(onEvent: (event: LiveEvent) => void): { connected: boolean } {
	const [connected, setConnected] = useState(false)
	const cb = useRef(onEvent)
	cb.current = onEvent

	useEffect(() => {
		let socket: WebSocket | null = null
		let retry: ReturnType<typeof setTimeout> | undefined
		let closed = false

		const connect = () => {
			const proto = location.protocol === "https:" ? "wss" : "ws"
			socket = new WebSocket(`${proto}://${location.host}/ws`)
			socket.onopen = () => setConnected(true)
			socket.onmessage = (e) => {
				try {
					cb.current(JSON.parse(e.data) as LiveEvent)
				} catch {
					// ignore malformed frames
				}
			}
			socket.onclose = () => {
				setConnected(false)
				if (!closed) retry = setTimeout(connect, 1500)
			}
		}
		connect()

		return () => {
			closed = true
			if (retry) clearTimeout(retry)
			socket?.close()
		}
	}, [])

	return { connected }
}
