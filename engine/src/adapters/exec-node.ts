// NodeExec — the real Exec adapter: spawns a binary with an argv array (never a shell string, so no
// shell parsing and no command injection) and buffers stdout/stderr. Used by the local render
// assembler (ffmpeg/ffprobe) and the CLI voice engines (piper/kokoro).

import { spawn } from "node:child_process"
import type { Exec, ExecRequest, ExecResult } from "@core/shared"

export class NodeExec implements Exec {
	run(req: ExecRequest): Promise<ExecResult> {
		return new Promise((resolve, reject) => {
			const child = spawn(req.bin, req.args, { cwd: req.cwd, stdio: ["pipe", "pipe", "pipe"] })
			let stdout = ""
			let stderr = ""
			child.stdout.on("data", (d) => {
				stdout += d
			})
			child.stderr.on("data", (d) => {
				stderr += d
			})
			child.on("error", reject) // bin not found / not executable
			child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }))
			if (req.stdin !== undefined) child.stdin.write(req.stdin)
			child.stdin.end()
		})
	}
}
