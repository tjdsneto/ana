// StubRenderClient — the v0 render adapter: writes a text placeholder instead of calling a real
// render engine, at zero cost. Swapped for a real RenderClient when engine keys land (pending
// Angie). Satisfies the RenderClient port, so the loop is unchanged when it is replaced.

import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import type { RenderClient, RenderInput, RenderResult } from "@core/shared"

export class StubRenderClient implements RenderClient {
	async render(input: RenderInput): Promise<RenderResult> {
		const artifactPath = join(input.outDir, `${input.kind}-stub-${randomUUID().slice(0, 8)}.txt`)
		writeFileSync(artifactPath, `[stub render: ${input.kind}]\nspec: ${JSON.stringify(input.spec)}\n`, "utf8")
		return { artifactPath, costEstimate: 0 }
	}
}
