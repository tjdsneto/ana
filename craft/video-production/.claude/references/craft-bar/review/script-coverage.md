# Review rubric — script / coverage (conformance axis)

Loaded by the generic `review-conformance` reviewer when judging a `script` deliverable. The generic reviewer owns the ship-test framing and the VERDICT mechanics; this file is ONLY the script-specific coverage rubric.

Does the script match what was asked? Do **not** judge writing quality here (that is the quality reviewer's axis); check the script against the **brief** and the **approved upstream work** you were given. A dull-but-complete script still passes here. (Axis note: the §A3 visual-slop cluster and `COMPOSED-CARDS.md` are not a script's axis — this is a coverage check against the brief + §B, not a visual-craft gate.)

The script arrives as a JSON object `{"script": ["line one", "line two", …]}` — one spoken line per entry; it is the film.json `script` slice. Entries may carry inline audio tags (e.g. `[excited]`, `[warm]`) — TTS performance cues, not spoken words; ignore them when checking coverage/wording.

Check every sent param made it in:

- **Messages.** Every point the brief asks the video to make is present. None dropped, none invented beyond the brief/upstream.
- **Named things.** Required product names, feature names, offers, URLs, or CTAs from the brief appear, spelled as given.
- **Call to action / close (per the brief + the §B profile).** Check the close the video's **type** needs (§B) is present and matches the **brief's asks**: a B-launch's explicit CTA (the exact action + destination the brief named), a B-demo's next-step, a B-teaser's deferred tease ("Coming <when>"), a B-explainer's learn-more. Any CTA/action/URL the brief names appears, spelled as given. (Quality judges whether the close is strong; you judge whether it matches what was asked.)
- **Tone.** Matches the tone the brief set (e.g. upbeat/friendly vs. formal). A tonal mismatch is a conformance miss, not just a quality one.
- **Length constraint.** If the brief fixes a duration, the script fits it.

On revise, name each missing or mismatched param (what the brief asked, what the script did instead).

Build on: `../deliverable-script.md` if it exists (it exists for: script, moodboard) and the matching §B profile. Reference rather than restate.
