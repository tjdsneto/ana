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
#                            [--voice-engine kokoro|piper] [--skip-voice]
#
# Env: KOKORO_HOME (Kokoro model), CHROME_PATH (optional). Needs the craft/tools node deps (playwright)
# and a Kokoro venv python. Run from the repo root.

set -euo pipefail

F="${1:?make-film: film dir required (holds film.json + script.txt)}"; shift || true
OUT="$F/film.mp4"; FPS=30; MUSIC=""; SKIP_CAPTURE=0; SKIP_VOICE=0; VOICE_ENGINE="kokoro"
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --fps) FPS="$2"; shift 2 ;;
    --music) MUSIC="$2"; shift 2 ;;
    --skip-capture) SKIP_CAPTURE=1; shift ;;
    --skip-voice) SKIP_VOICE=1; shift ;;            # VO already produced by the voice-production skill
    --voice-engine) VOICE_ENGINE="$2"; shift 2 ;;   # kokoro (default) | piper — the voice-production skill picks
    *) echo "make-film: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

[ -f "$F/film.json" ] && [ -f "$F/script.txt" ] || { echo "make-film: $F needs film.json + script.txt" >&2; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"            # craft/tools
PY="${KOKORO_PY:-$HOME/.local/share/kokoro-onnx/venv/bin/python}"
[ -x "$PY" ] || { echo "make-film: Kokoro venv python not found at $PY (set KOKORO_PY)" >&2; exit 3; }

echo "make-film: $F"
if [ "$SKIP_CAPTURE" -eq 0 ]; then
  echo "  [1/5] capture"; ( cd "$HERE" && node site-capture.mjs --spec "$F/film.json" --out "$F" )
else
  echo "  [1/5] capture (skipped)"
fi
if [ "$SKIP_VOICE" -eq 0 ]; then
  echo "  [2/5] voice ($VOICE_ENGINE)";  "$PY" "$HERE/vo.py" --script "$F/script.txt" --film "$F/film.json" --out "$F/media" --engine "$VOICE_ENGINE"
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
echo "make-film: done -> $OUT"
