"""Turn questions_raw.json into the app's questions.json."""
import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.dirname(_HERE)

import json, re, os, hashlib, datetime
from collections import Counter, defaultdict

ROOT = _ROOT
raw = json.load(open(_os.path.join(_HERE, "questions_raw.json"), encoding="utf-8"))

# --- manual corrections (verified by reading the sign image) ---
# idx 215: warning triangle showing a pedestrian on a zebra crossing.
# A stray yellow highlight sits on option c, but the parenthesis marker and the
# sign itself both give option d ("approaching a pedestrian crossing").
OVERRIDES = {215: 3}

CLEAN_RE = [
    (re.compile(r'\s+'), ' '),
    (re.compile(r'\s+([,.;:?!])'), r'\1'),
    (re.compile(r'\(\s+'), '('),
]


def clean(s):
    s = s.replace('\u2019', '’').strip()
    for rx, rep in CLEAN_RE:
        s = rx.sub(rep, s)
    return s.strip(' .;,')


def img_hash(path):
    p = os.path.join(ROOT, path)
    return hashlib.md5(open(p, 'rb').read()).hexdigest()[:10] if os.path.exists(p) else ''


SIGN_WORDS = ('cyapa', 'byapa', 'ikimenyetso', 'ibimenyetso', 'icyapa', 'gisobanura')

out, seen = [], {}
dropped = 0
for q in raw:
    ans = OVERRIDES.get(q["idx"], q["answer"])
    if ans is None:
        dropped += 1
        continue
    stem = clean(q["stem"])
    opts = []
    for o in q["options"]:
        e = {"t": clean(o["text"])}
        if "image" in o:
            e["i"] = o["image"]
        opts.append(e)

    key = (re.sub(r'[^a-z0-9]', '', stem.lower())
           + "|" + "|".join(re.sub(r'[^a-z0-9]', '', o["t"].lower()) for o in opts)
           + "|" + "|".join(img_hash(p) for p in q["stem_images"])
           + "|" + "|".join(img_hash(o["i"]) for o in opts if "i" in o))
    if key in seen:
        dropped += 1
        continue
    seen[key] = True

    has_img = bool(q["stem_images"]) or any("i" in o for o in opts)
    is_sign = has_img or any(w in stem.lower() for w in SIGN_WORDS)

    item = {"id": len(out) + 1, "q": stem, "o": opts, "a": ans,
            "c": "sign" if is_sign else "rule", "p": q["page"]}
    if q["stem_images"]:
        item["qi"] = q["stem_images"]
    out.append(item)

data = {
    "version": 1,
    "generated": datetime.date.today().isoformat(),
    "source": "Provisoire question book (PDF, 124 pages)",
    "count": len(out),
    "questions": out,
}
dest = os.path.join(ROOT, "data", "questions.json")
os.makedirs(os.path.dirname(dest), exist_ok=True)
with open(dest, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

print("questions kept:", len(out), " dropped (dupes/no-answer):", dropped)
print("categories:", Counter(q["c"] for q in out))
print("answer spread:", Counter(q["a"] for q in out))
print("with question image:", sum(1 for q in out if "qi" in q))
print("with option images:", sum(1 for q in out if any("i" in o for o in q["o"])))
print("json size: %.1f KB" % (os.path.getsize(dest) / 1024))

longest = sorted(out, key=lambda q: -max(len(o["t"]) for o in q["o"]))[:3]
for q in longest:
    print("\nlongest option (id %d, p%d):" % (q["id"], q["p"]),
          max((o["t"] for o in q["o"]), key=len)[:160])
