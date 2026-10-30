#!/usr/bin/env python3
"""storyboard-board — film.json + shots.json + plate JPGs -> a VISUAL shot-card board.

A craft TOOL (not engine code): the storyboard skill calls it after site-capture has produced the
plates. It makes the storyboard *reviewable as pixels*: one shot card per camera beat, each showing
the ACTUAL cropped region the render will frame (same camera math as build.py), paired with the VO
line, chip, ring, zoom/shot-code and timing for that beat. A card whose picture does not match its
VO line is the grounding bug, caught BEFORE render.

  python3 craft/tools/storyboard-board.py --root <filmdir> [--words <path>]

Reads <root>/film.json, <root>/src/shots.json, <root>/assets/shots/<plate>.jpg (and, when present,
<root>/media/words.json for exact timecodes). Writes:
  <root>/board.html         — the deliverable: shot cards (crop + VO + chip + ring + timing).
  <root>/board/beat_NN.jpg  — the per-beat crop previews the cards embed.
  <root>/board/sheet.jpg    — a single montage of all cards (quick-look / review frame-evidence).

CAMERA MATH: clampcam() + the crop formula below MIRROR craft/tools/build.py. Parity is pinned by
tests/test_board_parity.py (compares against build.py's emitted P.CAM). If build.py's camera math
changes, that test fails — update both together.
"""
import argparse
import html as _html
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CHROME = 56
FY = 0.5


def parse_args():
    p = argparse.ArgumentParser(description="film.json -> visual shot-card board")
    p.add_argument("--root", default=".", help="film dir (film.json, src/shots.json, assets/shots/)")
    p.add_argument("--words", default=None, help="words.json path (default <root>/media/words.json); optional, adds timecodes")
    p.add_argument("--card-w", type=int, default=520, help="crop card width in px")
    return p.parse_args()


def clean(s):
    return re.sub(r"[^a-z0-9']", "", s.lower())


class Resolver:
    """Resolve a time/word ref to an orderable position on the VO timeline.

    With words.json it returns real seconds. Without it (storyboard stage, no VO yet) it returns a
    synthetic ordinal from the script word order, so chip/ring/beat ordering still works. Mirrors the
    ref grammar of build.py's T(): seconds | "Word" | "Word#2" | "Word+0.3" | "line:4" | "end".
    """

    def __init__(self, script, words):
        self.have_times = bool(words)
        self.words = words or []
        self.dur = None
        if words:
            self.dur = max((w["end"] for w in words), default=0.0)
        # synthetic ordinal map from the script when there is no VO yet
        self.ord_words = []  # (clean_text, line_no)
        for ln, line in enumerate(script, start=1):
            for tok in line.split():
                self.ord_words.append((clean(tok), ln))

    def pos(self, ref):
        """Orderable position (seconds if VO present, else word ordinal). None-safe for layout only."""
        if isinstance(ref, (int, float)):
            return float(ref)
        m = re.fullmatch(r"\s*(.+?)\s*([+-]\s*[\d.]+)?\s*", str(ref))
        key = m.group(1)
        off = float(m.group(2).replace(" ", "")) if m.group(2) else 0.0
        if key == "end":
            return (self.dur if self.have_times else len(self.ord_words)) + off
        if key.startswith("line:"):
            n = int(key[5:])
            if self.have_times:
                return next((w["start"] for w in self.words if w["line"] == n), 0.0) + off
            return next((i for i, (_, ln) in enumerate(self.ord_words) if ln == n), 0) + off
        word, nth = (key.split("#") + ["1"])[:2]
        nth = int(nth)
        if self.have_times:
            hits = [w for w in self.words if clean(w["text"]) == clean(word)]
            return (hits[nth - 1]["start"] if len(hits) >= nth else 0.0) + off
        hits = [i for i, (t, _) in enumerate(self.ord_words) if t == clean(word)]
        return (hits[nth - 1] if len(hits) >= nth else 0) + off

    def line_of(self, ref):
        """Which script line a beat's anchor word falls in (1-based), for the card's VO text."""
        m = re.fullmatch(r"\s*(.+?)\s*([+-]\s*[\d.]+)?\s*", str(ref))
        key = m.group(1) if m else str(ref)
        if key.startswith("line:"):
            return int(key[5:])
        word, nth = (key.split("#") + ["1"])[:2]
        nth = int(nth)
        if self.have_times:
            hits = [w for w in self.words if clean(w["text"]) == clean(word)]
            if len(hits) >= nth:
                return hits[nth - 1]["line"]
        hits = [ln for (t, ln) in self.ord_words if t == clean(word)]
        return hits[nth - 1] if len(hits) >= nth else None

    def secs(self, ref):
        return self.pos(ref) if self.have_times else None


