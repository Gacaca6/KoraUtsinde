"""Extract the Rwandan provisoire question bank from PDF.pdf.

Correct answers are marked two ways in the source: a highlight rectangle
(yellow or green) behind the option text, and/or a '(' before the option
letter. Highlights are primary, parens secondary; disagreements are reported.
"""
import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.dirname(_HERE)

import fitz, re, json, os
from collections import Counter

SRC = _os.path.join(_ROOT, "PDF.pdf")
OUT_DIR = _ROOT
IMG_DIR = os.path.join(OUT_DIR, "img")
os.makedirs(IMG_DIR, exist_ok=True)
for f in os.listdir(IMG_DIR):
    os.remove(os.path.join(IMG_DIR, f))

doc = fitz.open(SRC)

# "12. Text" / "12.Text" / "12)" alone / "225Wegereye"
Q_NUM = re.compile(r'^\(?(\d{1,3})\s*[.)]\s*(?!\d)(.*)$', re.S)
Q_BARE = re.compile(r'^\(?(\d{1,3})\s*[.)]\s*$')
Q_GLUED = re.compile(r'^(\d{2,3})(?=[A-Z][a-z])(.*)$', re.S)
OPT_RE = re.compile(r'^(\()?\s*([a-dA-D])\s*[).:]\s*(.*)$', re.S)

HEADER_Y, FOOTER_Y = 52, 552
MIN_DIM, MIN_AREA = 8, 400


def q_candidate(txt):
    """Return (num, rest) if this line starts a question, else None."""
    if OPT_RE.match(txt) and not Q_NUM.match(txt):
        return None
    m = Q_BARE.match(txt)
    if m:
        return int(m.group(1)), ""
    m = Q_NUM.match(txt)
    if m and m.group(2).strip():
        return int(m.group(1)), m.group(2).strip()
    m = Q_GLUED.match(txt)
    if m and len(txt) > 15:
        return int(m.group(1)), m.group(2).strip()
    return None


# ---------- highlights ----------
highlights = {}
for pno, page in enumerate(doc):
    rects = []
    for g in page.get_drawings():
        f = g["fill"]
        if not f:
            continue
        if tuple(round(c, 2) for c in f) not in ((1.0, 1.0, 0.0), (0.0, 1.0, 0.0)):
            continue
        r = g["rect"]
        if r.width < 12 or r.height < 6:
            continue
        rects.append(r)
    highlights[pno] = rects


def hl_overlap(pno, bbox):
    r = fitz.Rect(bbox)
    if r.get_area() <= 0:
        return 0.0
    best = 0.0
    for h in highlights.get(pno, ()):
        inter = r & h
        if not inter.is_empty:
            best = max(best, inter.get_area() / r.get_area())
    return best


# xref (and soft-mask xref) for every placed image, so transparency survives
smask_of = {item[0]: item[1] for pno in range(doc.page_count)
            for item in doc[pno].get_images(full=True)}


def xref_for(page, bbox):
    """Match a text-dict image block to its PDF xref via bbox overlap."""
    target = fitz.Rect(bbox)
    best, best_score = None, 0.0
    for info in page.get_image_info(xrefs=True):
        inter = target & fitz.Rect(info["bbox"])
        if inter.is_empty:
            continue
        score = inter.get_area() / max(target.get_area(), 1e-6)
        if score > best_score:
            best, best_score = info.get("xref"), score
    return best if best_score > 0.5 else None


# ---------- 1. reading-order stream ----------
stream = []
for pno, page in enumerate(doc):
    items = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] == 0:
            for ln in b["lines"]:
                txt = "".join(s["text"] for s in ln["spans"]).replace("\u00a0", " ").strip()
                if not txt:
                    continue
                bb = ln["bbox"]
                if bb[1] < HEADER_Y and re.fullmatch(r'\d{1,3}', txt):
                    continue
                if bb[1] > FOOTER_Y and "RESTRICTED" in txt.upper():
                    continue
                if txt.upper() in ("IKINYARWANDA", "RESTRICTED"):
                    continue
                items.append((bb[1], bb[0], "T", txt, bb))
        else:
            x0, y0, x1, y1 = b["bbox"]
            w, h = x1 - x0, y1 - y0
            if w < MIN_DIM or h < MIN_DIM or w * h < MIN_AREA:
                continue
            items.append((y0, x0, "I",
                          {"raw": b.get("image"), "xref": xref_for(page, b["bbox"])},
                          (x0, y0, x1, y1)))
    items.sort(key=lambda t: (round(t[0], 0), t[1]))
    for y, x, kind, txt, bb in items:
        stream.append({"p": pno, "y": y, "x": x, "kind": kind,
                       "txt": None if kind == "I" else txt,
                       "raw": txt if kind == "I" else None, "bb": bb})

