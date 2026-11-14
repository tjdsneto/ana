import type { Template } from "@core/shared"

// Render a template's dissection + the user's product/angle into the single free-text brief the
// craft reasons from (the craft ignores structured params — see the design spec §3.4).
//
// The format (launch reel, tutorial, demo, …) is NOT hardcoded: the catalog spans every tier, so the
// reference's own one-idea + structure carry the format. Sparse dissections (some references have no
// hook/cta/storyboard) omit that line rather than emit a blank "in the spirit of:".
export function composeBriefFromTemplate(t: Template, input: { productName: string; angle: string }): string {
	const paras: string[] = []

	paras.push(`Produce a ${t.aspect}, ~${Math.round(t.durationSec)}s video for "${input.productName}".`)

	const framing = [`Model it on a proven reference: "${t.title}" by ${t.creator} (originally for ${t.product}).`]
	if (t.oneIdea?.trim()) framing.push(`The one idea that made the reference work: ${t.oneIdea.trim()}`)
	if (t.hook?.trim()) framing.push(`Open with a hook in the spirit of: ${t.hook.trim()}`)
	if (t.cta?.trim()) framing.push(`Close on a CTA in the spirit of: ${t.cta.trim()}`)
	paras.push(framing.join("\n"))

	// Only beats with the three required fields; a malformed beat is dropped rather than interpolated
	// into the literal string "undefined" (the catalog is trusted, but a hand-crafted POST is not).
	const beatsClean = t.storyboard.filter((b) => b?.t && b?.job && b?.whatHappens)
	if (beatsClean.length) {
		const beats = beatsClean
			.map((b, i) => `${i + 1}. (${b.t}) ${b.job} — ${b.whatHappens}${b.onScreen ? ` [on-screen: ${b.onScreen}]` : ""}`)
			.join("\n")
		paras.push(`Structure to mirror, beat by beat:\n${beats}`)
	}

	const craft: string[] = []
	if (t.look?.trim()) craft.push(`Look & feel to match: ${t.look.trim()}`)
	if (t.whyItWorks?.trim()) craft.push(`Preserve what makes the reference strong: ${t.whyItWorks.trim()}`)
	if (craft.length) paras.push(craft.join("\n"))

	paras.push(`Now adapt ALL of the above to "${input.productName}". The angle to carry over:\n${input.angle}`)

	return paras.join("\n\n")
}
