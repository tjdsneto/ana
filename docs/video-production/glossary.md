# Glossary — video production

Tool-agnostic definitions of the craft vocabulary. These are the general meanings as a video editor or motion designer uses them; they are not tied to our engine or any tool. (Where our pipeline wires these up as nodes/skills, that mapping lives in the engine specs, not here.)

## Timeline & structure

- **Timeline** — the master time axis of one video. Every picture and sound is placed on it at a start and end time. A timeline holds tracks.
- **Track** — a parallel lane on the timeline that carries clips, stacked with other tracks. Two kinds:
  - **Video track** — carries visual clips. When tracks overlap in time, the **higher track draws over the lower** — that stacking is what makes one clip a *layer* above another.
  - **Audio track** — carries sound clips. All audio tracks that overlap are **summed (mixed)** into the final sound.
- **Clip** — one time-bounded item on a track: it has a start/end on the timeline, points at a **source (asset)**, trims an in/out range from that source, and may carry effects. A video clip also has a **transform** (where/how big in the frame); an audio clip has a **level (gain)**.
- **Scene** — a contiguous section of the timeline: one narrative beat (the hook, a feature, the close). A scene groups the clips and layers that play together during its span. A finished video is a **sequence of scenes**, whatever its style.
- **Shot** — a single uninterrupted run of "camera" on one subject. A scene is built from one or more shots.
- **Beat** — a unit of story/rhythm; often one line of narration and the picture under it. Beats drive where cuts land.

## Picture

- **Asset (source / media)** — a produced or captured source file a clip points to (one asset can feed many clips). Examples: a still image, a captured screen, a generated clip, a music file.
- **Plate** — a single still image of a real interface (one screen, state, or region), used as source for a shot.
- **Screen capture / screencast** — recording (or stilling) a real application's screen as source material. One capture session can yield **many** stills/recordings.
- **B-roll** — supplementary footage cut over the main subject or narration (mood, context, texture).
- **Compositing** — combining several visual layers into one frame (a character over a UI, a caption over footage). The **composite** is the finished frame.
- **Layer** — a visual element stacked above the base picture in the composite (a logo, a caption, a presenter window). Mechanically, a clip on a higher video track.
- **Picture-in-picture (PiP)** — a smaller video inset over a larger one (e.g. a presenter in the corner over a product screen).
- **Lower-third** — a caption/graphic in the lower portion of the frame (name, title, label).
- **Caption / subtitle** — on-screen text of the spoken words or a short label; **karaoke caption** highlights each word/phrase as it is said.
- **Title card / end card** — a full-frame text card opening or closing the video; the end card usually carries the **CTA** (call to action).
- **Motion graphics** — animated text/shapes/illustration (as opposed to filmed or captured footage).

## Camera & framing

- **Framing / shot size** — how much of the subject the frame holds: **ECU** (extreme close-up), **CU** (close-up), **MS** (medium), **WS** (wide). Tighter framing = more emphasis.
- **Camera move** — **pan** (rotate horizontally), **tilt** (vertically), **zoom** (lens in/out), **push-in / dolly** (move toward), **truck** (move sideways).
- **Ken Burns** — the move-and-zoom over a still image that fakes camera motion on a static picture.
- **Keyframe** — a marked value (position, scale, opacity) at a specific time; the software interpolates between keyframes to animate.

## Sound

- **Voiceover (VO) / narration** — spoken narration recorded or synthesized, usually the spine the rest of the video is timed to.
- **Word-level timing / forced alignment** — resolving exactly when each spoken word occurs, so cuts, captions, and effects can be anchored to a word rather than a guessed second.
- **Soundtrack / score / music bed** — background music under the video.
- **Sound effect (SFX)** — a short, specific sound tied to an action (whoosh, click, pop). **Foley** = everyday sounds performed/recorded for picture.
- **Ducking** — automatically lowering the music when narration plays, so the voice stays clear.
- **Mix** — balancing all audio tracks into the final sound. **Master** — the final level/dynamics pass. **LUFS** — the loudness unit targets are set in (e.g. −14 LUFS for web).

## Effects & transitions

- **Visual effect (VFX)** — any modification of a clip's picture: an **authored transform** (move/scale/opacity over time), a **filter** (blur, colour grade), or a **transition**.
- **Transition** — how one clip/scene gives way to the next: **cut** (instant), **dissolve/crossfade** (blend), **wipe** (one pushes the other off), **match-cut** (cut on a visual/graphic match).

## Delivery

- **Aspect ratio** — frame shape: **16:9** (landscape/hero), **9:16** (vertical/social), **1:1** (square). Choose by where it plays.
- **Frame rate (fps)** — frames per second (commonly 24/30/60).
- **Render** — producing the final video by evaluating the timeline frame by frame (compositing the picture, mixing the sound) and writing out a file.
- **Encode / codec / container** — compressing the rendered frames+audio (codec, e.g. H.264) into a file format (container, e.g. MP4).

## Pre-production

- **Brief** — the request and its constraints (goal, audience, tone, length, must-say messages).
- **Moodboard** — the visual direction: palette, type, imagery, motion feel.
- **Storyboard** — the shot-by-shot plan: what each beat frames, the narration under it, timing, transitions.
- **Hook** — the opening seconds that earn the rest of the video.
- **Pacing** — the rhythm of cuts and beats; too slow drags, too fast loses the viewer.

---

Related (engine-specific, not generic): how our pipeline names and produces these — the realization methods, the build/assemble stages, the timeline-document schema — lives in the engine specs, not in this reference.
