#!/usr/bin/env bash
#
# make-film — run the whole Family-A chain over one film directory, end to end.
#
# A convenience driver the render skill (or a worker) calls instead of the five tools by hand:
#   capture (real UI) -> vo (word-timed VO) -> build (GSAP HTML) -> mix (SFX + master) -> render (MP4).
# The film dir must already hold film.json + script.txt (+ captures/ if plates use saved HTML).
# Self-check (critique-video) is the caller's job afterward — see the family-a-film skill.
#
#   craft/tools/make-film.sh <film-dir> [--out <mp4>] [--fps 30] [--music <file>] [--skip-capture]
#                            [--voice-engine kokoro|piper] [--skip-voice] [--audio-clip <file>]
#                            [--captions] [--caption-style karaoke|block] [--no-captions]
#
# Two optional film.json fields extend the chain (both auto-detected; the flags override):
#   "audio":    a path to an EXTERNAL voice clip (human take / avatar / cinematic render). When set, the
#               voice step word-times that clip (align.py) and uses its audio as the narration instead
#               of synthesizing TTS. Relative paths resolve against the film dir. Flag: --audio-clip.
#   "captions": burn word-timed captions onto the render (captions.py). true / "karaoke" / "block" / an
#               object of overrides. Absent -> no captions. Flags: --captions (force on), --no-captions.
#
# Env: KOKORO_HOME (Kokoro model), CHROME_PATH (optional). Needs the craft/tools node deps (playwright)
# and a Kokoro venv python. Run from the repo root.

set -euo pipefail

F="${1:?make-film: film dir required (holds film.json + script.txt)}"; shift || true
OUT="$F/film.mp4"; FPS=30; MUSIC=""; SKIP_CAPTURE=0; SKIP_VOICE=0; VOICE_ENGINE="kokoro"
AUDIO_CLIP=""; CAPTIONS="auto"; CAPTION_STYLE=""        # CAPTIONS: auto (film.json decides) | on | off
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --fps) FPS="$2"; shift 2 ;;
    --music) MUSIC="$2"; shift 2 ;;
    --skip-capture) SKIP_CAPTURE=1; shift ;;
    --skip-voice) SKIP_VOICE=1; shift ;;            # VO already produced by the voice-production skill
    --voice-engine) VOICE_ENGINE="$2"; shift 2 ;;   # kokoro (default) | piper — the voice-production skill picks
    --audio-clip) AUDIO_CLIP="$2"; shift 2 ;;       # external voice clip -> align.py (overrides film.json `audio`)
    --captions) CAPTIONS="on"; shift ;;             # force caption burn even without a film.json `captions` field
    --no-captions) CAPTIONS="off"; shift ;;         # suppress captions even if film.json asks for them
    --caption-style) CAPTION_STYLE="$2"; shift 2 ;; # karaoke | block (overrides film.json)
    *) echo "make-film: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

