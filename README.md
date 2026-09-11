# Kora Utware — Ikizamini cya Provisoire

An offline-first PWA that simulates the Rwandan **provisional driving permit**
(*provisoire*) theory exam, built from the official question book.

- **398 questions** extracted from the 124-page book, in Kinyarwanda
- **145 sign images / road-scene photos**, cached for offline use
- Full exam simulation: **20 random questions · 20 minutes · pass at 12/20**
- **One free exam**, then **1,000 RWF once, forever** — paid by MoMo, unlocked
  by a code, with no payment processor and no backend
- Works with **no internet at all** once loaded; installable on Android and iPhone

---

## The exam it simulates

| Rule | Value |
|---|---|
| Questions per exam | 20, drawn at random from the whole bank |
| Pass mark | **12/20** (60%) |
| Time limit | 20 minutes (adjustable to 30, or off, in settings) |
| Format | Multiple choice, one correct answer of four |

Sources: [Irembo — provisional driving licence](https://support.irembo.gov.rw/en/support/solutions/articles/47001241773-everything-you-need-to-know-about-getting-your-e-provisional-driving-license)
and [Rwanda National Police — PDL](https://police.gov.rw/services/testing-and-licencing/provisional-driving-licence-pdl/).

---

## Making money from it

### What a new user gets free

One full timed exam, plus 5 practice questions — set in
[`config.js`](config.js). After that the app asks for **1,000 RWF, once**, and
everything is unlocked permanently on that phone.

The split is deliberate: the exam is the hook, practice is the product. Raising
the practice allowance much above this starts to make wiping the app and
starting again a workable substitute for buying it.

The pitch appears at the two moments that convert: on the **result screen**,
right after they see their score and know whether they are ready, and as a
**full paywall** the next time they try to start an exam or practise.

### How the money actually reaches you

There is no payment integration to set up, nothing to register for, and no
server to run. The flow is deliberately manual:

1. The buyer taps **Ishyura kuri MoMo** — this opens their dialer prefilled
   with the MTN send-money USSD string for your number and 1,000 RWF. (They can
   also copy the number; iOS blocks auto-dialling USSD.)
2. They send you the transaction ID on **WhatsApp** or **SMS** — the buttons
   open a prefilled message.
3. You check the payment arrived, take the next unused code out of
   `build/codes-private.csv`, and send it to them.
4. They type it into the app and it unlocks forever, offline.

### Generating codes

```bash
python build/5_codes.py 300     # 300 more codes, appended to the existing set
python build/5_codes.py --list  # what has been generated and handed out
```

This writes two things:

- **`data/unlock.json`** — PBKDF2 hashes only. Safe to commit and deploy.
- **`build/codes-private.csv`** — the actual codes. **This file is the
  product.** It is git-ignored; back it up somewhere private. If you lose it
  you lose the plaintext codes forever (already-unlocked phones stay unlocked).
  It has `issued_to` / `issued_on` / `note` columns — fill them in as you sell,
  so a leaked code can be traced back to a buyer.

Re-running the script **appends**; codes already sold keep working. Run
`python build/4_service_worker.py` afterwards so phones pick up the new list.

### Why the codes are hard to forge without a server

The app ships only hashes, never the codes. A code is 8 characters from a
31-character alphabet (~8.5 × 10¹¹ combinations, with `0 O 1 I L` left out so
nobody mistypes), and each guess costs **150,000 PBKDF2-SHA256 iterations**.
Guessing is therefore impractical, while a genuine unlock still takes a
fraction of a second on a phone.

### Stopping people from farming the free trial

The obvious worry: why pay 1,000 RWF if you can clear the app and get another
free exam? Here is what is actually true, and what the app does about it.

**Blocking by IP address does not work, and would cost you real sales.** Two
reasons. First, a static site has no server to see an IP — you would have to
add a backend, which is the thing you are trying to avoid. Second and worse:
nearly every phone on MTN and Airtel Rwanda sits behind carrier-grade NAT, so
thousands of unrelated subscribers share one public IP. Blocking "the IP that
already had a trial" would lock out a large block of genuine buyers who never
touched the app. It is the one approach that should be ruled out.

**What the app does instead — three stores that must agree.** The trial
counters and the licence are mirrored into `localStorage`, IndexedDB and Cache
Storage, and merged on every start, always keeping the *higher* usage count.
So:

- clearing any *one* of them does not restore the trial
- editing the counters back down in one store is overridden by the others
- the app also calls `navigator.storage.persist()` so the browser stops
  evicting it on its own

This kills the casual reset, which is the one that actually happens — someone
tapping "clear cache" or reinstalling the home-screen shortcut. It is verified
by a test that wipes each store in turn and checks the trial stays spent.

**A deliberate "clear site data" still resets it, and nothing client-side can
stop that.** Not this app, not any offline web app. The only real fixes are
accounts (sign in with a phone number or Google) or a server that counts
redemptions — both of which mean running a service, handling logins, and losing
the "works with no internet" property that makes this app worth paying for.

**So the design leans on making a reset not worth doing:**

- The free tier is one exam plus 5 practice questions — enough to prove the app
  is real, useless as a way to revise. The 398-question practice bank and the
  mistake tracker, which are what you actually study with, are behind the wall.
- A reset destroys all progress: exam history, readiness score, and the list of
  questions they keep getting wrong. Someone farming the trial is re-taking
  random 20-question exams with no memory between them — more effort than
  1,000 RWF is worth, and a worse way to prepare.

If it ever needs to be airtight, the upgrade is one serverless endpoint that
marks a code used on first redemption; `checkCode` in `app.js` is the only
function that would change.

### Two other limits worth knowing

- **A code works on more than one phone.** Nothing can phone home to say it was
  already redeemed. The `issued_to` column in the CSV is your defence: if a
  code spreads, you know whose it was and can stop selling to them.
- **The question bank is public** once deployed — it has to be, for the app to
  work offline. What you are selling is the packaged, working exam simulator,
  not secret content.

Buyers can see their own code under **Igenamiterere → Kode yawe** and copy it,
so if a phone is ever wiped or replaced they can restore the unlock themselves
without contacting you.

### Setting it up

[`config.js`](config.js) is configured for **GACACA Godwin, 0791 631 361**
(MoMo, WhatsApp and SMS all on that number). Change it there if the number ever
changes; nothing else in the app needs touching.

---

## What's in the app

**Ikizamini (Exam)** — one question per screen, live countdown, no feedback
until you submit. Flag questions, jump around with the question grid, and the
timer keeps running even if the app is closed. At 0:00 it submits itself.
Unfinished exams are saved and resumable.

**Kwimenyereza (Practice)** — instant right/wrong feedback, no clock, split by
**Ibyapa** (road signs, 180) and **Amategeko** (road rules, 218).

**Amakosa yanjye** — replays only the questions he has got wrong; a question
drops off the list once he answers it correctly again.

**Progress** — a readiness percentage from the last five exams, best score, a
bar chart of recent attempts, and a full history where any past exam can be
reopened and reviewed question by question.

**Igenamiterere (Settings)** — behind the gear in the top right:

- **Imiterere** — light, dark, or follow the phone. The choice is applied
  before first paint, so switching to dark doesn't flash white on launch.
- **Ikizamini** — exam length (20 / 30 minutes / untimed) and the last-minute
  warning.
- **Uburenganzira** — the unlock button, or the buyer's own code with a copy
  button once paid.
- **Porogaramu** — install to the home screen (with written instructions on
  iOS, which never fires an install event), force an update when a phone is
  stuck on an old cached version, and a prefilled WhatsApp/SMS line for support.
- **Siba amateka yose** — clears history and mistakes. It never touches the
  licence.

Every question shows its page number in the source book, so any answer can be
checked against the original.

---

## Design

The interface was redesigned around **traffic-signal semantics**: green means
go and pass, amber means caution and flagged, red means stop and wrong — the
same language the road code itself uses, so colour carries meaning rather than
decoration. Warm paper ground, always-dark chrome for the exam bar and paywall,
hairline borders, and tabular numerals for the figures that matter (score,
timer, counts).

The full design canvas — eleven phone artboards plus the system sheet and two
directions not taken — is at
<https://claude.ai/code/artifact/6875abbe-ccd4-4387-a93e-fa62c7e27691>, with
source in [`design/`](design/).

The interface is Kinyarwanda throughout, matching the exam and the book.
Nothing is hard-coded against a second language, so an English toggle can be
added later without restructuring.

> The mockups use Space Grotesk for numerals. The shipped app uses the system
> font stack instead, so that nothing has to be fetched at runtime and the
> offline payload stays small. To match the mockups exactly, self-host the
> woff2 and add it to `--display` in `styles.css`.

---

## Running it

The app must be served over HTTP — opening `index.html` from the file system
will not work, because browsers block `fetch()` on `file://`.

```bash
python -m http.server 8777
```

### Deploying to Vercel

A plain static site: no build step, no server code, no dependencies.

1. **Add New → Project**, import `Gacaca6/KoraUtsinde`
2. Framework preset **Other**; leave build command and output directory empty
3. Deploy

`vercel.json` sets the headers that matter: `sw.js`, `index.html`, `config.js`
and `data/` are `must-revalidate` so a redeploy actually reaches phones;
`manifest.webmanifest` gets the `application/manifest+json` type iOS needs
before it will treat the site as installable; `img/` and `icons/` are cached
for a year. `.vercelignore` keeps `build/` and the README out of the deploy.

### Putting it on a phone

- **iPhone / Safari:** share → *Add to Home Screen*. Must be Safari; Chrome on
  iOS cannot install PWAs.
- **Android / Chrome:** menu → *Install app*, or the **Shyiraho** button.

All 2.2 MB of assets are precached on first load. If the connection drops
mid-download the app repairs the gaps on the next load rather than sitting
half-cached.

### How updates reach an installed app

An installed PWA can sit on an old build forever if you get this wrong, and on
iOS its storage is a **separate partition from Safari** — so Safari showing your
latest deploy proves nothing about the icon on the home screen.

Three things keep them in step, and none of them need you to remember anything:

1. **The shell is served network-first.** `index.html`, `app.js`, `styles.css`,
   `config.js` and `data/*.json` go to the network first on every launch, with
   a 3.5-second timeout and the cache as fallback. So a deploy lands on the next
   launch with a connection — *even if `sw.js` itself never changed*. Images are
   served from cache instantly and refreshed in the background.
2. **The worker is re-checked on every launch and every time the app returns to
   the foreground**, not just on navigation, which an installed app may not do
   for weeks.
3. **When a new worker takes over, the app reloads itself** — except mid-exam,
   where it waits until the exam is finished.

There is also **Igenamiterere → Kuvugurura porogaramu** to force it by hand, and
the running build id is shown at the bottom of settings so "did my update
actually land?" is answerable on the phone.

> This is why `build/4_service_worker.py` is no longer critical for ordinary
> edits. Run it when you **add or remove files**, so the precache list matches
> what is on disk. Content changes reach phones either way.

**One-time catch-up for a phone already stuck on an old build:** it is still
running the old cache-first worker, which has to be replaced before any of the
above applies. Open the app with a connection, wait a few seconds, close it
fully, and open it again. If it still looks stale, remove it from the home
screen and add it once more — after that it keeps itself current.

> **`PDF.pdf` is git-ignored** — the source book is stamped *RESTRICTED* on
> every page and this repository is public. The app never reads it; it only
> reads `data/questions.json`.

---

## Layout

```
index.html              app shell and all screens
app.js                  exam engine, practice, stats, entitlement, paywall
config.js               ← your MoMo / WhatsApp details and trial limits
styles.css              design system, light + dark
sw.js                   generated service worker (precaches 157 assets)
manifest.webmanifest    PWA manifest
vercel.json             cache + content-type headers
data/questions.json     398 questions (131 KB)
data/unlock.json        PBKDF2 hashes of valid unlock codes
img/                    145 sign images (1.9 MB)
icons/                  app icons (incl. apple-touch-icon, maskable)
design/                 design canvas source (.dc.html artboards)
build/                  extraction + code-generation pipeline
PDF.pdf                 the source question book (git-ignored)
```

---

## How the questions were extracted

The book marks the correct answer **two** ways: a highlight rectangle behind
the right option, and a `(` before its letter — e.g. `(c) A na B ni ibisubizo
by'ukuri`. The extractor reads both and cross-checks them.

Across 404 parsed questions: every one parsed with exactly 4 options; both
markers present and **agreeing on 359**, disagreeing on **1**; 41 resolved by
highlight alone, 3 by parenthesis alone; answers spread evenly across A/B/C/D
(96/107/109/86), so nothing is defaulting.

The single disagreement (page 50 — a warning triangle showing a pedestrian on a
zebra crossing) was resolved by hand in favour of the parenthesis, which
matches what the sign means; a stray highlight sits on the wrong option in the
book. It is an explicit override in `build/2_finalize.py`. Six exact duplicates
were removed, leaving **398**.

Images are pulled from the PDF as embedded objects with their soft masks
re-applied, then trimmed and colour-reduced — 16.3 MB down to 1.9 MB.

Answers are reproduced exactly as the book marks them. Where the book has a
typo or an odd answer, the app repeats it — the point is to practise against
the same material the real test is drawn from, and the page number on each
question makes disputes easy to settle.

### Rebuilding

```bash
python build/1_extract.py          # PDF -> questions_raw.json + img/
python build/2_finalize.py         # -> data/questions.json
python build/3_icons.py            # -> icons/
python build/5_codes.py 300        # -> data/unlock.json + private CSV
python build/4_service_worker.py   # LAST — stamps the cache version
```

Step 1 reports any question it could not parse confidently. Requires Python
with `pymupdf` and `pillow`.
