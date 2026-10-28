// FakeExec — a test double for the Exec port. It records every argv it was asked to run and, by
// default, creates each command's declared output file (empty) so a render/voice flow completes
// without a real ffmpeg/piper on the box. A handler can override a command's behaviour (e.g. make
// ffprobe print a duration). No process is ever spawned.

import { writeFileSync } from "node:fs"
import type { Exec, ExecRequest, ExecResult } from "@core/shared"

export interface FakeExecCall {
	bin: string
	args: string[]
	stdin?: string
}

// A handler can shape the result for a given command; return undefined to fall through to the
// default (touch any output path args, exit 0).
export type FakeExecHandler = (req: ExecRequest) => Partial<ExecResult> | undefined

export class FakeExec implements Exec {
	readonly calls: FakeExecCall[] = []
	constructor(private readonly handler?: FakeExecHandler) {}

	async run(req: ExecRequest): Promise<ExecResult> {
		this.calls.push({ bin: req.bin, args: req.args, stdin: typeof req.stdin === "string" ? req.stdin : undefined })
		// Touch any output file the command names after -o/--output_file/-output_file, and the last
		// positional path for ffmpeg (its output is the final arg). Enough for the flow to proceed.
		for (const out of outputPaths(req)) {
			try {
				writeFileSync(out, "")
			} catch {
				// ignore — a test may point at a dir that does not exist; the assertion is on argv
			}
		}
		const over = this.handler?.(req) ?? {}
		return { code: 0, stdout: "", stderr: "", ...over }
	}

	/** Every argv across all calls, flattened — handy for coarse assertions. */
	bins(): string[] {
		return this.calls.map((c) => c.bin)
	}
}

function outputPaths(req: ExecRequest): string[] {
	const paths: string[] = []
	const flags = new Set(["-o", "--output_file", "-output_file", "--output", "-output"])
	for (let i = 0; i < req.args.length - 1; i++) {
		if (flags.has(req.args[i]!)) paths.push(req.args[i + 1]!)
	}
	// ffmpeg writes to its last positional argument (unless it is a flag value); best-effort.
	if (req.bin.endsWith("ffmpeg")) {
		const last = req.args.at(-1)
		if (last && !last.startsWith("-")) paths.push(last)
	}
	return paths
}
