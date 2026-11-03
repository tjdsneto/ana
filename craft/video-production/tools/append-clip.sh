#!/usr/bin/env bash
#
# append-clip — concatenate a tail clip onto a rendered film, seamlessly.
#
# A craft TOOL (not engine code): the render skill calls it when a film.json declares a `tail_clip`
# — e.g. an explainer that ends by playing the very video it just described ("...and here's what it
# produced"). Both inputs are normalised to 1920x1080 / <fps> / 48k-stereo and re-encoded, so the join
# is clean regardless of small codec/timebase/aspect differences between the two sources.
#
#   craft/video-production/tools/append-clip.sh <base.mp4> <tail.mp4> <out.mp4> [--fps 30]
#
# Needs ffmpeg on PATH. Writes <out.mp4> (never overwrites base in place).

set -euo pipefail

BASE="${1:?append-clip: base mp4 required}"
TAIL="${2:?append-clip: tail mp4 required}"
OUT="${3:?append-clip: out mp4 required}"
shift 3 || true
FPS=30
while [ $# -gt 0 ]; do
  case "$1" in
    --fps) FPS="$2"; shift 2 ;;
    *) echo "append-clip: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

[ -f "$BASE" ] || { echo "append-clip: base not found: $BASE" >&2; exit 2; }
[ -f "$TAIL" ] || { echo "append-clip: tail not found: $TAIL" >&2; exit 2; }
[ "$BASE" = "$OUT" ] && { echo "append-clip: out must differ from base" >&2; exit 2; }

# Normalise both streams (scale+pad to 1920x1080, fixed fps, 48k stereo) then concat. Re-encode so a
# mismatched timebase/sar/sample-rate can't corrupt the join.
ffmpeg -y -i "$BASE" -i "$TAIL" -filter_complex "\
[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1:color=black,setsar=1,fps=${FPS}[v0];\
[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1:color=black,setsar=1,fps=${FPS}[v1];\
[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a0];\
[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a1];\
[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" -c:v libx264 -pix_fmt yuv420p -r "${FPS}" -c:a aac -b:a 192k "$OUT" \
  >/dev/null 2>&1

[ -f "$OUT" ] || { echo "append-clip: ffmpeg produced no output" >&2; exit 3; }
echo "append-clip: done -> $OUT"
