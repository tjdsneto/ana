#!/usr/bin/env python3
"""build — film.json + words.json + shots.json -> index.html (a seekable GSAP composition).

A craft TOOL (not engine code): the render skill calls it. Re-authored from the reference build.py
(real-ui-launch-film) for this repo — same resolver + camera math + HTML/CSS/GSAP presentation, but
path-driven (--root) and with the HyperFrames-specific driving dropped: the page just exposes a paused
timeline at window.__timelines.main that the render tool seeks frame by frame (spec 09). Also writes
src/sfx-cues.json for the mix tool.

  python3 craft/tools/build.py --root <filmdir> [--words <path>]

Reads <root>/film.json, <root>/src/shots.json, and the word timings (--words, default
<root>/media/words.json). Writes <root>/index.html (loads assets/shots/<plate>.jpg relative to it)
and <root>/src/sfx-cues.json.

Every time in film.json is seconds (12.4) or a voiceover word: "Save" (first spoken), "Save#2" (2nd),
"Save+0.3"/"Save-0.2" (offset), "line:4" (start of script line 4), "end" (end of film).
"""
import argparse
import json
import re
import sys
from pathlib import Path


def parse_args():
    p = argparse.ArgumentParser(description="film.json -> seekable GSAP index.html")
    p.add_argument("--root", default=".", help="film dir (film.json, src/shots.json, assets/shots/)")
    p.add_argument("--words", default=None, help="words.json path (default <root>/media/words.json)")
    return p.parse_args()


A = parse_args()
ROOT = Path(A.root)
film = json.loads((ROOT / "film.json").read_text())
SHOTS = json.loads((ROOT / "src/shots.json").read_text())
words_path = Path(A.words) if A.words else (ROOT / "media/words.json")
if not words_path.exists():
    words_path = ROOT / "src/words.json"
WJ = json.loads(words_path.read_text())
WORDS, DUR = WJ["words"], float(film.get("duration", WJ["duration"]))
W, H = film.get("size", [1920, 1080])
TH = {"bg": "#0A0A0C", "text": "#EFE9DD", "accent": "#FE4715", "highlight": "#E6F24A", "muted": "#77716A",
      "font": 'Inter, "Helvetica Neue", Arial, sans-serif', "mono": '"JetBrains Mono", "SF Mono", Menlo, monospace', **film.get("theme", {})}
CAPW = film.get("capture", {}).get("width", 1440)


def clean(s):
    return re.sub(r"[^a-z0-9']", "", s.lower())


def T(ref):
    """Resolve a time reference (see module doc) to seconds on the composition clock."""
    if isinstance(ref, (int, float)):
        return float(ref)
    m = re.fullmatch(r"\s*(.+?)\s*([+-]\s*[\d.]+)?\s*", str(ref))
    key, off = m.group(1), float(m.group(2).replace(" ", "")) if m.group(2) else 0.0
    if key == "end":
        return DUR + off
    if key.startswith("line:"):
        n = int(key[5:])
        return next(w["start"] for w in WORDS if w["line"] == n) + off
    word, nth = (key.split("#") + ["1"])[:2]
    hits = [w for w in WORDS if clean(w["text"]) == clean(word)]
    if len(hits) < int(nth):
        sys.exit(f'build: "{ref}" is not in the voiceover (spoken {len(hits)} time(s))')
    return hits[int(nth) - 1]["start"] + off


# ------------------------------------------------------------------ layout
CHROME = 56
VW, VH = W, H - CHROME
K = VW / CAPW
FY = 0.5
inset = film.get("window_inset", 0.07)
FULL = {"x": round(W * inset, 1), "y": round(H * inset, 1), "scale": round(1 - 2 * inset, 4), "borderRadius": 14}
CARD = {"x": round(W * 0.13, 1), "y": round(H * 0.14, 1), "scale": 0.74, "borderRadius": 18}

CAMS = film["camera"]
T_WIN = T(CAMS[0]["at"])
EXP = T(film.get("expand_at", T_WIN + 0.9))
OUT = T(film["outro"]["at"]) if film.get("outro") else DUR