[ -f "$F/film.json" ] && [ -f "$F/script.txt" ] || { echo "make-film: $F needs film.json + script.txt" >&2; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"            # craft/tools
PY="${KOKORO_PY:-$HOME/.local/share/kokoro-onnx/venv/bin/python}"
[ -x "$PY" ] || { echo "make-film: Kokoro venv python not found at $PY (set KOKORO_PY)" >&2; exit 3; }

# Use whichever TTS engine is actually present. Kokoro needs its model; a piper-only host (e.g. the
# engine container) has none, so fall back to piper instead of hard-failing the voice step. A host
# with the kokoro model keeps kokoro.
KOKORO_HOME_DIR="${KOKORO_HOME:-$HOME/.local/share/kokoro-onnx}"
if [ "$VOICE_ENGINE" = "kokoro" ] && [ ! -f "$KOKORO_HOME_DIR/kokoro-v1.0.onnx" ]; then
  echo "make-film: kokoro model not found under $KOKORO_HOME_DIR — falling back to piper" >&2
  VOICE_ENGINE=piper
fi

echo "make-film: $F"
if [ "$SKIP_CAPTURE" -eq 0 ]; then
  echo "  [1/5] capture"; ( cd "$HERE" && node site-capture.mjs --spec "$F/film.json" --out "$F" )
else
  echo "  [1/5] capture (skipped)"
fi
if [ "$SKIP_VOICE" -eq 0 ]; then
  # External voice clip? --audio-clip wins; else film.json's `audio` field (resolved against the film dir).
  if [ -z "$AUDIO_CLIP" ]; then
    AUDIO_CLIP="$(python3 -c 'import json,os,sys; d=json.load(open(sys.argv[1])); a=(d.get("audio") or "").strip(); print(a if (not a or os.path.isabs(a)) else os.path.join(sys.argv[2], a))' "$F/film.json" "$F")"
  fi
  if [ -n "$AUDIO_CLIP" ]; then
    # Narration comes from a real clip, not TTS: align.py word-times it (verbatim to script.txt when present)
    # into media/words.json, and its own audio becomes media/vo.wav so build/mix/render are unchanged.
    [ -f "$AUDIO_CLIP" ] || { echo "make-film: external audio clip not found: $AUDIO_CLIP" >&2; exit 3; }
    echo "  [2/5] voice (external clip -> align): $AUDIO_CLIP"
    mkdir -p "$F/media"
    if [ -f "$F/script.txt" ]; then
      "$PY" "$HERE/align.py" --in "$AUDIO_CLIP" --script "$F/script.txt" --out "$F/media"
    else
      "$PY" "$HERE/align.py" --in "$AUDIO_CLIP" --out "$F/media"
    fi
    ffmpeg -v error -y -i "$AUDIO_CLIP" -vn -ar 48000 -ac 1 "$F/media/vo.wav"
  else
    echo "  [2/5] voice ($VOICE_ENGINE)";  "$PY" "$HERE/vo.py" --script "$F/script.txt" --film "$F/film.json" --out "$F/media" --engine "$VOICE_ENGINE"
  fi
else
  echo "  [2/5] voice (skipped — produced by voice-production)"
fi
echo "  [3/5] build";  python3 "$HERE/build.py" --root "$F"
# Resolve music: an explicit --music wins; otherwise film.json's `music` field via music.py, which
# prints a path (library pick / BYO / generated) or nothing. Guarded: no `music` field -> unchanged.
if [ -z "$MUSIC" ] && grep -q '"music"' "$F/film.json"; then
  MUSIC="$(python3 "$HERE/music.py" --film "$F/film.json" --words "$F/media/words.json" --out "$F/media" 2>/dev/null)" || MUSIC=""
  [ -n "$MUSIC" ] && echo "  music -> $MUSIC"
fi
echo "  [4/5] mix";    "$PY" "$HERE/mix.py" --root "$F" ${MUSIC:+--music "$MUSIC"}
echo "  [5/5] render"; ( cd "$HERE" && node render.mjs --html "$F/index.html" --audio "$F/media/mix.wav" --out "$OUT" --fps "$FPS" --no-master )

# Captions (post-render, in place). Default: film.json's `captions` field decides (--captions forces on,
# --no-captions suppresses). captions.py --gated is a no-op when the field is absent/off, so the burn
# only re-encodes when captions are actually wanted.
if [ "$CAPTIONS" != "off" ] && [ -f "$F/media/words.json" ]; then
  CCEXTRA=""
  [ "$CAPTIONS" = "on" ] && CCEXTRA="$CCEXTRA --force-on"
  [ -n "$CAPTION_STYLE" ] && CCEXTRA="$CCEXTRA --style $CAPTION_STYLE"
  if python3 "$HERE/captions.py" --film "$F/film.json" --gated --in "$OUT" --words "$F/media/words.json" --out "$OUT" $CCEXTRA; then :; else
    echo "make-film: caption burn failed" >&2; exit 4
  fi
fi
echo "make-film: done -> $OUT"
