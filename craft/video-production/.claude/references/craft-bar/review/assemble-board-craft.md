# Review rubric — assemble-board / craft (quality axis)

Loaded by the generic `review-craft` reviewer when judging an `assemble-board` deliverable. The generic reviewer owns the ship-test framing, the VERDICT mechanics, and the §A3 tell-cluster count; this file is ONLY the assemble-board-specific craft rubric.

You judge the **whole assembled board** (the composed/card lane's `film.json` + the cards it stitched) on the **board-level craft that no per-card reviewer can see**: a card reviewer judges one card in isolation (its safe area, its font, its one accent) and passes it on its own merits — but it cannot see whether all the cards together read as one varied, signature-bearing film or as a repetitive, flat slideshow. That whole-board view is the structural hole this gate fills. You do **not** re-judge a single card's internal craft (the card quality reviewer did that), and you do **not** check brief/script coverage (conformance) or moodboard match (consistency). Judge the board as a sequence.

## Visual review (required) — judge the board, not the JSON

A verdict given without looking at the rendered board is invalid. Render it yourself (independent of the producer) and look at every card side by side. The board artifact is the assembled `film.json` (under the shared board dir, often `<boardDir>/film.json`). Materialize it into a scratch dir as `film.json`, then:

```
node craft/video-production/tools/site-capture.mjs --spec <workDir>/film.json --out <workDir>   # screenshots every plate (incl. inline data-URL composed cards)
python3 craft/video-production/tools/storyboard-board.py --root <workDir>
```

Open `<workDir>/board/sheet.jpg` — one card per beat, in playback order, each beside its VO line. Read the **sheet as a whole**: this is the only view where the board's variety, repetition, colour rhythm, and signature become visible. The per-card failures that slip past single-card review all show up here.

## Rubric — the whole-board §A1 properties

1. **Every beat is visually distinct — no slideshow (§A1).** Scan the sheet for near-duplicate beats: the same card held across 3–4 beats with only a slow zoom, a line repeated over the same frame, two beats that would read as one still. Near-duplicates are padding → revise. Name the duplicated beats and say which to cut or re-frame. A frozen sparse end card held for seconds is the worst offender.
2. **Is there a signature move at all (§A1)?** Every memorable video has ONE device that is unmistakably this product's — a recurring motif, a tempo break, a bespoke transition (COMPOSED-CARDS §4 lists concrete moves). Across the whole board, find it. **A board with no signature is a revise, however clean each card is** — name a candidate move sourced to the brand and say where to place it. Do not accept "every card is individually fine" as a substitute for a signature.
3. **Colour-per-beat variety (COMPOSED-CARDS §3).** The change of flat ground colour between sections is what carries motion and segments the story in this lane. If beat after beat sits on the same ground (or drifts into gradients), the board reads monotone → revise: assign each section its own flat, saturated ground so the colour IS the cut. (Variety here is a board property; a single card can't show it.)
4. **Hero-number own-card allocation (§A1/§A2).** Across the board, does the single strongest number/receipt get its **OWN full-frame beat**, not a footnote sharing a busy frame? If the board has a hero metric but no beat is allocated to it alone, that's a revise — say which number, and to give it its own card. (If the type has no such number — see §B — don't invent one.)
5. **Motion = a sequence of plates, not one animated card (COMPOSED-CARDS §3).** The render screenshots each plate as a still, so in-card CSS animation is NOT captured — motion must come from the camera and from SEQUENCING plates. Check that reveals are expressed as successive plates (empty → half → full as separate beats), a morphing element as one plate per state, not a single end-state plate the camera drifts over (which spoils the payoff and reads static). A board that relies on animating one card = revise.
6. **§A5 sound is wired into the film.json, not just planned.** Read the film.json `audio` block (a JSON check — you are not judging how it sounds). It must carry a ducked `music` track and `sfx` cues on the signature beats the storyboard marked (a reveal, the hero number, the CTA). An **absent or empty `audio` block** means the render falls back to `build.py`'s 3 generic default cues, so the planned signature-beat sound never ships → revise (`FAIL:` name the marked beats whose cue is missing from `audio.sfx`). The storyboard planned the sound; this confirms `assemble-board` carried it into the artifact.

**Close per the §B profile.** The board ends on its last meaningful beat — a CTA for a B-launch, a deferred tease for a B-teaser, a next-step/resolve for a demo/explainer (§B). Flag a close that departs from the type's shape, and flag any dead static tail held for seconds (§A4). Do not demand a CTA where the type doesn't call for one.

On revise, name the offending beats (quote their grounds/ids), state the whole-board fault (the slideshow run, the missing signature, the monotone colour, the un-allocated hero number, the one-animated-card motion), and give the concrete change that raises it (the beat to cut, the signature move to add and where, the per-beat ground colours to assign, the number to give its own card, the reveal to split into plates). Judge only board-level craft; a board whose individual cards each pass but which reads as a repetitive, signature-less slideshow still fails here.

Build on: `../a1-frame.md`, `../a3-slop.md`, and `../deliverable-assemble-board.md` if it exists (it exists for: script, moodboard). Reference these slices rather than restating them.