def rect(target, plate):
    if isinstance(target, list):
        return target if len(target) == 4 else [target[0] - 1, target[1] - 1, 2, 2]
    r = SHOTS.get(plate, {}).get(target)
    if not r:
        sys.exit(f'build: mark "{target}" not found on plate "{plate}" (check marks, rerun site-capture)')
    return r


def centre(target, plate):
    x, y, w, h = rect(target, plate)
    return x + w / 2, y + h / 2


def clampcam(plate, cx, cy, z):
    iw, ih = CAPW * K, SHOTS[plate]["_h"] * K
    z = max(z, 1.0, VH / ih)
    x = min(0, max(VW - iw * z, VW / 2 - cx * K * z))
    y = min(0, max(VH - ih * z, VH * FY - cy * K * z))
    return round(x, 1), round(y, 1), round(z, 4)


def plate_at(t):
    cur = CAMS[0]["plate"]
    for c in CAMS:
        if T(c["at"]) <= t + 1e-6:
            cur = c["plate"]
    return cur


def cam_keys():
    out = []
    for i, c in enumerate(CAMS):
        t = T(c["at"])
        nxt = T(CAMS[i + 1]["at"]) if i + 1 < len(CAMS) else OUT
        plate, z = c["plate"], c.get("zoom", 1.0)
        f = c.get("focus", [CAPW / 2, SHOTS[plate]["_h"] / 2])
        cx, cy = (f if isinstance(f, list) and len(f) == 2 else centre(f, plate))
        glide = c.get("glide", 0)
        cut = glide == 0
        a = clampcam(plate, cx, cy, z)
        b = clampcam(plate, cx, cy, z * 1.035)          # slow push-in while holding
        a0 = clampcam(plate, cx, cy, z * 0.96) if cut else None
        d = 0.45 if cut else glide
        d = min(d, max(0.0, nxt - t - 0.05))
        out.append({"t": round(t, 3), "d": round(d, 3), "a": a, "a0": a0, "b": b, "hold": round(nxt - t - d, 3), "shot": plate})
    return out


CAM = cam_keys()
PLATES = list(dict.fromkeys(c["plate"] for c in CAMS))
CLICKS = []
for c in film.get("clicks", []):
    t = T(c["at"])
    x, y = centre(c["target"], c.get("plate", plate_at(t)))
    CLICKS.append([round(t, 3), x, y])
RINGS = []
for i, r in enumerate(film.get("rings", [])):
    t0, t1 = T(r["at"]), T(r["until"])
    RINGS.append([f"r{i}", t0, t1, rect(r["target"], r.get("plate", plate_at(t0))), r.get("color", "")])
CHIPS = [[f"c{i}", T(c["at"]), T(c["until"]), c["text"]] for i, c in enumerate(film.get("chips", []))]
ASSETS = film.get("assets", {})
LAYERS = []
for i, L in enumerate(film.get("layers", [])):
    a = {}
    if "asset" in L:
        if L["asset"] not in ASSETS:
            sys.exit(f'build: layer references unknown asset "{L["asset"]}" (not in film.assets)')
        a = ASSETS[L["asset"]]  # asset fields are defaults; the layer's own fields override
    el = {"id": L.get("id", f"l{i}"),
          "in": round(T(L["at"]) if "at" in L else 0.0, 3),
          "out": round(T(L["until"]) if "until" in L else OUT, 3),
          "kind": L.get("kind", a.get("kind", "image")), "src": L.get("src", a.get("src", "")),
          "text": L.get("text", a.get("text", "")),
          "x": L.get("x", 0), "y": L.get("y", 0), "w": L.get("w"), "h": L.get("h"), "z": L.get("z", 15)}
    mv = L.get("move")
    if mv:
        el["move"] = {"at": round(T(mv["at"]) if "at" in mv else el["in"], 3),
                      "dur": float(mv.get("dur", 0.6)), "ease": mv.get("ease", "expo.out"),
                      "from": mv.get("from", {}), "to": mv.get("to", {})}
    LAYERS.append(el)


def md(s):
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)


def words(text, cls):
    ws = text.split()
    if ws and ws[-1].endswith("."):
        ws[-1] = ws[-1].rstrip(".")  # the .big accent dot is added by CSS; avoid a doubled period
    return " ".join(f'<span class="{cls}">{w}</span>' for w in ws)