def shot_code(z):
    # rough cinematography label from zoom, for the card
    return ("WS" if z < 1.15 else "MWS" if z < 1.35 else "MS" if z < 1.6 else "MCU" if z < 1.9 else "CU")


# --- camera math (module-level, pure): MIRRORS craft/tools/build.py; pinned by tests/test_board_parity.py ---

def geometry(film):
    W, H = film.get("size", [1920, 1080])
    CAPW = film.get("capture", {}).get("width", 1440)
    VW, VH = W, H - CHROME
    return {"W": W, "H": H, "VW": VW, "VH": VH, "CAPW": CAPW, "K": VW / CAPW}


def rect(shots, target, plate):
    if isinstance(target, list):
        return target if len(target) == 4 else [target[0] - 1, target[1] - 1, 2, 2]
    r = shots.get(plate, {}).get(target)
    if not r:
        sys.exit(f'storyboard-board: mark "{target}" not found on plate "{plate}" (rerun site-capture)')
    return r


def centre(shots, target, plate):
    x, y, w, h = rect(shots, target, plate)
    return x + w / 2, y + h / 2


def clampcam(g, shots, plate, cx, cy, z):
    K, VW, VH, CAPW = g["K"], g["VW"], g["VH"], g["CAPW"]
    iw, ih = CAPW * K, shots[plate]["_h"] * K
    z = max(z, 1.0, VH / ih)
    x = min(0, max(VW - iw * z, VW / 2 - cx * K * z))
    y = min(0, max(VH - ih * z, VH * FY - cy * K * z))
    return round(x, 1), round(y, 1), round(z, 4)


def crop_capture_px(g, a_xyz):
    # the window the render frames, back in capture px (inverse of the #cam transform)
    x, y, z = a_xyz
    K = g["K"]
    return [-x / (z * K), -y / (z * K), g["VW"] / (z * K), g["VH"] / (z * K)]


def beat_window(g, shots, c):
    """A camera beat -> (plate, zoom, focus, a=[x,y,z]) using build.py's settle framing."""
    plate = c["plate"]
    z = c.get("zoom", 1.0)
    f = c.get("focus", [g["CAPW"] / 2, shots[plate]["_h"] / 2])
    cx, cy = (f if isinstance(f, list) and len(f) == 2 else centre(shots, f, plate))
    return plate, z, f, list(clampcam(g, shots, plate, cx, cy, z))


