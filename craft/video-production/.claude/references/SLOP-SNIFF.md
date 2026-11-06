# SLOP-SNIFF — the AI-slop sniffer & remover (finished-cut pass)

CRAFT-BAR §A3 is the **per-frame** cluster test (a single plate's look). This is the **whole-cut** sweep: watch and listen to the assembled video end to end and catch the tells that only show up in motion and over time — then **remove** each by reopening the step that owns it (the engine's reopen IS the remover: it sends that step back to rebuild without the tell).

Run it as a dedicated pass — it is not optional polish. Sample frames at every beat boundary (`ffmpeg -ss <t> -i <mp4> -frames:v 1 …`) and sample the audio; a verdict formed without watching/listening is invalid.

## Sniff — the tells, how to spot them, and the step that removes each

| # | Tell (what slop looks/sounds like) | How to spot in the cut | REOPEN to remove |
|---|---|---|---|
| 1 | **Slideshow / flat motion** — plates under slow pans, nothing animating, beats hard-sit, no transitions | Frames at consecutive beat boundaries are near-identical held images; only the camera moved | `storyboard` or `scene[n]` — add a real motion verb + transition (MOTION-VOCAB) |
| 2 | **Default / mismatched font** — Inter, Roboto, Montserrat, Outfit, system-ui, a tier-2 default | Read the on-screen type; it's a generic geometric/grotesque, not the brand's sourced face | `moodboard` — the brand-sourced face |
| 3 | **§A3 cluster** — gradients everywhere, a card/rounded-rect for everything, one bright accent on near-black, hairline rules, emoji headings | Count the tells across the cut; **2+ = slop** | `moodboard` / `storyboard` — name the sourced swaps |
| 4 | **Generic stock-AI imagery** — could be any product; the swap test passes | Put another brand's name on the frame; if it still fits, it's generic | `moodboard` / `scene[n]` — ground it in the real product |
| 5 | **Vocal music bed** — singing / lyrics / rap under the voiceover | Listen under the VO for sung words competing | `build-soundtrack` — instrumental bed (§A5) |
| 6 | **Flat TTS + dead air** — robotic, even read; true silence in the gaps; no bed | The VO has no intonation shifts; gaps are dead-silent | `script` (add audio tags on the turns) + `build-soundtrack` (a ducked bed) |
| 7 | **Generative artifacts** — warping, morphing, extra fingers, watermark, uncanny avatar, lip-sync drift | Scrub a generated scene frame-by-frame | `scene[n]` — re-prompt / re-realize |
| 8 | **Dead tail / frozen end card** — several seconds of static hold after the last beat | The tail freezes; audio runs on under it | `polish` — trim to the last meaningful beat |
| 9 | **Hollow / templated script** — generic benefit-speak, no concrete proof or number, says nothing only this product could say | Read the VO; nothing is specific to the real product | `script` — a specific claim + the one real number/receipt |

## Threshold (consistent with §A3)

- **2+ distinct cut-level tells → `revise`.** Emit a `REOPEN:` for each, targeting the step from the table.
- **A single *severe* tell is a `revise` on its own:** a vocal bed under the VO (#5), slideshow throughout (#1), flat TTS with dead air (#6), or a generative artifact on a hero beat (#7). These read as slop even if everything else is clean.
- 0–1 minor tell and nothing severe → this axis passes.

The remove is not manual — name the owning step in a `REOPEN:` line and the engine rebuilds it without the tell. Be specific (one step per tell, the fanned unit `scene[n]` when it's one shot) so the reopen cascade stays tight.
