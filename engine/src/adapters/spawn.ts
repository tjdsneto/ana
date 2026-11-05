// spawnCollect — spawn a headless agent CLI with the query piped to STDIN (never argv: a large
// upstream makes the prompt megabytes and a positional arg that size throws spawn E2BIG), collect
// stdout/stderr, and honor an AbortSignal (0009: the engine's wall-clock watchdog kills a runaway
// child so it stops spending after the engine has stopped waiting). Shared by the codex + gemini
// SubagentRunner adapters. The claude adapter has its own near-identical copy with claude-specific
// error strings; folding all three onto this is a worthwhile follow-up cleanup, left out here to keep
// the working claude path untouched. This module only transports bytes — parsing is the caller's job.

import { spawn } from "node:child_process"

export interface SpawnResult {
	stdout: string
	code: number | null
	stderr: string
}

const MAX = 32 * 1024 * 1024 // stdout buffer cap — a runaway subagent must not OOM the worker

export function spawnCollect(
	label: string,
	bin: string,
	args: string[],
	cwd: string | undefined,
	stdinData: string,
	signal?: AbortSignal,
): Promise<SpawnResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "pipe"] })
		let out = ""
		let err = ""
		let killed = false
		const onAbort = () => {
			if (killed) return
			killed = true
			child.kill("SIGKILL")
			reject(new Error(`${label} aborted by wall-clock watchdog`))
		}
		if (signal) {
			if (signal.aborted) {
				onAbort()
				return
			}
			signal.addEventListener("abort", onAbort, { once: true })
		}
		child.stdout.on("data", (d) => {
			out += d
			if (out.length > MAX && !killed) {
				killed = true
				child.kill()
				reject(new Error(`${label} stdout exceeded 32MB buffer`))
			}
		})
		child.stderr.on("data", (d) => {
			err += d
		})
		child.on("error", reject)
		// Resolve with the exit code (don't reject on non-zero): the caller decides, so a post-output
		// hook/log failure doesn't discard a produced result.
		child.on("close", (code) => {
			if (signal) signal.removeEventListener("abort", onAbort)
			if (!killed) resolve({ stdout: out, code, stderr: err })
		})
		child.stdin.on("error", () => {}) // ignore EPIPE if the CLI closes stdin early
		child.stdin.end(stdinData)
	})
}

// execFile/spawn reject argv (and some CLIs reject stdin) carrying embedded NULs — strip them. The
// loop also avoids feeding binary into prompts; this is the belt.
export function stripNull(s: string): string {
	return s.replace(/\0/g, "")
}
