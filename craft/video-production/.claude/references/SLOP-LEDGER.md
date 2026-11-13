# Slop ledger — concrete mistakes this project has actually shipped

A **living record** of AI-slop tells and quality mistakes found in videos *this project produced* (not generic theory — real defects we hit), each with how to avoid it and which rule/step owns it. It exists so the same mistake is never shipped twice: the lessons from past teardowns are fed forward to the agents that would otherwise repeat them.

## Who reads this
- **Every producer** (moodboard, storyboard, script, build-card, build-scene, assemble-board, polish, motion-graphics) reads it before producing and checks their work against the open entries — a tell already here is a *known failure*, not a fresh judgment call.
- **Every reviewer** (the `review-*` skills and especially `final-review`) checks the deliverable against the open entries in addition to CRAFT-BAR.md. A deliverable that reproduces a ledger entry is a **revise**, citing the entry.

## Who appends (the feedback loop)
When `final-review` or `critique-video` (or a human) spots a slop tell / mistake in a produced cut that is **not already an entry**, add it here — this is part of the review, not optional. An entry is cheap and compounding: one sentence of "what it was, why it's slop, how to avoid" saves every future production from the same miss. Keep entries concrete and tied to a real occurrence. When a tell is structurally impossible to recur (a rule or check now forecloses it), mark it `[closed: <how>]` rather than deleting — the history is the point.

**Entry format:** `### <short tell name>` then — **Seen in:** <where> · **Why it's slop:** <one line> · **Avoid:** <the concrete fix> · **Enforced by:** <CRAFT-BAR §/skill/tool>.

---

## Open entries

### Mangled / forced wordplay in the spoken line
- **Seen in:** OptinMonster MCP cut — the open spoke "This is the Model— Monster Context Protocol," splicing the brand pun into the real term's expansion.
- **Why it's slop:** it reads as a mistake, not a joke — the viewer can't tell the acronym from the gag, and the hook (the one beat that must land instantly) becomes the most confusing one.
- **Avoid:** the **voiceover says the real term correctly** ("Model Context Protocol"); any brand wordplay is a **clearly-authored on-screen edit** (a visible strike-through + annotation), shown *after* the true term has landed, never spoken as a mangle.
- **Enforced by:** CRAFT-BAR §A4 (hook lands one idea), §A2 (grounding), review-script-quality, final-review.

### Rushed beats — content cut before it can be read
- **Seen in:** OptinMonster MCP cut — tool-trace count, scopes toggle, targeting rows and the copied-URL beat each landed and immediately cut; "almost not enough time to consume the information."
- **Why it's slop:** information-dense beats that don't hold read as a machine flipping slides, not a video made for a human to follow.
- **Avoid:** §A4 dwell — ≥1.5–2.0s settle on a single line/number, 2.5–3s on multi-row/number beats, *after* the reveal completes; grow the runtime or drop a beat rather than rushing; trim only genuine dead air.
- **Enforced by:** CRAFT-BAR §A4 (dwell), storyboard/plan-scenes beat timecodes, polish retime, review-polish-quality, review-scene-consistency, final-review.

### Vocal music bed under the voiceover
- **Seen in:** an OptinMonster MCP cut whose bed had singing/vocals over the VO.
- **Why it's slop:** two voices fight the same channel — an immediate stock/AI tell; the bed must support, not compete.
- **Avoid:** instrumental bed only, ducked under the VO. The `stock:` lane excludes vocal-tagged tracks by default (`-tag:vocals` …); `generate:` prompts must say *instrumental, no vocals*.
- **Enforced by:** CRAFT-BAR §A5, build-soundtrack, review-build-soundtrack, freesound tool default.

### Frame doesn't show what the line says (grounding miss)
- **Seen in:** general risk across cuts — a narrated number/step/section not actually visible on screen at that moment.
- **Why it's slop:** the video *claims* rather than *shows*; the strongest proof (the artifact on screen) is missing and the picture can even contradict the voice.
- **Avoid:** §A2 grounding — at every beat the frame depicts exactly what the VO names; picture and voice reviewed together against each other.
- **Enforced by:** CRAFT-BAR §A2, review-storyboard-quality (grounding), review-card-conformance, review-scene-quality, final-review Pass 2.

### Subject adrift in dead space / frame overloaded
- **Seen in:** OptinMonster MCP cuts — composed cards floating centered with large navy dead bands above/below; the copied-URL bar low in a mostly-empty frame.
- **Why it's slop:** a small subject in a big empty frame (or the opposite — a crammed frame with no focal route) reads as an unedited default layout, not a composed shot.
- **Avoid:** §A1 — one dominant subject filling ≥~50% of frame, a clear path of focus, breathing room (not clutter, not a void). Fix dead space by scaling the subject, not by filling it.
- **Enforced by:** CRAFT-BAR §A1, build-card, review-card-quality, review-scene-quality, review-storyboard-quality.

### Signature device dropped silently
- **Seen in:** earlier OptinMonster MCP cuts closed on type-only cards; the committed signature (the mascot + MCP shield) quietly vanished.
- **Why it's slop:** a video with no signature is forgettable; a *committed* signature that silently disappears is a worse, invisible regression.
- **Avoid:** the storyboard commits the signature; the board + final reviewers confirm it actually shipped in the frames. A missing committed signature is a revise, not a silent omission.
- **Enforced by:** CRAFT-BAR §A1 (one signature move), review-board-quality, final-review.

### Flat first-gen TTS with silent gaps
- **Seen in:** the two pre-ElevenLabs OptinMonster cuts — flat narration with true silence between lines.
- **Why it's slop:** bare first-gen TTS with no dynamics and dead gaps is an immediate AI tell.
- **Avoid:** expressive VO (ElevenLabs v4 + per-line audio tags) over a low ducked bed; never bare narration over silence.
- **Enforced by:** CRAFT-BAR §A5, voice-production, review-build-voice.

### Logo / title cold open
- **Why it's slop:** opening on a logo or generic title card is the measurably weakest hook; it wastes the first seconds that earn the rest.
- **Avoid:** open **in-product on one real high-stakes action**, a benefit/desire question, or the artifact materializing — never a brand card.
- **Enforced by:** CRAFT-BAR §A4 (hook), review-storyboard-quality, final-review.

### Dead static tail
- **Why it's slop:** several seconds of frozen end card after the last meaningful beat is padding and reads as a render that didn't know when to stop.
- **Avoid:** end on the last meaningful beat; the CTA holds readable but the piece doesn't sit frozen. No dead tail.
- **Enforced by:** CRAFT-BAR §A4/§A5, polish, review-render-audio (no dead tail), final-review.

### Unspecified default fonts
- **Why it's slop:** a type family not chosen *for this brand* (Inter, Roboto, Montserrat, Poppins, and the tier-2 set) is the single most reliable AI-look tell.
- **Avoid:** a declared, sourced brand face; a missing primary degrades to a declared substitute, never to a system default.
- **Enforced by:** CRAFT-BAR §A3, moodboard (font provisioning), review-moodboard-quality.
