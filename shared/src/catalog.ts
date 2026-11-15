// The catalog record for one reference video promoted into the product as a template.
// A trimmed merge of the research manifest row + data/<slug>.json dissection. No brand names.
export type TemplateTier = "north-star" | "launch-reel" | "exemplar-public" | "tutorial" | "reference"

export interface TemplateBeat {
	t: string
	job: string
	whatHappens: string
	onScreen?: string
	landsOn?: string
}

export interface TemplateScore {
	check: string
	verdict: "pass" | "partial" | "fail" | "na"
	note: string
}

export interface Template {
	slug: string
	title: string
	creator: string
	product: string
	tier: TemplateTier
	tags: string[]
	posterPath: string // relative to /catalog/, e.g. "assets/<slug>.poster.jpg"
	videoPath: string // relative to /catalog/, e.g. "assets/<slug>.mp4"
	durationSec: number
	aspect: string
	oneIdea: string
	hook: string
	cta: string
	summary: string
	whyItWorks: string
	tools: string[]
	look: string
	storyboard: TemplateBeat[]
	remakePrompts: string[]
	scorecard: TemplateScore[]
}
