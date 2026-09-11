"""Generate unlock codes for the 1,000 RWF lifetime licence.

No backend, no payment processor. You generate a batch of codes here,
hand one to each person who pays by MoMo, and the app verifies it
offline.

How it stays hard to forge without a server: the app ships only
PBKDF2-SHA256 hashes of the codes, never the codes themselves. A code
is 8 characters from a 31-character alphabet (~8.5e11 combinations) and
each guess costs 150,000 PBKDF2 iterations, so brute-forcing the list
is impractical while a real unlock still takes a fraction of a second
on a phone.

  python build/5_codes.py            -> 300 more codes (appends)
  python build/5_codes.py 50         -> 50 more codes
  python build/5_codes.py --list     -> show what has been issued

Codes you can hand out land in build/codes-private.csv, which is
git-ignored. That file IS the product - keep it, back it up, and never
commit or share it. Deleting it loses the plaintext codes forever (the
app keeps only hashes), though already-unlocked phones stay unlocked.
"""
import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.dirname(_HERE)

import csv
import hashlib
import json
import secrets
import sys
from datetime import date

ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"   # no 0 O 1 I L
CODE_LEN = 8
ITERATIONS = 150_000
DK_BYTES = 8                                    # 16 hex chars per entry

MANIFEST = _os.path.join(_ROOT, "data", "unlock.json")
PRIVATE = _os.path.join(_HERE, "codes-private.csv")


def digest(code: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", code.encode("utf-8"), salt.encode("utf-8"),
        ITERATIONS, dklen=DK_BYTES
    ).hex()


def make_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LEN))


def pretty(code: str) -> str:
    return f"{code[:4]}-{code[4:]}"


def load_manifest():
    if _os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            m = json.load(f)
        if m.get("iter") != ITERATIONS or m.get("len") != CODE_LEN:
            sys.exit("Existing data/unlock.json uses different settings — "
                     "changing them would invalidate every code already sold.")
        return m
    return {"v": 1, "salt": secrets.token_hex(16), "iter": ITERATIONS,
            "len": CODE_LEN, "hashes": []}


def load_private():
    if not _os.path.exists(PRIVATE):
        return []
    with open(PRIVATE, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def save_private(rows):
    with open(PRIVATE, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["code", "batch", "issued_to", "issued_on", "note"])
        w.writeheader()
        w.writerows(rows)


def main():
    args = [a for a in sys.argv[1:]]
    rows = load_private()

    if "--list" in args:
        used = sum(1 for r in rows if r.get("issued_to"))
        print(f"{len(rows)} codes generated · {used} handed out · {len(rows) - used} spare")
        for r in rows:
            if r.get("issued_to"):
                print(f"  {pretty(r['code'])}  ->  {r['issued_to']}  ({r.get('issued_on','')})")
        return

    count = 300
    for a in args:
        if a.isdigit():
            count = int(a)

    manifest = load_manifest()
    known = {r["code"] for r in rows}
    batch = date.today().isoformat()

    fresh = []
    while len(fresh) < count:
        c = make_code()
        if c in known:
            continue
        known.add(c)
        fresh.append(c)

    print(f"hashing {count} codes ({ITERATIONS:,} iterations each) …")
    for c in fresh:
        manifest["hashes"].append(digest(c, manifest["salt"]))
        rows.append({"code": c, "batch": batch, "issued_to": "", "issued_on": "", "note": ""})

    manifest["hashes"] = sorted(set(manifest["hashes"]))
    _os.makedirs(_os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, separators=(",", ":"))
    save_private(rows)

    print(f"data/unlock.json      {len(manifest['hashes'])} hashes "
          f"({_os.path.getsize(MANIFEST) / 1024:.1f} KB) — safe to commit")
    print(f"build/codes-private.csv  {len(rows)} codes — git-ignored, keep this safe")
    print("\nnext codes to hand out:")
    for c in fresh[:5]:
        print("   ", pretty(c))
    if len(fresh) > 5:
        print(f"    … and {len(fresh) - 5} more in the CSV")


if __name__ == "__main__":
    main()