CURSOR = '<svg viewBox="0 0 24 24" width="34" height="34"><path d="M4 2l15 11.5-6.6 1.1 3.9 7-2.6 1.4-3.9-7.1L4 20z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>'
LOCK = '<svg viewBox="0 0 24 24" width="17" height="17"><rect x="5" y="10" width="14" height="10" rx="2.5" fill="#5f6368"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10" fill="none" stroke="#5f6368" stroke-width="2.2"/></svg>'

CSS = """
:root { --bg:%(bg)s; --tx:%(text)s; --ac:%(accent)s; --hi:%(highlight)s; --mu:%(muted)s; }
* { margin:0; padding:0; box-sizing:border-box; }
body { background:var(--bg); font-family:%(font)s; -webkit-font-smoothing:antialiased; }
#root { position:relative; width:%(W)spx; height:%(H)spx; overflow:hidden; background:var(--bg); }
#bg { position:absolute; inset:0; overflow:hidden; }
.glow { position:absolute; left:14%%; top:28%%; width:72%%; height:65%%; border-radius:50%%; background:var(--ac); filter:blur(160px); opacity:.16; }
.dots { position:absolute; inset:0; background-image:radial-gradient(rgba(255,255,255,.075) 1.3px, transparent 1.6px); background-size:30px 30px; }
.clip { position:absolute; inset:0; }
.card { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:0 8%%; }
.kick { font-family:%(mono)s; font-size:30px; letter-spacing:.32em; color:var(--mu); margin-bottom:28px; }
.big { font-size:%(BIG)spx; line-height:1.02; font-weight:800; letter-spacing:-.02em; color:var(--tx); }
.big .w { display:inline-block; }
.big .w:last-child::after { content:"."; color:var(--ac); }
.sub { margin-top:30px; font-size:34px; color:var(--mu); }
.cta { margin-top:44px; padding:16px 30px; border-radius:999px; background:var(--ac); color:#fff; font-size:30px; font-weight:700; }
.win { position:absolute; left:0; top:0; width:%(W)spx; height:%(H)spx; transform-origin:0 0; overflow:hidden; background:#f0f0f1; box-shadow:0 60px 160px rgba(0,0,0,.75), 0 0 0 2px rgba(255,255,255,.08); opacity:0; }
.bar { position:absolute; left:0; right:0; top:0; height:56px; background:#E9EAED; border-bottom:1px solid #D5D7DB; display:flex; align-items:center; padding:0 18px; gap:18px; z-index:5; }
.lights { display:flex; gap:9px; flex:none; } .lights i { width:14px; height:14px; border-radius:50%%; background:#FF5F57; } .lights i:nth-child(2) { background:#FEBC2E; } .lights i:nth-child(3) { background:#28C840; }
.omni { position:relative; flex:1; height:36px; border-radius:18px; background:#fff; box-shadow:inset 0 0 0 1px #DADCE0; overflow:hidden; }
.url { position:absolute; left:0; top:0; height:36px; display:flex; align-items:center; gap:10px; padding:0 16px; font-size:18px; color:#202124; white-space:nowrap; }
.vp { position:absolute; left:0; top:56px; width:%(VW)spx; height:%(VH)spx; overflow:hidden; background:#f0f0f1; }
#cam { position:absolute; left:0; top:0; width:%(VW)spx; height:%(VH)spx; transform-origin:0 0; }
.shot { position:absolute; left:0; top:0; display:block; opacity:0; max-width:none; }
.ring { position:absolute; border:3px solid var(--ac); border-radius:8px; opacity:0; box-shadow:0 0 0 6px color-mix(in srgb, var(--ac) 22%%, transparent); }
.cursor { position:absolute; left:0; top:0; width:34px; height:34px; z-index:20; opacity:0; }
.ripple { position:absolute; left:-14px; top:-14px; width:34px; height:34px; border-radius:50%%; border:3px solid var(--ac); opacity:0; }
.chip { position:absolute; left:0; right:0; margin:0 auto; width:fit-content; bottom:%(CHIPB)spx; padding:12px 22px; border-radius:8px; background:rgba(10,10,12,.92); box-shadow:inset 0 0 0 1.5px #3d3a35, 0 20px 50px rgba(0,0,0,.4); font-family:%(mono)s; font-size:%(CHIPSZ)spx; letter-spacing:.12em; color:#F8F5EE; white-space:nowrap; opacity:0; z-index:7; }
.chip b { color:#fff; font-weight:600; }
#layers { position:absolute; inset:0; pointer-events:none; }
.layer { position:absolute; opacity:0; transform-origin:0 0; }
.ltext { font-family:%(font)s; color:var(--tx); font-weight:700; font-size:40px; line-height:1.08; }
.ltext b { color:var(--ac); }
"""