# ---------- 2. split at every candidate ----------
raw_blocks, cur = [], None
for it in stream:
    if it["kind"] == "T":
        cand = q_candidate(it["txt"])
        if cand and cand[0] <= 500:
            if cur:
                raw_blocks.append(cur)
            cur = {"num": cand[0], "page": it["p"] + 1, "items": []}
            if cand[1]:
                cur["items"].append(dict(it, txt=cand[1]))
            continue
    if cur is not None:
        cur["items"].append(it)
if cur:
    raw_blocks.append(cur)


def n_opts(blk):
    return sum(1 for it in blk["items"]
               if it["kind"] == "T" and OPT_RE.match(it["txt"]) and len(it["txt"]) < 400)


# ---------- 3. merge false splits (blocks with <2 option labels) back ----------
blocks = []
for blk in raw_blocks:
    if blocks and n_opts(blk) < 2:
        prev = blocks[-1]
        prev["items"].append({"p": blk["page"] - 1, "y": 0, "x": 0, "kind": "T",
                              "txt": f'{blk["num"]}.', "bb": (0, 0, 0, 0)})
        prev["items"].extend(blk["items"])
    else:
        blocks.append(blk)


MAX_DIM = 340


def save_image(im, tag):
    """Write the embedded image itself (no surrounding page text), trimmed,
    flattened onto white, downscaled and colour-reduced for offline size."""
    from PIL import Image, ImageChops
    import io

    src = im["raw"] or {}
    xref = src.get("xref")
    pic = None
    if xref:
        pix = fitz.Pixmap(doc, xref)
        if pix.n - pix.alpha >= 4:                      # CMYK -> RGB
            pix = fitz.Pixmap(fitz.csRGB, pix)
        sm = smask_of.get(xref)
        if sm:                                          # re-attach transparency
            try:
                pix = fitz.Pixmap(pix, fitz.Pixmap(doc, sm))
            except Exception:
                pass
        pic = Image.open(io.BytesIO(pix.tobytes("png")))
    elif src.get("raw"):
        pic = Image.open(io.BytesIO(src["raw"]))

    if pic is None:  # fallback: render the page region
        pad = 3
        b = im["bbox"]
        clip = fitz.Rect(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad)
        px = doc[im["page"]].get_pixmap(matrix=fitz.Matrix(3.2, 3.2), clip=clip, alpha=False)
        pic = Image.open(io.BytesIO(px.tobytes("png")))

    if pic.mode in ("RGBA", "LA", "P"):
        pic = pic.convert("RGBA")
        bg = Image.new("RGBA", pic.size, (255, 255, 255, 255))
        pic = Image.alpha_composite(bg, pic)
    pic = pic.convert("RGB")

    # trim uniform white margin
    bgim = Image.new("RGB", pic.size, (255, 255, 255))
    diff = ImageChops.difference(pic, bgim).convert("L")
    box = diff.point(lambda v: 255 if v > 12 else 0).getbbox()
    if box:
        pad = 4
        pic = pic.crop((max(0, box[0] - pad), max(0, box[1] - pad),
                        min(pic.width, box[2] + pad), min(pic.height, box[3] + pad)))

    if max(pic.size) > MAX_DIM:
        s = MAX_DIM / max(pic.size)
        pic = pic.resize((max(1, round(pic.width * s)), max(1, round(pic.height * s))),
                         Image.LANCZOS)

    pic = pic.quantize(colors=64, method=Image.MEDIANCUT, dither=Image.NONE)
    pic.save(os.path.join(IMG_DIR, tag + ".png"), optimize=True)
    return "img/" + tag + ".png"