def main():
    a = parse_args()
    root = Path(a.root)
    film = json.loads((root / "film.json").read_text())
    shots = json.loads((root / "src/shots.json").read_text())
    words_path = Path(a.words) if a.words else (root / "media/words.json")
    words = json.loads(words_path.read_text())["words"] if words_path.exists() else None

    g = geometry(film)
    cams = film["camera"]
    res = Resolver(film.get("script", []), words)

    board_dir = root / "board"
    board_dir.mkdir(exist_ok=True)

    plate_imgs = {}
    beats = []
    cw = a.card_w
    for i, c in enumerate(cams):
        plate, z, f, axyz = beat_window(g, shots, c)
        # A beat may supply a MOCKUP image instead of a real capture (c.mock, a path under <root>):
        # the mock frame IS the shot, so it is used whole, not camera-cropped. Mix freely per beat.
        mock = c.get("mock")
        if mock:
            pic = Image.open(root / mock).convert("RGB")
            code = "MOCK"
        else:
            if plate not in plate_imgs:
                plate_imgs[plate] = Image.open(root / f"assets/shots/{plate}.jpg").convert("RGB")
            img = plate_imgs[plate]
            cxp, cyp, cwp, chp = crop_capture_px(g, axyz)
            ratio = img.width / g["CAPW"]  # physical jpg px per capture px (DSF)
            box = (
                max(0, round(cxp * ratio)),
                max(0, round(cyp * ratio)),
                min(img.width, round((cxp + cwp) * ratio)),
                min(img.height, round((cyp + chp) * ratio)),
            )
            pic = img.crop(box)
            code = shot_code(z)
        ch = max(1, round(cw * pic.height / pic.width))
        pic.resize((cw, ch), Image.LANCZOS).save(board_dir / f"beat_{i:02d}.jpg", quality=88)

        pos = res.pos(c["at"])
        chip = next((ch_["text"] for ch_ in film.get("chips", []) if res.pos(ch_["at"]) <= pos < res.pos(ch_["until"])), "")
        ring = next((r_ for r_ in film.get("rings", []) if res.pos(r_["at"]) <= pos < res.pos(r_["until"])), None)
        ln = res.line_of(c["at"])
        vo = film.get("script", [])[ln - 1] if ln and ln - 1 < len(film.get("script", [])) else ""
        beats.append({
            "i": i, "plate": plate, "zoom": round(z, 2), "code": code, "mock": bool(mock),
            "focus": f if isinstance(f, list) else f, "at": c["at"],
            "t": res.secs(c["at"]), "vo_line": ln, "vo": vo,
            "chip": re.sub(r"\*\*(.+?)\*\*", r"\1", chip), "ring": (ring.get("target") if ring else None),
            "crop": f"board/beat_{i:02d}.jpg", "cw": cw, "ch": ch,
        })

    _write_sheet(board_dir / "sheet.jpg", board_dir, beats)
    _write_html(root / "board.html", film, beats, res.have_times)
    print(f"board: {len(beats)} shot cards -> {root}/board.html  (+ board/sheet.jpg)")


def _font(sz):
    for p in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"):
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


def _wrap(draw, text, font, maxw):
    out, line = [], ""
    for word in text.split():
        t = (line + " " + word).strip()
        if draw.textlength(t, font=font) <= maxw or not line:
            line = t
        else:
            out.append(line)
            line = word
    if line:
        out.append(line)
    return out


def _write_sheet(path, board_dir, beats, cols=3):
    """A single montage of every card — crop + caption — so a reviewer (or the operator) reads the
    whole board in one image and spots a VO/picture mismatch at a glance."""
    if not beats:
        return
    f_hd, f_bd = _font(22), _font(19)
    pad, cap_h, gap = 14, 150, 18
    cw = beats[0]["cw"]
    cell_w = cw + pad * 2
    # cap each crop height so a tall card doesn't blow up the sheet
    crop_h = min(max(b["ch"] for b in beats), round(cw * 0.62))
    cell_h = crop_h + cap_h + pad * 2
    rows = (len(beats) + cols - 1) // cols
    W = cols * cell_w + gap * (cols + 1)
    Hh = rows * cell_h + gap * (rows + 1)
    sheet = Image.new("RGB", (W, Hh), (14, 15, 18))
    d = ImageDraw.Draw(sheet)
    for idx, b in enumerate(beats):
        r, c = divmod(idx, cols)
        x0 = gap + c * (cell_w + gap)
        y0 = gap + r * (cell_h + gap)
        d.rectangle([x0, y0, x0 + cell_w, y0 + cell_h], fill=(24, 26, 31))
        im = Image.open(board_dir / f"beat_{b['i']:02d}.jpg").convert("RGB")
        if im.height > crop_h:
            im = im.crop((0, 0, im.width, crop_h))
        sheet.paste(im, (x0 + pad, y0 + pad))
        ty = y0 + pad + crop_h + 8
        t = b["t"]
        head = f"BEAT {b['i']}  ·  {b['code']} z{b['zoom']}  ·  focus {b['focus']}" + (f"  ·  {t:.1f}s" if t is not None else "")
        d.text((x0 + pad, ty), head, fill=(240, 200, 90), font=f_hd)
        ty += 28
        if b["chip"]:
            d.text((x0 + pad, ty), f"CHIP: {b['chip']}", fill=(120, 200, 255), font=f_bd)
            ty += 24
        for line in _wrap(d, f'VO: “{b["vo"]}”', f_bd, cell_w - pad * 2)[:4]:
            d.text((x0 + pad, ty), line, fill=(235, 235, 235), font=f_bd)
            ty += 23
    sheet.save(path, quality=86)


