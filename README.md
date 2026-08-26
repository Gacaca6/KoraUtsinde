# Kora Utware — Ikizamini cya Provisoire

An offline-first PWA that simulates the Rwandan **provisional driving permit**
(*provisoire*) theory exam, built from the official question book in `PDF.pdf`.

- **398 questions** extracted from the 124-page book, in Kinyarwanda
- **145 sign images / road-scene photos**, embedded and cached for offline use
- Full exam simulation: **20 random questions · 20 minutes · pass at 12/20**
- Works with **no internet at all** once loaded; installable to a phone home screen

---

## The exam it simulates

| Rule | Value |
|---|---|
| Questions per exam | 20, drawn at random from the whole bank |
| Pass mark | **12/20** (60%) |
| Time limit | 20 minutes (adjustable to 30, or off, in settings) |
| Format | Multiple choice, one correct answer of four |

Sources: [Irembo — provisional driving licence](https://support.irembo.gov.rw/en/support/solutions/articles/47001241773-everything-you-need-to-know-about-getting-your-e-provisional-driving-license)
(pass mark 12/20, or 60% at the Busanza automated test centre) and
[Rwanda National Police — PDL](https://police.gov.rw/services/testing-and-licencing/provisional-driving-licence-pdl/)
(minimum age 18; the permit is valid one year and renewable once).

Note: one source describes the exam as taking "not more than 30 minutes", so the
timer is configurable. The default is the 20 minutes you specified.

---

## What's in the app

**Ikizamini (Exam)** — the serious one. One question per screen, live countdown,
no feedback until you submit. Flag questions for review, jump around with the
question grid, and the timer keeps running even if the app is closed. At 0:00 it
submits automatically. Unfinished exams are saved and can be resumed.

**Kwimenyereza (Practice)** — instant right/wrong feedback, no clock. Split by
**Ibyapa** (road signs, 180) and **Amategeko** (road rules, 218).

**Amakosa yanjye (My mistakes)** — replays only the questions he has got wrong.
A question drops off the list once he answers it correctly again.

**Progress** — readiness percentage from the last five exams, best/average score,
a bar chart of recent attempts, and a full history where every past exam can be
reopened and reviewed question by question.

Every question shows its page number in the source book, so any answer can be
checked against the original.

---

## Running it

The app must be served over HTTP — opening `index.html` directly from the file
system will not work, because browsers block `fetch()` on `file://` URLs.

```bash
python -m http.server 8777
```

Then open <http://localhost:8777>.

### Deploying to Vercel

This is a plain static site — no build step, no server code, no dependencies.

1. On [vercel.com](https://vercel.com), **Add New → Project** and import
   `Gacaca6/KoraUtsinde`.
2. Framework preset: **Other**. Leave build command and output directory empty.
3. Deploy.

`vercel.json` is already set up with the headers that matter:

- `sw.js` and `index.html` are served `must-revalidate`, so a redeploy actually
  reaches phones instead of being pinned by the CDN
- `manifest.webmanifest` gets the correct `application/manifest+json` type,
  which iOS needs before it will treat the site as an installable app
- `img/` and `icons/` are cached immutably for a year

`.vercelignore` keeps `build/` and the README out of the deployment.

### Putting it on a phone

The phone loads the app once from the Vercel URL; after that it runs offline
forever.

- **iPhone / Safari:** share button → *Add to Home Screen*. It must be Safari —
  Chrome on iOS cannot install PWAs. Once added it launches full-screen with its
  own icon and works in airplane mode.
- **Android / Chrome:** menu → *Install app*, or the *Shyiraho* button in the
  app's header.

All 2.1 MB of assets are precached by the service worker on first load, so no
data connection is needed afterwards.

> **`PDF.pdf` is deliberately git-ignored.** The source book is stamped
> *RESTRICTED* on every page and this repository is public, so the PDF stays on
> your machine. The app never reads it — only `data/questions.json`. If you want
> the PDF backed up too, put it in a private repo rather than this one.

---

## Layout

```
index.html              app shell
app.js                  exam engine, practice, stats, routing
styles.css              light + dark theme
sw.js                   generated service worker (precaches all 155 assets)
manifest.webmanifest    PWA manifest
vercel.json             cache + content-type headers for deployment
data/questions.json     398 questions (131 KB)
img/                    145 sign images (1.9 MB)
icons/                  app icons (incl. apple-touch-icon, maskable)
build/                  extraction pipeline (not needed at runtime)
PDF.pdf                 the source question book (git-ignored)
```

The interface is Kinyarwanda throughout, matching the language of the exam and
of the question book. Nothing is hard-coded against a second language, so an
English toggle can be added later without restructuring anything.

---

## How the questions were extracted

The book marks the correct answer in **two independent ways**: a highlight
rectangle (yellow, sometimes green) behind the right option, and a `(` before
its letter — e.g. `(c) A na B ni ibisubizo by'ukuri`. The extractor reads both
and cross-checks them.

Result across 404 parsed questions:

- **every** question parsed with exactly 4 options
- both markers present and **agreeing on 359**, disagreeing on **1**
- 41 resolved by highlight only, 3 by parenthesis only
- answers spread evenly across A/B/C/D (96/107/109/86), so nothing is defaulting

The single disagreement (source page 50 — a red warning triangle showing a
pedestrian on a zebra crossing) was resolved by hand in favour of the
parenthesis marker, which matches what the sign actually means; a stray
highlight sits on the wrong option in the book. It is recorded as an explicit
override in `build/2_finalize.py`.

Six exact duplicate questions in the book were removed, leaving **398**.

Images are pulled from the PDF as embedded objects rather than screenshots, with
their soft masks re-applied (otherwise transparent signs render on black), then
trimmed, downscaled and colour-reduced — 16.3 MB down to 1.9 MB with no visible
loss.

Answers are reproduced exactly as the book marks them. Where the book has typos
or an odd answer, the app repeats it — the point is to practise against the same
material the real test is drawn from. The source page number on each question
makes disputes easy to settle.

### Rebuilding

If the PDF is ever replaced, re-run the pipeline in order:

```bash
python build/1_extract.py
python build/2_finalize.py
python build/3_icons.py
python build/4_service_worker.py
```

Step 1 reports any question it could not parse confidently. Step 4 must be run
last — it stamps a new cache version so phones pick up the update.

Requires Python with `pymupdf` and `pillow`.
