// Mirror of @core/shared Template (the app package has no shared dep). Keep in sync with
// shared/src/catalog.ts and the committed catalog.json.
export type TemplateTier = "north-star" | "launch-reel" | "exemplar-public" | "tutorial" | "reference"
export type AutonomyLever = "low" | "medium" | "high"
export interface TemplateBeat { t: string; job: string; whatHappens: string; onScreen?: string; landsOn?: string }
export interface TemplateScore { check: string; verdict: "pass" | "partial" | "fail" | "na"; note: string }
export interface Template {
	slug: string; title: string; creator: string; product: string; tier: TemplateTier; tags: string[]
	posterPath: string; videoPath: string; durationSec: number; aspect: string
	oneIdea: string; hook: string; cta: string; summary: string; whyItWorks: string
	tools: string[]; look: string; storyboard: TemplateBeat[]; remakePrompts: string[]; scorecard: TemplateScore[]
}