def html():
    tc = film.get("title_card", {})
    oc = film.get("outro", {})
    shots = "".join(f'<img class="shot" id="s_{p.replace("-", "_")}" src="assets/shots/{p}.jpg" alt="" style="width:{VW}px;height:{round(SHOTS[p]["_h"] * K, 1)}px">' for p in PLATES)
    rings = "".join(f'<div class="ring" id="{rid}" style="left:{(x - 8) * K:.1f}px;top:{(y - 8) * K:.1f}px;width:{(w + 16) * K:.1f}px;height:{(h + 16) * K:.1f}px{f';--ac:{col}' if col else ''}"></div>'
                    for rid, _, _, (x, y, w, h), col in RINGS)
    chips = "".join(f'<div class="chip" id="{cid}">{md(txt)}</div>' for cid, _, _, txt in CHIPS)

    def _layer(L):
        style = f'left:{L["x"]}px;top:{L["y"]}px;z-index:{L["z"]}'
        if L["w"] is not None:
            style += f';width:{L["w"]}px'
        if L["h"] is not None:
            style += f';height:{L["h"]}px'
        if L["kind"] == "text":
            return f'<div class="layer ltext" id="L_{L["id"]}" style="{style}">{md(L["text"])}</div>'
        if L["kind"] == "video":
            return f'<video class="layer" id="L_{L["id"]}" src="{L["src"]}" data-in="{L["in"]}" muted playsinline preload="auto" style="{style}"></video>'
        return f'<img class="layer" id="L_{L["id"]}" src="{L["src"]}" alt="" style="{style}">'
    layers_div = f'<div id="layers">{"".join(_layer(L) for L in LAYERS)}</div>' if LAYERS else ""
    font_css = f'<link rel="stylesheet" href="{TH["fontCss"]}">' if TH.get("fontCss") else ""
    title = f"""
  <section id="title" class="clip">
    <div class="card" id="tcard"><div class="kick" id="tk">{tc.get("kicker", "")}</div><div class="big" id="tb">{words(tc.get("text", film.get("title", "")), "w")}</div></div>
  </section>"""
    outro = "" if not oc else f"""
  <section id="outro" class="clip">
    <div class="card" id="ocard"><div class="kick" id="ok">{oc.get("kicker", "")}</div><div class="big" id="ob">{words(oc.get("text", ""), "w")}</div>
    {f'<div class="sub" id="os">{oc["sub"]}</div>' if oc.get("sub") else ''}{f'<div class="cta" id="oc">{oc["cta"]}</div>' if oc.get("cta") else ''}</div>
  </section>"""
    return f"""<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width={W}, height={H}">
<title>{film.get("title", "Launch film")}</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>{font_css}
<style>{CSS % dict(TH, W=W, H=H, VW=VW, VH=VH, BIG=film.get("title_size", 132), CHIPB=max(8, round(H * inset / 2 - 28)), CHIPSZ=film.get("chip_size", 28))}</style></head>
<body>
<div id="root">
  <div id="bg"><div class="glow" id="glow"></div><div class="dots"></div></div>{title}
  <section id="product" class="clip">
    <div class="win" id="win">
      <div class="bar"><span class="lights"><i></i><i></i><i></i></span><div class="omni"><span class="url">{LOCK}<span>{film.get("url", "example.com")}</span></span></div></div>
      <div class="vp"><div id="cam">{shots}{rings}<div class="cursor" id="cur">{CURSOR}<i class="ripple" id="rip"></i></div></div></div>
    </div>
    {chips}
  </section>{layers_div}{outro}
</div>
<script>{JS.replace("__P__", json.dumps(PAYLOAD))}</script>
</body></html>
"""


