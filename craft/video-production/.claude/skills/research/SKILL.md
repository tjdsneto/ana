---
name: research
description: Explore and capture the SUBJECT of a video before any writing — screenshot and probe the real site/app, dig the web for context, and emit a research dossier that tags every fact verified vs. unverified. Grounds the script so it can only claim what is actually true. Runs after briefing, before brainstorm/script.
---

# research

You explore the **subject** of the video and produce a **research dossier** the downstream steps write against. Writing a script before knowing the subject is how a video ends up narrating things the real UI contradicts ("reviews ran on Sonnet" over a Haiku row, a "30M+" claim that the page never shows). You prevent that at the source: the script may assert as fact **only** what you verified.

## Hold to the craft bar

Before researching, read `craft/video-production/docs/CRAFT-BAR.md`: apply **§A (universal taste)** in full, plus the **§B profile** matching this video's type. Your dossier must give downstream steps the raw material to meet both.

## What you produce

A markdown dossier (this node's deliverable). No video, no script — just grounded knowledge + captured assets.

## Steps

1. **Identify the subject** from the brief — the product/site/app the video is about, and the audience.
2. **Capture the subject (if one is provided).** Screenshot the real site/app and probe its structure with site-capture, so downstream steps reuse real pixels + real selectors instead of guessing:
   ```
   node craft/video-production/tools/site-capture.mjs --spec /tmp/research-probe.json --out <workDir>/subject
   ```
   with `/tmp/research-probe.json` = `{"capture":{"width":1440},"plates":{"subject":{"url":"<provided URL>","steps":[{"wait":3000}]}},"marks":{"<key>":"<css selector>"}}`. Read `<workDir>/subject/assets/shots/subject.jpg` and note `_h` + the resolved mark rects from `src/shots.json`. **Record the exact selectors** for the elements a video would frame — the storyboard will `focus` on these marks instead of guessing pixels. Research shots are **evidence** — capture them faithfully and do **not** apply shot makeup here; they must stay an honest record of what the product really shows. Makeup (cleaning, focusing, restyling, gen-AI) is a **production-shot** concern, applied later when `build-assets` / the Family-A capture frame a plate for camera — see the `capture-site` skill's **Shot makeup**.
3. **Read the real content.** From the capture, record the subject's real copy, product/section names, and any real numbers/stats that appear **on screen**. These are VERIFIED facts.
4. **Dig the web (open-ended) for context.** Search and read freely — the subject's own pages, background, positioning, whatever helps brainstorm and script. This is context, not ground truth: a web-sourced claim is **UNVERIFIED** unless you corroborated it against the captured subject.
5. **Emit the dossier** (below).

## Secure the proof beat's raw material

The craft bar requires a **capability-proof beat** carrying one **legible hero number/receipt** (§A1/A2). Make sure the dossier captures what that beat will need: the **capability-proof artifact or flow** (the real result/output/receipt the video will show the subject actually doing) and the **single strongest hero number/receipt**, captured legibly — screenshot the element large enough to read and record its mark selector so the storyboard can `focus` on it. If the subject exposes no such number, flag it as an open question rather than letting brainstorm/script invent one.

## Capture rule

Web research **reads** pages freely. Only the **provided subject** site is **captured as plates** for the video. Never install or host a product to capture it; capture only what was provided or is publicly the subject.

## Verified vs. unverified (the guardrail that makes research worth it)

Tag **every** fact in the dossier:
- **VERIFIED** — observed in the captured subject (on screen) or probed from its DOM. The script MAY state these as fact.
- **UNVERIFIED** — from the web or inference, not corroborated against the subject. The script must NOT state these as fact; they are context/ideas only.

## Depth lever

Honor the node's research-depth lever when set: **shallow** when the brief already fully specifies the subject (a quick pass-through dossier — the subject + the few facts the brief gives); **deep** when there is a rich real subject (full capture + selectors + web context). Don't over-research a trivial video.

## Dossier shape

```
# Research — <subject>

## Subject & audience
<what the video is about; who it's for>

## Captured assets
- Plate: <path to subject.jpg>, page height _h=<n>
- Marks (reuse as storyboard `focus` targets): `<key>` = `<css selector>` — <what it frames>
  ...

## Verified facts (script MAY assert as fact)
- [VERIFIED] <fact> — <where observed: on-screen / DOM>
  ...

## Context (UNVERIFIED — not for factual claims)
- [UNVERIFIED] <claim> — <web source>
  ...

## Open questions
- <anything a concept might need that isn't yet known — brainstorm can re-call research to gather it>
```

## Output

Output only the dossier markdown. It becomes the grounded input for brainstorm (concepts), script (claims), and storyboard (focus marks).
