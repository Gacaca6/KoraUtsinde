"""Generate sw.js with a precache list of every app asset."""
import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.dirname(_HERE)

import os, hashlib, json

ROOT = _ROOT
ROOTS = ["index.html", "styles.css", "app.js", "manifest.webmanifest",
         "data/questions.json"]
DIRS = ["icons", "img"]

assets = list(ROOTS)
for d in DIRS:
    p = os.path.join(ROOT, d)
    for f in sorted(os.listdir(p)):
        if f.lower().endswith((".png", ".webp", ".jpg", ".svg")):
            assets.append(f"{d}/{f}")

h = hashlib.md5()
total = 0
for a in assets:
    fp = os.path.join(ROOT, a.replace("/", os.sep))
    with open(fp, "rb") as fh:
        b = fh.read()
    total += len(b)
    h.update(b)
version = h.hexdigest()[:10]

sw = f"""/* Kora Utware — service worker (generated; do not edit by hand).
   Precaches the whole app so it runs with no internet at all. */

const CACHE = 'kora-utware-{version}';
const ASSETS = {json.dumps(assets, indent=2)};

self.addEventListener('install', event => {{
  event.waitUntil((async () => {{
    const cache = await caches.open(CACHE);
    // addAll is all-or-nothing; add individually so one bad file can't
    // break the whole install.
    await Promise.all(ASSETS.map(async url => {{
      try {{
        const res = await fetch(url, {{ cache: 'reload' }});
        if (res.ok) await cache.put(url, res);
      }} catch (e) {{ /* skip; fetched on demand later */ }}
    }}));
    self.skipWaiting();
  }})());
}});

self.addEventListener('activate', event => {{
  event.waitUntil((async () => {{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  }})());
}});

self.addEventListener('fetch', event => {{
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the shell from cache so the app opens offline.
  if (req.mode === 'navigate') {{
    event.respondWith((async () => {{
      const cached = await caches.match('index.html');
      if (cached) return cached;
      try {{ return await fetch(req); }}
      catch (e) {{ return new Response('Offline', {{ status: 503 }}); }}
    }})());
    return;
  }}

  event.respondWith((async () => {{
    const cached = await caches.match(req, {{ ignoreSearch: true }});
    if (cached) return cached;
    try {{
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    }} catch (e) {{
      return new Response('Offline', {{ status: 503 }});
    }}
  }})());
}});
"""

with open(os.path.join(ROOT, "sw.js"), "w", encoding="utf-8") as f:
    f.write(sw)

print(f"sw.js written · {len(assets)} assets · {total/1024/1024:.2f} MB · cache {version}")
