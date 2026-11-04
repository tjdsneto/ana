import { expect, it } from "vitest"
import { parseProductionDag } from "./plan-dag.js"

it("parses a fenced stage DAG and resolves deps by id", () => {
	const out = parseProductionDag('```json\n{"stages":[{"id":"script","type":"script","deps":[]},{"id":"sb","type":"storyboard","deps":["script"]}]}\n```')
	expect(out.map((s) => s.type)).toEqual(["script", "storyboard"])
	expect(out[1]?.deps).toEqual(["script"])
})

it("rejects a stage whose dep is not an earlier stage id", () => {
	expect(() => parseProductionDag('```json\n{"stages":[{"id":"a","type":"script","deps":["ghost"]}]}\n```')).toThrow(/dep/)
})