JS = r"""
const tl = gsap.timeline({ paused: true });
const P = __P__, K = P.K;
function hide(list) { list.forEach(function (s) { if (!document.querySelector(s)) return; gsap.set(s, { opacity: 0 }); tl.set(s, { opacity: 0 }, 0); }); }
function rise(sel, t) { if (!document.querySelector(sel)) return; tl.fromTo(sel, { opacity: 0, y: 40, filter: "blur(12px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.55, ease: "expo.out", immediateRender: false }, t); }
function wordsIn(sel, t) { tl.fromTo(sel + " .w", { opacity: 0, y: 60, filter: "blur(14px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.6, ease: "expo.out", stagger: 0.09, immediateRender: false }, t); }
function blurOut(sel, t) { tl.to(sel, { opacity: 0, scale: 1.06, filter: "blur(16px)", duration: 0.3, ease: "power2.in" }, t - 0.3); }

tl.fromTo("#glow", { x: -60, scale: 1 }, { x: 60, scale: 1.08, duration: P.DUR, ease: "none" }, 0);

// title card
tl.fromTo("#tb", { scale: 1.05 }, { scale: 1, duration: Math.max(0.5, P.TWIN - 0.3), ease: "power2.out", immediateRender: true }, 0);
blurOut("#tcard", P.TWIN + 0.1);

// browser window: floats in as a card, then expands to fill the frame
gsap.set("#win", Object.assign({ opacity: 0 }, P.CARD)); tl.set("#win", Object.assign({ opacity: 0 }, P.CARD), 0);
tl.fromTo("#win", { opacity: 0, y: P.CARD.y + 80 }, { opacity: 1, y: P.CARD.y, duration: 0.6, ease: "expo.out", immediateRender: false }, P.TWIN);
tl.to("#win", Object.assign({ duration: 0.75, ease: "expo.inOut" }, P.FULL), P.EXP);
if (P.OUT < P.DUR) blurOut("#win", P.OUT + 0.1);

// camera
document.querySelectorAll(".shot").forEach(function (s) { gsap.set(s, { opacity: 0 }); tl.set(s, { opacity: 0 }, 0); });
let cur = null;
P.CAM.forEach(function (k, i) {
  const a = { x: k.a[0], y: k.a[1], scale: k.a[2] }, b = { x: k.b[0], y: k.b[1], scale: k.b[2] };
  if (k.a0) {
    const a0 = { x: k.a0[0], y: k.a0[1], scale: k.a0[2] };
    if (i === 0) gsap.set("#cam", a0);
    tl.set("#cam", a0, i === 0 ? 0 : k.t);
    if (k.d > 0) tl.to("#cam", Object.assign({ duration: k.d, ease: "expo.out" }, a), k.t);
  } else if (k.d > 0) tl.to("#cam", Object.assign({ duration: k.d, ease: k.d > 0.6 ? "expo.inOut" : "power3.inOut" }, a), k.t);
  else tl.set("#cam", a, k.t);
  if (k.hold > 0.05) tl.to("#cam", Object.assign({ duration: k.hold, ease: "none" }, b), k.t + k.d);
  if (k.shot !== cur) {
    if (cur) tl.set("#s_" + cur.replace(/-/g, "_"), { opacity: 0 }, k.t);
    tl.set("#s_" + k.shot.replace(/-/g, "_"), { opacity: 1 }, i === 0 ? 0.001 : k.t);
    cur = k.shot;
  }
});
const s0 = "#s_" + P.CAM[0].shot.replace(/-/g, "_"); gsap.set(s0, { opacity: 1 });

// cursor: glides in, presses, ripples, leaves when the next click is far away
hide(["#cur", "#rip"]);
P.CLICKS.forEach(function (c, i) {
  const x = c[1] * K, y = c[2] * K, t = c[0];
  const prev = i > 0 ? P.CLICKS[i - 1] : null, next = i + 1 < P.CLICKS.length ? P.CLICKS[i + 1] : null;
  const fresh = !prev || t - prev[0] > 2.5;
  const t0 = Math.max(P.EXP + 0.8, t - 0.9);
  if (fresh) { tl.set("#cur", { x: x + 260, y: y + 180 }, t0); tl.to("#cur", { opacity: 1, duration: 0.15 }, t0); }
  tl.to("#cur", { x: x, y: y, duration: fresh ? 0.55 : 0.45, ease: "power2.inOut" }, t - (fresh ? 0.6 : 0.5));
  tl.to("#cur", { scale: 0.82, duration: 0.06, ease: "power2.in" }, t - 0.02);
  tl.to("#cur", { scale: 1, duration: 0.12, ease: "power2.out" }, t + 0.06);
  tl.fromTo("#rip", { opacity: 0.9, scale: 0.3 }, { opacity: 0, scale: 2.4, duration: 0.45, ease: "power2.out", immediateRender: false }, t);
  if (!next || next[0] - t > 2.5) tl.to("#cur", { opacity: 0, duration: 0.2 }, Math.min(P.OUT - 0.3, t + 0.6));
});

P.RINGS.forEach(function (r) {
  const el = "#" + r[0];
  gsap.set(el, { opacity: 0 }); tl.set(el, { opacity: 0 }, 0);
  tl.fromTo(el, { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, duration: 0.25, ease: "back.out(2.4)", immediateRender: false }, r[1]);
  tl.to(el, { opacity: 0, duration: 0.15 }, r[2] - 0.15);
});
P.CHIPS.forEach(function (c) {
  const el = "#" + c[0];
  gsap.set(el, { opacity: 0 }); tl.set(el, { opacity: 0 }, 0);
  tl.fromTo(el, { opacity: 0, y: 12, filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.35, ease: "expo.out", immediateRender: false }, c[1]);
  tl.to(el, { opacity: 0, duration: 0.15 }, c[2] - 0.15);
});

// composited layers (image / text), word-anchored, with optional authored transform
(P.LAYERS || []).forEach(function (L) {
  const el = "#L_" + L.id;
  gsap.set(el, { opacity: 0 }); tl.set(el, { opacity: 0 }, 0);
  tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "expo.out", immediateRender: false }, L["in"]);
  tl.to(el, { opacity: 0, duration: 0.3 }, L.out - 0.3);
  if (L.move) tl.fromTo(el, L.move.from, Object.assign({ duration: L.move.dur, ease: L.move.ease, immediateRender: false }, L.move.to), L.move.at);
});

// outro card
if (document.querySelector("#ocard")) {
  hide(["#ok", "#ob .w", "#os", "#oc"]);
  rise("#ok", P.OUT + 0.1); wordsIn("#ob", P.OUT + 0.25); rise("#os", P.OUT + 0.9); rise("#oc", P.OUT + 1.2);
}
tl.to({}, { duration: 0.001 }, P.DUR - 0.001);
window.__timelines = window.__timelines || {};
window.__timelines["main"] = tl;
window.__duration = P.DUR;
"""

