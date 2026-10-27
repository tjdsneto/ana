// Logger adapters. JsonLogger writes one JSON object per line to a sink (stderr by default — stdout
// is reserved for the MCP stdio protocol). NoopLogger drops everything (the quiet default for
// library code + tests). A real tracer (LangSmith / OpenTelemetry) would be a third adapter.

import type { LogFields, Logger, LogLevel } from "./ports.js"

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface JsonLoggerOptions {
	level?: LogLevel // minimum level emitted (default "info", or LOG_LEVEL env)
	sink?: (line: string) => void // where a formatted line goes (default: stderr)
	bound?: LogFields // context merged into every line
	now?: () => Date // injectable for deterministic tests
}

export class JsonLogger implements Logger {
	private readonly level: LogLevel
	private readonly sink: (line: string) => void
	private readonly bound: LogFields
	private readonly now: () => Date

	constructor(opts: JsonLoggerOptions = {}) {
		this.level = opts.level ?? (process.env.LOG_LEVEL as LogLevel) ?? "info"
		this.sink = opts.sink ?? ((line) => process.stderr.write(`${line}\n`))
		this.bound = opts.bound ?? {}
		this.now = opts.now ?? (() => new Date())
	}

	log(level: LogLevel, event: string, fields: LogFields = {}): void {
		if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return
		this.sink(JSON.stringify({ ts: this.now().toISOString(), level, event, ...this.bound, ...fields }))
	}

	debug(event: string, fields?: LogFields): void {
		this.log("debug", event, fields)
	}
	info(event: string, fields?: LogFields): void {
		this.log("info", event, fields)
	}
	warn(event: string, fields?: LogFields): void {
		this.log("warn", event, fields)
	}
	error(event: string, fields?: LogFields): void {
		this.log("error", event, fields)
	}

	child(bound: LogFields): Logger {
		return new JsonLogger({ level: this.level, sink: this.sink, bound: { ...this.bound, ...bound }, now: this.now })
	}
}

export class NoopLogger implements Logger {
	log(_level: LogLevel, _event: string, _fields?: LogFields): void {}
	debug(_event: string, _fields?: LogFields): void {}
	info(_event: string, _fields?: LogFields): void {}
	warn(_event: string, _fields?: LogFields): void {}
	error(_event: string, _fields?: LogFields): void {}
	child(_bound: LogFields): Logger {
		return this
	}
}
