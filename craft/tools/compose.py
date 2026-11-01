#!/usr/bin/env python3
"""compose — apply audio to visuals: put a soundtrack under a video, or turn an image into a clip.

A craft tool (ffmpeg only, no numpy). The glue that lets a produced/fetched sound actually land on a
video or an image/asset — e.g. drop a generated bed under a silent render, or make a quick clip from a
still + a voiceover.

  python3 craft/tools/compose.py under --video clip.mp4 --audio bed.wav --out clip+bed.mp4 [--mode replace|mix]
  python3 craft/tools/compose.py still --image art.png --audio vo.wav --out art.mp4 [--fps 30]

- under: mux audio onto a video. replace (default) swaps the video's audio for the new track; mix blends
  the new track with the video's existing audio. Trimmed to the shorter stream (--pad holds the video
  on its last frame to the audio length instead).
- still: loop one image for the audio's length into an H.264/AAC mp4 (even dimensions, yuv420p).

Needs ffmpeg + ffprobe on PATH (libx264 + aac for `still`).
"""
import argparse
import subprocess
import sys
from pathlib import Path


def _run(cmd: list) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"compose: ffmpeg failed — {r.stderr.strip()[-400:]}")


def _need(p: str, what: str) -> Path:
    path = Path(p)
    if not path.exists():
        sys.exit(f"compose: {what} not found: {p}")
    return path


def cmd_under(a: argparse.Namespace) -> None:
    video, audio, out = _need(a.video, "video"), _need(a.audio, "audio"), Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    stop = [] if a.pad else ["-shortest"]
    if a.mode == "replace":
        # take video frames from input 0, audio from input 1
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(video), "-i", str(audio),
               "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", *stop, str(out)]
    else:  # mix: blend new track with the video's own audio
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(video), "-i", str(audio),
               "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=longest[a]",
               "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", *stop, str(out)]
    _run(cmd)
    print(f"compose under ({a.mode}): {out}")


def cmd_still(a: argparse.Namespace) -> None:
    image, audio, out = _need(a.image, "image"), _need(a.audio, "audio"), Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-y", "-loop", "1", "-i", str(image), "-i", str(audio),
           "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",  # yuv420p needs even dimensions
           "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-r", str(a.fps), "-shortest", str(out)]
    _run(cmd)
    print(f"compose still: {out}")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="apply audio to a video or an image")
    sub = p.add_subparsers(dest="cmd", required=True)

    u = sub.add_parser("under", help="put an audio track under a video")
    u.add_argument("--video", required=True)
    u.add_argument("--audio", required=True)
    u.add_argument("--out", required=True)
    u.add_argument("--mode", choices=("replace", "mix"), default="replace")
    u.add_argument("--pad", action="store_true", help="hold the video to the audio length instead of trimming to the shorter")
    u.set_defaults(fn=cmd_under)

    s = sub.add_parser("still", help="turn an image + audio into an mp4")
    s.add_argument("--image", required=True)
    s.add_argument("--audio", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--fps", type=int, default=30)
    s.set_defaults(fn=cmd_still)
    return p.parse_args()


def main() -> None:
    a = parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
