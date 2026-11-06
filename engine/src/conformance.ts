// Deterministic conformance gate for planner output (0018). A planner emits a JSON artifact (a fenced
// ```json block or a bare array); this validates it against the step's JSON Schema and returns the
// concrete violations in plain language. The loop feeds those back to the SAME model as a redo
// directive (come-back-to-the-model) instead of the pre-0018 hard throw on a malformed/off-schema plan.
//
// Generic by design: the engine knows nothing about video — the schema lives in craft and is passed in
// as a plain object. JSON Schema (draft-07) via ajv is the single source of truth, so adding a required
// field or an enum value is a craft-side schema edit, not an engine change.

import { Ajv, type ValidateFunction } from "ajv"

export interface ConformanceResult {
	ok: boolean
	errors: string[]
}

const ajv = new Ajv({ allErrors: true, strict: false }) // strict:false: tolerate draft-07 $schema/title/description meta the craft schemas carry
const compiled = new Map<object, ValidateFunction>() // one compiled validator per schema object (planner schemas are static)

function compile(schema: object): ValidateFunction {
	let v = compiled.get(schema)
	if (!v) {
		v = ajv.compile(schema)
		compiled.set(schema, v)
	}
	return v
}

// Pull the JSON value out of a planner's raw output: a fenced ```json block if present, else the first
// top-level array or object in the text. Returns undefined when nothing parses.
function extractJsonValue(text: string): unknown {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
	const body = (fenced?.[1] ?? text).trim()
	const candidates = [body]
	const ai = body.indexOf("[")
	const aj = body.lastIndexOf("]")
	if (ai >= 0 && aj > ai) candidates.push(body.slice(ai, aj + 1))
	const oi = body.indexOf("{")
	const oj = body.lastIndexOf("}")
	if (oi >= 0 && oj > oi) candidates.push(body.slice(oi, oj + 1))
	for (const c of candidates) {
		try {
			return JSON.parse(c)
		} catch {
			// try the next candidate
		}
	}
	return undefined
}

// Turn an ajv error into a line the producer can act on: the path, and for the two failures that matter
// most here (a dropped required field, a value outside the palette) the specific field/allowed values.
function describe(e: NonNullable<ValidateFunction["errors"]>[number]): string {
	const path = e.instancePath || "(root)"
	if (e.keyword === "required") return `${path}: missing required field "${(e.params as { missingProperty: string }).missingProperty}"`
	if (e.keyword === "enum") return `${path}: must be one of ${JSON.stringify((e.params as { allowedValues: unknown[] }).allowedValues)}`
	if (e.keyword === "additionalProperties") return `${path}: unexpected field "${(e.params as { additionalProperty: string }).additionalProperty}"`
	return `${path}: ${e.message ?? "invalid"}`
}

export function validateJsonArtifact(text: string, schema: object): ConformanceResult {
	const value = extractJsonValue(text)
	if (value === undefined) return { ok: false, errors: ["output is not valid JSON (no parseable JSON array/object found)"] }
	const validate = compile(schema)
	if (validate(value)) return { ok: true, errors: [] }
	return { ok: false, errors: (validate.errors ?? []).map(describe) }
}
