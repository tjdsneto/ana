# Review rubric — build-soundtrack / craft (quality axis)

Loaded by the generic `review-craft` reviewer when judging a `build-soundtrack` deliverable. The generic reviewer owns the ship-test framing, the VERDICT mechanics, and the §A3 tell-cluster count; this file is ONLY the build-soundtrack-specific craft rubric.

You review the **build-soundtrack** leaf against §A5 (Sound). A subagent cannot listen, so **do not judge whether the music sounds good or fits the vibe** — judge the plan the mix depends on: are the tracks declared, does the music resolve, are there SFX on the key beats, is there no dead tail, is the loudness at target. You cannot HEAR the mix, but the plan + files let you check mechanically that §A5's structure is met: a ducked music bed present, deliberate SFX on the key beats (not bare VO + bed), no dead tail, and the master at −14 LUFS. The one near-subjective check allowed is that the plan's intent matches the moodboard's stated tone (text vs text), never the sound itself.

**Pass by default. Only `revise` on a specific, fixable fault below.**

## Inputs

- The producer's output: the music asset path(s) + the `audio` plan (the voice / music / sfx tracks, with `at`, `gain`, `duck`).
- The approved **moodboard** (upstream) — its stated tone, for the text-vs-text intent check only.

## Steps

1. The plan declares the tracks the mix needs: at least a `voice` track, and a `music` track IF the moodboard/brief calls for music. Missing a required track → `revise` (`FAIL: no <track> track declared`).
2. Each `music` entry has a `src`, a `gain` (dB), and `duck` set; levels are plausible (music gain below 0 dB, ducked under the voice) → ok; a `src` that names a file that does not exist AND is not a precise keyless spec (generator + prompt + params) → `revise` (`FAIL: music src unresolved and not specified`).
3. **SFX on the key beats (§A5).** The plan carries deliberate SFX (from `mix.py`'s timeline-derived cues and/or explicit `sfx` entries) on the signature beats — cuts, reveals, the hero number, the CTA. A soundtrack that is **bare VO + music bed with no SFX** on those beats → `revise` (`FAIL: no SFX on key beats (bare VO + bed)`). When a `film.json` is present, check its real `audio.sfx` (not only the plan text) — an absent/empty `audio.sfx` means the render uses `build.py`'s 3 generic defaults, so the planned cues never ship → `revise` (`FAIL: film.json audio.sfx missing cues on key beats`).
4. **Instrumental bed (§A5).** The music is instrumental — no singing, lyrics, rap, vocal hook, or spoken words competing with the VO. You can't hear it, so check the request/spec: a `generate:` prompt must contain *instrumental / no vocals* (a prompt with none, or one naming a song/singer/"feat."/vocal genre, is suspect); a `stock:` fetch must not use `--allow-vocals`; a `library:`/`PATH` src whose name or manifest `mood`/tags say vocal/vocals/song/lyrics/acappella → treat as vocal. A bed that is or is likely vocal (and the video has a VO) → `revise` (`FAIL: music bed is vocal (competes with the VO) — require instrumental`). The lone exception: the brief explicitly asks for a sung bed over no voiceover.
5. **No dead tail (§A5).** The music/mix does not run on under a dead end card: the last `music` stop (its `start` + duration, or an explicit stop/`clear`) is at/near the last beat, and any master file's duration is not materially longer than the VO's last word. A long trailing bed/silence → `revise` (`FAIL: dead tail (music/mix runs Ns past the last beat)`).
6. **Master loudness at target.** If a real master/music file exists, its loudness is at the mix target of **−14 LUFS** (`mix.py`'s default), not silent and not clipping — check with ffmpeg if available (`loudnorm=print_format=json`); skip if only a keyless spec. Silent, clipping, or well off −14 LUFS → `revise` (`FAIL: loudness off target (−14 LUFS)`).
7. The plan's stated intent (e.g. "calm ambient bed") is not contradicting the moodboard's tone → ok; a direct contradiction → `revise` (`FAIL: plan contradicts moodboard tone`). Do NOT revise because you can't confirm it "sounds right" — you can't hear it.

On revise, emit each `FAIL:` line verbatim. No opinion on the sound itself.

Build on: `../a5-sound.md` (the sound bar this soundtrack is judged against). Reference rather than restate.