def _write_html(path, film, beats, have_times):
    cards = []
    for b in beats:
        t = f'<span class="t">{b["t"]:.1f}s</span>' if b["t"] is not None else ""
        chip = f'<div class="chip">{_html.escape(b["chip"])}</div>' if b["chip"] else ""
        ring = f'<span class="ring">ring: {_html.escape(str(b["ring"]))}</span>' if b["ring"] else ""
        cards.append(f"""  <figure class="card">
    <img src="{b['crop']}" alt="beat {b['i']}" loading="lazy">
    <figcaption>
      <div class="hd"><b>BEAT {b['i']}</b> · {b['code']} z{b['zoom']} · focus {_html.escape(str(b['focus']))} {t}</div>
      {chip}
      <div class="vo">“{_html.escape(b['vo'])}”</div>
      <div class="meta">plate {_html.escape(b['plate'])} · line {b['vo_line']} {ring}</div>
    </figcaption>
  </figure>""")
    title = _html.escape(film.get("title", "Storyboard"))
    note = "" if have_times else '<p class="warn">No VO yet — timings are script-order estimates; crops are exact.</p>'
    doc = f"""<!doctype html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Board — {title}</title>
<style>
  :root {{ --bg:#0B0D12; --fg:#F2F4F8; --mut:#8A93A6; --card:#161A22; --acc:#5B8CFF; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; padding:24px; }}
  h1 {{ font-size:20px; margin:0 0 4px; }} .sub {{ color:var(--mut); margin:0 0 20px; }}
  .warn {{ color:#FFB547; margin:0 0 16px; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:18px; }}
  .card {{ margin:0; background:var(--card); border:1px solid #232834; border-radius:12px; overflow:hidden; }}
  .card img {{ width:100%; display:block; background:#000; border-bottom:1px solid #232834; }}
  figcaption {{ padding:12px 14px; }}
  .hd {{ font:12px/1.4 ui-monospace,Menlo,monospace; color:#F0C85A; letter-spacing:.04em; margin-bottom:8px; }}
  .t {{ color:var(--mut); }}
  .chip {{ display:inline-block; font:11px/1 ui-monospace,monospace; letter-spacing:.1em; color:#9CC6FF; background:#0E1628; border:1px solid #2A3550; padding:5px 9px; border-radius:6px; margin-bottom:8px; }}
  .vo {{ font-size:15px; color:var(--fg); margin-bottom:6px; }}
  .meta {{ font:12px ui-monospace,monospace; color:var(--mut); }} .ring {{ color:#FFB547; }}
</style></head><body>
<h1>{title}</h1>
<p class="sub">Visual storyboard · {len(beats)} shot cards · each picture is the exact region the render will frame.</p>
{note}
<div class="grid">
{chr(10).join(cards)}
</div></body></html>"""
    path.write_text(doc)


if __name__ == "__main__":
    main()
