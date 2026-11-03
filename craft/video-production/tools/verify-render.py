#!/usr/bin/env python3
"""Deterministic render verifier — the audio/sync check no LLM reviewer reliably performs.

Given a render directory (the one holding film.json, media/words.json, media/vo.wav, film.mp4),
mechanically confirm the rendered voiceover actually matches the script and the cut is internally
consistent. This catches the failure class that slipped past every LLM review layer on the first
runs: a tagline spoken twice, a line dropped, a film.json whose media/ came from a different render
pass, dead air, and mp4/vo duration desync.

Usage:  python3 craft/video-production/tools/verify-render.py --root <render-dir>
Exit 0 and "VERDICT: pass" when clean; exit 1 and "VERDICT: revise" with the specific breaks.
"""
import argparse
import json
import os
import re
import subprocess
import sys


def norm_words(text):
	"""Lowercase, keep alphanumerics as word tokens, drop punctuation/symbols."""
	return re.findall(r"[a-z0-9']+", text.lower())


def ffprobe_duration(path):
	try:
		out = subprocess.run(
			["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
			capture_output=True, text=True, timeout=30,
		)
		return float(out.stdout.strip())
	except Exception:
		return None


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--root", required=True, help="render directory (contains film.json, media/, film.mp4)")
	args = ap.parse_args()
	root = args.root
	fails = []
	warns = []

	film_p = os.path.join(root, "film.json")
	words_p = os.path.join(root, "media", "words.json")
	vo_p = os.path.join(root, "media", "vo.wav")
	mp4_p = os.path.join(root, "film.mp4")

	for label, p in [("film.json", film_p), ("media/words.json", words_p), ("media/vo.wav", vo_p), ("film.mp4", mp4_p)]:
		if not os.path.isfile(p):
			fails.append(f"missing {label} — render did not produce it")
	if fails:
		return report(fails, warns)

	film = json.load(open(film_p))
	words_doc = json.load(open(words_p))
	script = film.get("script") or []
	if isinstance(script, str):
		script = [script]
	words = words_doc.get("words") if isinstance(words_doc, dict) else words_doc
	words = words or []
	vo_text_tokens = norm_words(" ".join((w.get("text") or w.get("word") or "") for w in words))
	vo_text = " ".join(vo_text_tokens)

	# 1. Script coverage: every script line spoken exactly once, in order (catches dup tagline / dropped line
	#    / a media dir from a different render).
	cursor = 0
	ordered = True
	for i, line in enumerate(script, 1):
		phrase = " ".join(norm_words(line))
		if not phrase:
			continue
		n = vo_text.count(phrase)
		if n == 0:
			fails.append(f"script line {i} not found in the voiceover: \"{line[:60]}\" (dropped line, or media/ is from a different render)")
		elif n > 1:
			fails.append(f"script line {i} spoken {n}x (should be once): \"{line[:60]}\" (duplicated VO)")
		else:
			pos = vo_text.find(phrase)
			if pos < cursor:
				ordered = False
			cursor = pos
	if not ordered:
		fails.append("script lines are out of order in the voiceover")

	# word-count sanity (independent of phrase matching)
	script_wc = len(norm_words(" ".join(script)))
	if script_wc and len(vo_text_tokens) > script_wc * 1.15:
		fails.append(f"voiceover has {len(vo_text_tokens)} words vs {script_wc} in the script — ~{len(vo_text_tokens) - script_wc} extra (duplicated audio)")

	# 2. Duration sync: mp4 ~= vo.wav ~= words.duration ~= last word end + tail.
	voice = film.get("voice") or {}
	tail = float(film.get("tail") or 0)
	last_end = max((float(w.get("end", 0)) for w in words), default=0.0)
	expected = last_end + tail
	mp4_dur = ffprobe_duration(mp4_p)
	vo_dur = ffprobe_duration(vo_p)
	wd = words_doc.get("duration") if isinstance(words_doc, dict) else None
	if mp4_dur is not None and vo_dur is not None and abs(mp4_dur - vo_dur) > 1.5:
		fails.append(f"mp4 duration {mp4_dur:.2f}s vs vo.wav {vo_dur:.2f}s differ by >1.5s (audio/video desync)")
	if mp4_dur is not None and abs(mp4_dur - expected) > 2.0:
		warns.append(f"mp4 {mp4_dur:.2f}s vs expected last-word+tail {expected:.2f}s (>2s) — check tail/hold")
	if wd is not None and vo_dur is not None and abs(float(wd) - vo_dur) > 1.0:
		fails.append(f"words.json duration {float(wd):.2f}s vs vo.wav {vo_dur:.2f}s differ by >1s (words.json is from a different pass)")

	# 3. Dead air: a gap >3s between consecutive spoken words is dead air, not an intended beat pause.
	starts = [(float(w.get("start", 0)), float(w.get("end", 0))) for w in words]
	starts.sort()
	for (s0, e0), (s1, _e1) in zip(starts, starts[1:]):
		if s1 - e0 > 3.0:
			fails.append(f"dead air: {s1 - e0:.1f}s silence between words at {e0:.1f}s–{s1:.1f}s")
			break

	# 4. Open: first spoken word should land near the lead-in, not seconds in.
	lead = float(voice.get("lead", 0))
	first_start = starts[0][0] if starts else 0.0
	if first_start > lead + 1.0:
		warns.append(f"voiceover starts at {first_start:.2f}s (lead {lead:.2f}s) — long silent/possibly blank open")

	return report(fails, warns)


def report(fails, warns):
	for w in warns:
		print(f"WARN: {w}")
	for f in fails:
		print(f"FAIL: {f}")
	if fails:
		print("VERDICT: revise")
		return 1
	print("VERDICT: pass")
	return 0


if __name__ == "__main__":
	sys.exit(main())