# ---------- 4. parse ----------
questions, problems = [], []
for bi, blk in enumerate(blocks):
    stem_parts, opts, imgs = [], [], []
    for it in blk["items"]:
        gy = it["p"] * 1000 + it["y"]
        if it["kind"] == "I":
            imgs.append({"page": it["p"], "y": gy, "x": it["x"],
                         "bbox": it["bb"], "raw": it["raw"]})
            continue
        m = OPT_RE.match(it["txt"])
        if m and len(it["txt"]) < 400:
            opts.append({"paren": bool(m.group(1)), "letter": m.group(2).lower(),
                         "text": m.group(3).strip(), "y": gy, "x": it["x"],
                         "lines": [(it["p"], it["bb"])], "img": None})
        elif opts:
            opts[-1]["text"] = (opts[-1]["text"] + " " + it["txt"]).strip()
            opts[-1]["lines"].append((it["p"], it["bb"]))
        else:
            stem_parts.append(it["txt"])

    stem = re.sub(r'\s+', ' ', " ".join(stem_parts)).strip()
    for o in opts:
        o["hl"] = max((hl_overlap(p, bb) for p, bb in o["lines"]), default=0.0)

    image_options = bool(opts) and all(o["text"] == "" for o in opts)
    stem_images = []
    if image_options:
        for im in imgs:
            best, best_cost = None, 1e9
            for o in opts:
                if o["y"] <= im["y"] or o["img"] is not None:
                    continue
                cost = (o["y"] - im["y"]) + 0.5 * abs(o["x"] - im["x"])
                if cost < best_cost:
                    best, best_cost = o, cost
            if best is not None:
                best["img"] = im
    else:
        stem_images = imgs

    hl_c = [i for i, o in enumerate(opts) if o["hl"] >= 0.30]
    pr_c = [i for i, o in enumerate(opts) if o["paren"]]
    if len(hl_c) == 1:
        answer, src = hl_c[0], "highlight"
    elif len(pr_c) == 1:
        answer, src = pr_c[0], "paren"
    elif len(hl_c) > 1 and len(pr_c) == 1 and pr_c[0] in hl_c:
        answer, src = pr_c[0], "both"
    else:
        answer, src = None, "none"

    q = {"idx": bi, "n": blk["num"], "page": blk["page"], "stem": stem,
         "image_options": image_options, "answer": answer, "answer_src": src,
         "stem_images": [save_image(im, f"q{bi:04d}_s{i}")
                         for i, im in enumerate(stem_images)],
         "options": []}
    for oi, o in enumerate(opts):
        e = {"text": o["text"], "hl": round(o["hl"], 2), "paren": o["paren"]}
        if o["img"]:
            e["image"] = save_image(o["img"], f"q{bi:04d}_o{oi}")
        q["options"].append(e)

    issues = []
    if len(opts) != 4:
        issues.append(f"{len(opts)}opts")
    if answer is None:
        issues.append(f"no-answer(hl={len(hl_c)},pr={len(pr_c)})")
    elif len(hl_c) == 1 and len(pr_c) == 1 and hl_c[0] != pr_c[0]:
        issues.append(f"CONFLICT hl={hl_c[0]} pr={pr_c[0]}")
    if not stem and not q["stem_images"]:
        issues.append("empty-stem")
    if image_options and any("image" not in o for o in q["options"]):
        issues.append("missing-opt-img")
    q["issues"] = issues
    if issues:
        problems.append((bi, blk["num"], blk["page"], "; ".join(issues), stem[:60]))
    questions.append(q)

with open(_os.path.join(_HERE, "questions_raw.json"), "w", encoding="utf-8") as f:
    json.dump(questions, f, ensure_ascii=False, indent=1)

print("raw blocks:", len(raw_blocks), "-> merged blocks:", len(blocks))
print("answer source:", Counter(q["answer_src"] for q in questions))
print("option counts:", Counter(len(q["options"]) for q in questions))
print("image-option questions:", sum(1 for q in questions if q["image_options"]))
print("stem-image questions:", sum(1 for q in questions if q["stem_images"]))
print("clean:", len(questions) - len(problems), " problems:", len(problems))
print("images written:", len(os.listdir(IMG_DIR)))
print("\n--- problems ---")
for p in problems:
    print(p)