PAYLOAD = {"DUR": DUR, "K": K, "TWIN": T_WIN, "EXP": EXP, "OUT": OUT, "CARD": CARD, "FULL": FULL, "CAM": CAM,
           "CLICKS": CLICKS, "RINGS": [r[:3] for r in RINGS], "CHIPS": [c[:3] for c in CHIPS],
           "LAYERS": [{k: v for k, v in L.items() if k in ("id", "in", "out", "move", "kind")} for L in LAYERS]}

if __name__ == "__main__":
    cues = ([["whoosh", T_WIN], ["swish", EXP], ["hit", 0.35]] + [["click", c[0]] for c in CLICKS]
            + [["pop", c[1]] for c in CHIPS] + [["tick", r[1]] for r in RINGS]
            + [["whoosh", c["t"]] for c in CAM[1:] if c["a0"]] + ([["whoosh", OUT], ["hit", OUT + 0.25]] if film.get("outro") else []))
    (ROOT / "src").mkdir(exist_ok=True)
    (ROOT / "src/sfx-cues.json").write_text(json.dumps(sorted(cues, key=lambda c: c[1])))
    (ROOT / "index.html").write_text(html())
    print(f"index.html: {DUR}s, {len(CAM)} camera keys, {len(CLICKS)} clicks, {len(CHIPS)} chips, {len(RINGS)} rings, {len(cues)} sfx cues")
