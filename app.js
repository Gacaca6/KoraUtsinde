/* ══ Kora Utware — ikizamini cya provisoire ═══════════════════════════
   Offline exam simulator built on the official provisoire question book.
   Exam rules: 20 random questions, 12/20 to pass, 20 minutes.

   Licensing: one free exam plus a handful of practice questions, then a
   one-off payment unlocks everything for good. Codes are verified
   offline against PBKDF2 hashes shipped in data/unlock.json — no
   backend, no payment processor, works with no connection.
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

const CFG = window.KORA || {};
const EXAM_SIZE = 20;
const PASS_MARK = 12;
const LETTERS = ['A', 'B', 'C', 'D'];
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const KEY = {
  stats: 'kora.stats.v1',
  prefs: 'kora.prefs.v1',
  exam:  'kora.exam.v1',
  ent:   'kora.ent.v1',
  entBak:'kora.lic.v1',
};

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ── storage ───────────────────────────────────────────────────────── */
const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};
const save = (key, val) => {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* private mode */ }
};

let BANK = [];
let byId = new Map();
let stats = load(KEY.stats, { attempts: [], perQ: {} });
let prefs = Object.assign({ duration: 20, warn: true, theme: 'system' },
                          load(KEY.prefs, null) || {});

/* ── appearance ────────────────────────────────────────────────────── */
const THEMES = ['system', 'light', 'dark'];

function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
  else root.removeAttribute('data-theme');
  syncThemeColor();
}

/** Keep the browser/status-bar tint in step with what's on screen. */
function syncThemeColor() {
  const set = document.documentElement.getAttribute('data-theme');
  const dark = set === 'dark'
    || (!set && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0D1113' : '#F6F4EF');
}

/* ── entitlement ─────────────────────────────────────────────────────
   The licence and the trial counters are mirrored into three
   independent stores — localStorage, IndexedDB and Cache Storage — and
   merged on every start. Two consequences:

   • A paid licence survives anything short of a full wipe, so buyers
     don't silently lose what they paid for.
   • The merge always keeps the HIGHER usage count, so clearing one
     store (or one of them being evicted) can never hand out a second
     free trial.

   A deliberate "clear site data" still resets everything. Nothing
   client-side survives that — see the README for why, and for what the
   alternatives actually cost.
   ------------------------------------------------------------------ */
const TRIAL = Object.assign({ exams: 1, practice: 5 }, CFG.trial || {});
const BLANK_ENT = { paid: false, code: null, at: null, exams: 0, practice: 0 };
const VAULT_CACHE = 'kora-vault';
const VAULT_URL = 'vault/entitlement.json';

function mergeEnt(a, b) {
  if (!a) return b ? { ...b } : { ...BLANK_ENT };
  if (!b) return { ...a };
  const paid = !!(a.paid || b.paid);
  const src = a.paid ? a : (b.paid ? b : a);
  return {
    paid,
    code: paid ? (src.code || a.code || b.code || null) : null,
    at: paid ? (src.at || a.at || b.at || null) : null,
    exams: Math.max(a.exams || 0, b.exams || 0),
    practice: Math.max(a.practice || 0, b.practice || 0),
  };
}

function idbTxn(mode, fn) {
  return new Promise(resolve => {
    let req;
    try { req = indexedDB.open('kora-utware', 1); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('ent')) db.createObjectStore('ent');
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      let out = null;
      try {
        const tx = db.transaction('ent', mode);
        const r = fn(tx.objectStore('ent'));
        if (r) r.onsuccess = () => { out = r.result; };
        tx.oncomplete = () => { db.close(); resolve(out); };
        tx.onerror = () => { db.close(); resolve(null); };
        tx.onabort = () => { db.close(); resolve(null); };
      } catch { db.close(); resolve(null); }
    };
  });
}
const idbGet = () => idbTxn('readonly', s => s.get('ent'));
const idbSet = v => idbTxn('readwrite', s => s.put(v, 'ent'));

async function cacheGet() {
  try {
    const c = await caches.open(VAULT_CACHE);
    const r = await c.match(VAULT_URL);
    return r ? await r.json() : null;
  } catch { return null; }
}
async function cacheSet(v) {
  try {
    const c = await caches.open(VAULT_CACHE);
    await c.put(VAULT_URL, new Response(JSON.stringify(v),
      { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* storage disabled */ }
}

let ent = mergeEnt(load(KEY.ent, null), load(KEY.entBak, null)) || { ...BLANK_ENT };

function saveEnt() {
  save(KEY.ent, ent);
  save(KEY.entBak, ent);
  idbSet(ent); cacheSet(ent);        // fire and forget; never blocks the UI
}

/** Fold in whatever the slower stores remember. Bounded so a wedged
 *  IndexedDB can't hold up the splash screen. */
async function hydrateEnt() {
  const slow = Promise.all([idbGet(), cacheGet()])
    .then(([a, b]) => mergeEnt(a, b)).catch(() => null);
  const remote = await Promise.race([slow, new Promise(r => setTimeout(() => r(null), 2500))]);
  ent = mergeEnt(ent, remote);
  saveEnt();                         // converge every store on the merged truth
}

/** Ask the browser not to evict us. Safari drops script-writable
 *  storage after ~7 idle days unless the app is on the home screen,
 *  which would otherwise cost a paying user their unlock. */
async function askPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist
        && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* not supported */ }
}

const isPaid       = () => !!ent.paid;
const examsLeft    = () => Math.max(0, TRIAL.exams - (ent.exams || 0));
const practiceLeft = () => Math.max(0, TRIAL.practice - (ent.practice || 0));
const canExam      = () => isPaid() || examsLeft() > 0;
const canPractice  = () => isPaid() || practiceLeft() > 0;
const trialSpent   = () => !isPaid() && examsLeft() === 0 && practiceLeft() === 0;

/* ── helpers ───────────────────────────────────────────────────────── */
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function fmtMoney(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtDate(ts) {
  const d = new Date(ts);
  const day = ['Ku cyumweru', 'Kuwa mbere', 'Kuwa kabiri', 'Kuwa gatatu',
               'Kuwa kane', 'Kuwa gatanu', 'Kuwa gatandatu'][d.getDay()];
  return `${day} · ${d.getDate()}/${d.getMonth() + 1} · ${
    String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function icon(id, size = 18) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#' + id);
  svg.append(use);
  return svg;
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2400);
}

/** `no: null` turns this into a plain acknowledgement dialog. */
function confirmAsk(title, text, yes = 'Yego', no = 'Oya') {
  return new Promise(resolve => {
    const sheet = $('#confirm');
    $('#cf-title').textContent = title;
    $('#cf-text').textContent = text;
    $('#cf-yes').textContent = yes;
    $('#cf-no').textContent = no || '';
    $('#cf-no').classList.toggle('hidden', no === null);
    sheet.classList.remove('hidden');
    const done = ok => {
      sheet.classList.add('hidden');
      $('#cf-yes').onclick = $('#cf-no').onclick = null;
      resolve(ok);
    };
    $('#cf-yes').onclick = () => done(true);
    $('#cf-no').onclick = () => done(false);
  });
}

/* ── router ────────────────────────────────────────────────────────── */
let screenStack = ['home'];

function show(name, push = true) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $(`#screen-${name}`).classList.add('active');
  if (push && screenStack[screenStack.length - 1] !== name) {
    screenStack.push(name);
    history.pushState({ depth: screenStack.length }, '');
  }
  window.scrollTo(0, 0);
}

function back() {
  if (screenStack.length > 1) history.back();
}

function goHome() {
  screenStack = ['home'];
  show('home', false);
  renderHome();
  // an update that arrived mid-exam waits until it is safe to apply
  if (reloadPending) applyUpdateNow();
}

/* ── question rendering ────────────────────────────────────────────── */
function questionNode(q, opts = {}) {
  const { chosen = null, reveal = false, position = null, total = null,
          flagged = false, onPick = null, showHead = true } = opts;

  const wrap = document.createElement('div');

  if (showHead) {
    const head = document.createElement('div');
    head.className = 'q-head';
    const tag = document.createElement('span');
    tag.className = 'q-tag';
    tag.textContent = position ? `Ikibazo ${position}${total ? ' / ' + total : ''}`
                               : (q.c === 'sign' ? 'Icyapa' : 'Itegeko');
    head.append(tag);
    if (flagged) {
      const f = document.createElement('span');
      f.className = 'q-flag';
      f.append(icon('i-flag', 13), document.createTextNode(' Wamenyesheje'));
      head.append(f);
    }
    wrap.append(head);
  }

  const text = document.createElement('p');
  text.className = 'q-text';
  text.textContent = q.q;
  wrap.append(text);

  if (q.qi && q.qi.length) {
    const box = document.createElement('div');
    box.className = 'q-imgs';
    q.qi.forEach(src => {
      const img = document.createElement('img');
      img.className = 'q-img';
      img.src = src;
      img.alt = 'Ishusho y’ikibazo';
      box.append(img);
    });
    wrap.append(box);
  }

  const list = document.createElement('div');
  list.className = 'opts';
  q.o.forEach((o, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'opt';
    if (reveal) {
      btn.classList.add('locked');
      if (i === q.a) btn.classList.add('right');
      else if (chosen === i) btn.classList.add('wrong');
    } else if (chosen === i) {
      btn.classList.add('chosen');
    }

    const letter = document.createElement('span');
    letter.className = 'opt-letter';
    letter.textContent = LETTERS[i];

    const body = document.createElement('span');
    body.className = 'opt-body';
    if (o.i) {
      const img = document.createElement('img');
      img.src = o.i;
      img.alt = `Igisubizo ${LETTERS[i]}`;
      body.append(img);
    }
    if (o.t) body.append(document.createTextNode(o.t));
    if (!o.t && !o.i) body.textContent = '—';

    btn.append(letter, body);

    if (reveal && (i === q.a || chosen === i)) {
      const mark = document.createElement('span');
      mark.className = 'opt-mark';
      mark.style.color = i === q.a ? 'var(--go)' : 'var(--stop)';
      mark.append(icon(i === q.a ? 'i-check' : 'i-cross', 17));
      btn.append(mark);
    }

    if (onPick) btn.addEventListener('click', () => onPick(i));
    list.append(btn);
  });
  wrap.append(list);

  const src = document.createElement('p');
  src.className = 'q-source';
  src.textContent = `Igitabo — urupapuro ${q.p}`;
  wrap.append(src);

  return wrap;
}

/* ── stats ─────────────────────────────────────────────────────────── */
function recordAnswer(qid, correct) {
  const rec = stats.perQ[qid] || (stats.perQ[qid] = { seen: 0, wrong: 0 });
  rec.seen++;
  if (!correct) rec.wrong++;
  else if (rec.wrong > 0) rec.wrong--;
  save(KEY.stats, stats);
}

const wrongIds = () => Object.entries(stats.perQ)
  .filter(([, r]) => r.wrong > 0)
  .sort((a, b) => b[1].wrong - a[1].wrong)
  .map(([id]) => Number(id))
  .filter(id => byId.has(id));

/* ══ PAYWALL ═══════════════════════════════════════════════════════ */
function upsellNode(where) {
  const box = document.createElement('div');
  box.className = 'upsell';

  const head = document.createElement('div');
  head.className = 'upsell-head';
  head.append(icon('i-lock', 19));
  const strong = document.createElement('strong');
  strong.textContent = where === 'result' ? "Ikizamini cy'ubuntu kirangiye"
                                          : 'Fungura ibibazo byose';
  head.append(strong);

  const p = document.createElement('p');
  p.innerHTML = `Fungura ibibazo <b>${BANK.length}</b> n'ibizamini bitagira umupaka ku <b>${
    fmtMoney(CFG.price || 1000)} ${CFG.currency || 'RWF'}</b> rimwe gusa.`;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-bright btn-block';
  btn.textContent = 'Fungura burundu';
  btn.addEventListener('click', () => openPaywall());

  box.append(head, p, btn);
  return box;
}

function openPaywall(reason) {
  const titles = {
    exam: "Ikizamini cy'ubuntu kirangiye",
    practice: "Kwimenyereza kw'ubuntu kurangiye",
  };
  $('#pay-title').textContent = titles[reason] || "Fungura Kora Utware burundu";
  $('#pay-sub').textContent = reason === 'practice'
    ? 'Wakoresheje ibibazo byawe by’ubuntu. Ishyura rimwe gusa ukomeze wimenyereze ibibazo byose.'
    : 'Ishyura rimwe gusa ukomeze wimenyereze ibibazo byose kugeza utsinze provisoire.';
  show('paywall');
}

function renderPayConfig() {
  const price = fmtMoney(CFG.price || 1000);
  const cur = CFG.currency || 'RWF';
  $('#pay-price').textContent = price;
  $('#pay-cur').textContent = cur;
  $('#pay-amount').textContent = `${price} ${cur}`;
  $('#pay-momo').textContent = CFG.momoNumber || '—';
  $('#pay-count').textContent = BANK.length;

  $('#pay-whatsapp').classList.toggle('hidden', !CFG.whatsapp);
  const help = CFG.whatsapp
    ? `Ntabwo urabona kode? Ohereza ubutumwa kuri WhatsApp hamwe na nimero ya transaction yawe.`
    : `Ntabwo urabona kode? Ohereza ubutumwa hamwe na nimero ya transaction yawe.`;
  $('#unlock-help').textContent = help;
}

function payMessage() {
  return `Muraho. Nishyuye ${fmtMoney(CFG.price || 1000)} ${CFG.currency || 'RWF'} `
       + `kuri Kora Utware.\nNimero ya transaction: \nIzina: `;
}

function dialMomo() {
  const digits = String(CFG.momoNumber || '').replace(/\D/g, '');
  if (!digits) { toast('Nimero ya MoMo ntiyashyizweho.'); return; }
  // MTN Rwanda send-money USSD; # must be percent-encoded in a tel: URI
  const ussd = `*182*1*1*${digits}*${CFG.price || 1000}%23`;
  location.href = 'tel:' + ussd;
  setTimeout(() => toast('Niba dialer itafunguka, koporora nimero uyandike wenyine.'), 1400);
}

async function copyMomo() {
  const n = String(CFG.momoNumber || '');
  try {
    await navigator.clipboard.writeText(n.replace(/\s/g, ''));
    toast('Nimero yakoporowe.');
  } catch {
    toast(n);
  }
}

function openWhatsApp(text) {
  if (!CFG.whatsapp) return;
  const url = `https://wa.me/${String(CFG.whatsapp).replace(/\D/g, '')}`
            + `?text=${encodeURIComponent(text || payMessage())}`;
  window.open(url, '_blank', 'noopener');
}

function openSms(text) {
  if (!CFG.sms) return;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  location.href = `sms:${CFG.sms}${isIOS ? '&' : '?'}body=`
                + encodeURIComponent(text || payMessage());
}

/* ── unlock codes ──────────────────────────────────────────────────── */
let unlockManifest = null;

async function getManifest() {
  if (unlockManifest) return unlockManifest;
  const res = await fetch('data/unlock.json');
  unlockManifest = await res.json();
  return unlockManifest;
}

const normalizeCode = raw => String(raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

async function pbkdf2Hex(pass, salt, iterations, bytes) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' }, key, bytes * 8);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkCode(raw) {
  const code = normalizeCode(raw);
  const man = await getManifest();
  if (code.length !== man.len) return { ok: false, why: 'length' };
  if ([...code].some(ch => !CODE_CHARS.includes(ch))) return { ok: false, why: 'chars' };
  if (!crypto.subtle) return { ok: false, why: 'crypto' };
  const hex = await pbkdf2Hex(code, man.salt, man.iter, 8);
  return { ok: man.hashes.includes(hex), why: 'no-match', code };
}

let codeValue = '';

function renderCodeBoxes() {
  const box = $('#code-boxes');
  box.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) {
      const dash = document.createElement('span');
      dash.className = 'code-dash';
      box.append(dash);
    }
    const cell = document.createElement('span');
    cell.className = 'code-box';
    if (codeValue[i]) { cell.textContent = codeValue[i]; cell.classList.add('filled'); }
    else if (i === codeValue.length) cell.classList.add('here');
    box.append(cell);
  }
  $('#code-submit').disabled = codeValue.length !== 8;
}

function codeMsg(kind, text) {
  const el = $('#code-msg');
  if (!kind) { el.className = 'hidden'; el.textContent = ''; return; }
  el.className = `feedback ${kind === 'ok' ? 'ok' : 'bad'}`;
  el.innerHTML = '';
  el.append(icon(kind === 'ok' ? 'i-check' : 'i-alert', 18));
  const span = document.createElement('span');
  span.textContent = text;
  el.append(span);
}

async function submitCode() {
  const btn = $('#code-submit');
  btn.disabled = true;
  btn.textContent = 'Turimo kugenzura…';
  codeMsg(null);

  let res;
  try {
    res = await checkCode(codeValue);
  } catch {
    res = { ok: false, why: 'crypto' };
  }

  btn.textContent = 'Fungura';
  btn.disabled = codeValue.length !== 8;

  if (res.ok) {
    ent.paid = true;
    ent.code = res.code;
    ent.at = Date.now();
    saveEnt();
    askPersistence();
    codeMsg('ok', 'Byakunze! Kora Utware ifunguwe burundu.');
    if (navigator.vibrate) { try { navigator.vibrate([40, 50, 90]); } catch {} }
    setTimeout(() => {
      toast('Ifunguwe burundu. Urakoze!');
      goHome();
    }, 1100);
    return;
  }

  $('#code-wrap').classList.add('code-bad');
  setTimeout(() => $('#code-wrap').classList.remove('code-bad'), 1200);

  if (res.why === 'chars') {
    codeMsg('bad', 'Iyi kode irimo inyuguti zitemewe. Kode ntigira 0, O, 1, I cyangwa L.');
  } else if (res.why === 'crypto') {
    codeMsg('bad', 'Ntibishoboka kugenzura kode kuri iyi terefone. Gerageza ufungure porogaramu ukoresheje https.');
  } else {
    codeMsg('bad', 'Iyi kode ntabwo ariyo. Genzura neza inyuguti, cyangwa uduhamagare.');
  }
}

function openUnlock() {
  codeValue = '';
  renderCodeBoxes();
  codeMsg(null);
  show('unlock');
  setTimeout(() => $('#code-input').focus(), 250);
}

/* ══ EXAM ══════════════════════════════════════════════════════════ */
let exam = null;
let tick = null;

function newExam() {
  if (!canExam()) { openPaywall('exam'); return; }
  const picked = shuffled(BANK).slice(0, Math.min(EXAM_SIZE, BANK.length));
  const mins = Number(prefs.duration) || 0;
  exam = {
    ids: picked.map(q => q.id),
    answers: {}, flags: [], idx: 0,
    startedAt: Date.now(),
    duration: mins * 60,
    endsAt: mins ? Date.now() + mins * 60000 : 0,
    warned: false,
    counted: false,
  };
  save(KEY.exam, exam);
  show('exam');
  renderExam();
  startTimer();
}

function resumeExam(saved) {
  exam = saved;
  show('exam');
  renderExam();
  startTimer();
}

const examQuestion = (i = exam.idx) => byId.get(exam.ids[i]);

function renderExam() {
  const q = examQuestion();
  const body = $('#ex-body');
  body.innerHTML = '';
  body.append(questionNode(q, {
    chosen: exam.answers[q.id] ?? null,
    // the command bar already carries "IKIBAZO n / 20", so the chip
    // here shows what kind of question it is instead
    flagged: exam.flags.includes(q.id),
    onPick: i => {
      exam.answers[q.id] = i;
      save(KEY.exam, exam);
      renderExam();
      if (exam.idx < exam.ids.length - 1) setTimeout(() => move(1), 180);
    },
  }));

  const blank = exam.ids.filter(id => exam.answers[id] === undefined).length;
  $('#ex-pos').textContent = exam.idx + 1;
  $('#ex-total').textContent = exam.ids.length;
  $('#ex-left').textContent = blank ? `${blank} utarasubiza` : 'byose wabisubije';
  $('#ex-pbar').style.width = `${((exam.idx + 1) / exam.ids.length) * 100}%`;
  $('#btn-prev').disabled = exam.idx === 0;
  $('#btn-flag').classList.toggle('flagged', exam.flags.includes(q.id));
  $('#btn-next').textContent = exam.idx === exam.ids.length - 1 ? 'Ohereza' : 'Komeza';
}

function move(delta) {
  const next = exam.idx + delta;
  if (next < 0 || next >= exam.ids.length) return;
  exam.idx = next;
  save(KEY.exam, exam);
  renderExam();
}

function startTimer() {
  clearInterval(tick);
  updateTimer();
  tick = setInterval(updateTimer, 500);
}

function updateTimer() {
  if (!exam) return;
  const el = $('#ex-timer');
  if (!exam.endsAt) {
    el.textContent = fmtClock((Date.now() - exam.startedAt) / 1000);
    return;
  }
  const left = (exam.endsAt - Date.now()) / 1000;
  el.textContent = fmtClock(left);
  el.classList.toggle('warn', left <= 300 && left > 60);
  el.classList.toggle('danger', left <= 60);
  if (prefs.warn && !exam.warned && left <= 60 && left > 0) {
    exam.warned = true;
    save(KEY.exam, exam);
    toast('Hasigaye umunota umwe!');
    if (navigator.vibrate) { try { navigator.vibrate([120, 60, 120]); } catch {} }
  }
  if (left <= 0) {
    clearInterval(tick);
    finishExam(true);
  }
}

function openGrid() {
  const box = $('#grid-nums');
  box.innerHTML = '';
  exam.ids.forEach((id, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gn';
    b.textContent = i + 1;
    if (exam.answers[id] !== undefined) b.classList.add('done');
    if (exam.flags.includes(id)) b.classList.add('flag');
    if (i === exam.idx) b.classList.add('here');
    b.addEventListener('click', () => {
      exam.idx = i;
      save(KEY.exam, exam);
      renderExam();
      $('#grid-sheet').classList.add('hidden');
    });
    box.append(b);
  });
  $('#grid-sheet').classList.remove('hidden');
}

async function trySubmit() {
  const blank = exam.ids.filter(id => exam.answers[id] === undefined).length;
  const msg = blank
    ? `Hari ibibazo ${blank} utarasubiza. Nusohereza bizafatwa nk'amakosa.`
    : 'Wasubije ibibazo byose. Urashaka kohereza?';
  if (await confirmAsk('Ohereza ikizamini?', msg, 'Ohereza')) finishExam(false);
}

function finishExam(timedOut) {
  clearInterval(tick);
  $('#grid-sheet').classList.add('hidden');
  $('#confirm').classList.add('hidden');

  const detail = exam.ids.map(id => {
    const q = byId.get(id);
    const chosen = exam.answers[id];
    const correct = chosen === q.a;
    if (chosen !== undefined) recordAnswer(id, correct);
    return { id, chosen: chosen ?? null, correct };
  });

  const score = detail.filter(d => d.correct).length;
  const seconds = Math.round((Date.now() - exam.startedAt) / 1000);
  const attempt = {
    date: Date.now(), score, total: exam.ids.length,
    passed: score >= PASS_MARK, seconds, timedOut,
    detail: detail.map(d => [d.id, d.chosen]),
  };
  stats.attempts.unshift(attempt);
  stats.attempts = stats.attempts.slice(0, 60);
  save(KEY.stats, stats);

  if (!isPaid() && !exam.counted) {
    ent.exams = (ent.exams || 0) + 1;
    saveEnt();
  }

  localStorage.removeItem(KEY.exam);
  exam = null;
  showResult(attempt, timedOut);
}

/* ── result ────────────────────────────────────────────────────────── */
let lastAttempt = null;

function showResult(attempt, timedOut) {
  lastAttempt = attempt;
  const pass = attempt.passed;
  $('#verdict').className = `verdict ${pass ? 'pass' : 'fail'}`;
  $('#verdict-mark').classList.toggle('hidden', !pass);
  $('#rs-score').textContent = attempt.score;
  $('#rs-title').textContent = pass ? 'Watsinze!' : 'Ntabwo watsinze';

  const gap = PASS_MARK - attempt.score;
  $('#rs-sub').textContent = timedOut
    ? `Igihe cyarangiye. Amanota yo gutsinda ni ${PASS_MARK}/20.`
    : pass
      ? `Warenze amanota yo gutsinda (${PASS_MARK}/20). Komeza gutyo.`
      : gap <= 3
        ? `Ukeneye nibura ${PASS_MARK}/20. Hasigaye amanota ${gap} gusa — wimenyereze uhereye ku makosa yawe.`
        : `Ukeneye nibura ${PASS_MARK}/20. Ongera wimenyereze hanyuma ugerageze.`;

  const blank = attempt.detail.filter(([, c]) => c === null).length;
  $('#rs-right').textContent = attempt.score;
  $('#rs-wrong').textContent = attempt.total - attempt.score - blank;
  $('#rs-blank').textContent = blank;
  $('#rs-time').textContent = fmtClock(attempt.seconds);

  const groups = { sign: [0, 0], rule: [0, 0] };
  attempt.detail.forEach(([id, chosen]) => {
    const q = byId.get(id);
    if (!q) return;
    groups[q.c][1]++;
    if (chosen === q.a) groups[q.c][0]++;
  });
  const labels = { sign: 'Ibyapa', rule: 'Amategeko' };
  const bars = $('#rs-bars');
  bars.innerHTML = '';
  Object.entries(groups).forEach(([k, [ok, n]]) => {
    if (!n) return;
    const pct = (ok / n) * 100;
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML =
      `<span class="bar-label">${labels[k]}</span>` +
      `<span class="bar-track"><span class="bar-fill ${pct >= 70 ? '' : pct >= 50 ? 'mid' : 'low'}" style="width:${pct}%"></span></span>` +
      `<span class="bar-val">${ok}/${n}</span>`;
    bars.append(row);
  });

  const up = $('#result-upsell');
  up.innerHTML = '';
  if (!isPaid() && examsLeft() === 0) up.append(upsellNode('result'));

  renderHome();
  screenStack = ['home'];
  show('result');
}

/* ── review ────────────────────────────────────────────────────────── */
function showReview(attempt, title = 'Gusubiramo') {
  $('#review-title').textContent = title;
  $('#review-score').textContent = `${attempt.score}/${attempt.total}`;
  const body = $('#review-body');
  body.innerHTML = '';

  attempt.detail.forEach(([id, chosen], i) => {
    const q = byId.get(id);
    if (!q) return;
    const item = document.createElement('div');
    item.className = 'rv';

    const head = document.createElement('div');
    head.className = 'rv-head';
    const n = document.createElement('span');
    n.className = 'badge plain';
    n.textContent = `Ikibazo ${i + 1}`;
    const ok = chosen === q.a;
    const badge = document.createElement('span');
    badge.className = `badge ${chosen === null ? 'blank' : ok ? 'ok' : 'bad'}`;
    badge.textContent = chosen === null ? 'Ntiwasubije' : ok ? 'Nibyo' : 'Sibyo';
    const page = document.createElement('span');
    page.className = 'rv-page';
    page.textContent = `ur. ${q.p}`;
    head.append(n, badge, page);
    item.append(head);
    item.append(questionNode(q, { chosen, reveal: true, showHead: false }));
    body.append(item);
  });

  show('review');
}

/* ══ PRACTICE ══════════════════════════════════════════════════════ */
let practice = null;

function startPractice(kind) {
  if (!canPractice()) { openPaywall('practice'); return; }

  const titles = { sign: 'Ibyapa', rule: 'Amategeko', wrong: 'Amakosa yanjye' };
  let pool;
  if (kind === 'wrong') {
    const ids = wrongIds();
    if (!ids.length) { toast('Nta makosa ufite ubu. Tangira ikizamini!'); return; }
    pool = ids.map(id => byId.get(id));
  } else {
    pool = shuffled(BANK.filter(q => q.c === kind));
  }

  practice = { qs: pool, idx: 0, answers: {}, ok: 0, bad: 0 };
  $('#pr-title').textContent = titles[kind] || 'Kwimenyereza';
  show('practice');
  renderPractice();
}

function renderPractice() {
  const q = practice.qs[practice.idx];
  const chosen = practice.answers[q.id];
  const body = $('#pr-body');
  body.innerHTML = '';

  body.append(questionNode(q, {
    chosen: chosen ?? null,
    reveal: chosen !== undefined,
    showHead: false,
    onPick: chosen !== undefined ? null : i => {
      if (!canPractice()) { openPaywall('practice'); return; }
      practice.answers[q.id] = i;
      const correct = i === q.a;
      correct ? practice.ok++ : practice.bad++;
      recordAnswer(q.id, correct);
      if (!isPaid()) { ent.practice = (ent.practice || 0) + 1; saveEnt(); }
      renderPractice();
    },
  }));

  if (chosen !== undefined) {
    const correct = chosen === q.a;
    const fb = document.createElement('div');
    fb.className = `feedback ${correct ? 'ok' : 'bad'}`;
    fb.append(icon(correct ? 'i-check' : 'i-alert', 18));
    const span = document.createElement('span');
    if (correct) span.innerHTML = '<b>Nibyo.</b> Igisubizo ni cyo.';
    else span.innerHTML = `<b>Sibyo.</b> Igisubizo nyacyo ni <b>${LETTERS[q.a]}</b>.`;
    fb.append(span);
    body.append(fb);
    fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  if (!isPaid()) {
    const left = practiceLeft();
    const note = document.createElement('p');
    note.className = 'fineprint';
    note.style.textAlign = 'center';
    note.textContent = left > 0
      ? `Ibibazo ${left} by'ubuntu bisigaye.`
      : "Ibibazo by'ubuntu byarangiye.";
    body.append(note);
  }

  $('#pr-pos').textContent = `${practice.idx + 1} / ${practice.qs.length}`;
  $('#pr-ok').textContent = practice.ok;
  $('#pr-bad').textContent = practice.bad;
  $('#pr-prev').disabled = practice.idx === 0;
  $('#pr-next').textContent =
    practice.idx === practice.qs.length - 1 ? 'Birarangiye' : 'Komeza';
}

function movePractice(delta) {
  const next = practice.idx + delta;
  if (next < 0) return;
  if (next >= practice.qs.length) {
    toast(`Warangije: ${practice.ok} byiza, ${practice.bad} bibi.`);
    goHome();
    return;
  }
  if (delta > 0 && !canPractice() && practice.answers[practice.qs[next].id] === undefined) {
    openPaywall('practice');
    return;
  }
  practice.idx = next;
  renderPractice();
}

/* ══ HOME ══════════════════════════════════════════════════════════ */
function renderHome() {
  const a = stats.attempts;

  // Licence pill. Once the trial is spent the locked CTA below already
  // makes the ask — a third "you must pay" badge would just nag.
  const pill = $('#status-pill');
  if (isPaid()) {
    pill.className = 'pill pill-paid';
    pill.textContent = 'Burundu';
  } else if (examsLeft() > 0) {
    pill.className = 'pill pill-trial';
    pill.innerHTML = '';
    pill.append(icon('i-clock', 13));
    pill.append(document.createTextNode(` ${examsLeft()} cy'ubuntu`));
  } else {
    pill.className = 'pill hidden';
    pill.textContent = '';
  }

  // CTA
  const locked = !canExam();
  $('#btn-start-exam').classList.toggle('locked', locked);
  $('#cta-title').textContent = locked ? 'Fungura burundu' : 'Tangira Ikizamini';
  $('#cta-sub').innerHTML = locked
    ? `${fmtMoney(CFG.price || 1000)} ${CFG.currency || 'RWF'} · rimwe gusa`
    : `Ibibazo 20 · Iminota <span data-mins>${Number(prefs.duration) ? prefs.duration : '∞'}</span> · 12/20`;

  $('#st-attempts').textContent = a.length;
  $('#st-best').innerHTML = a.length
    ? `${Math.max(...a.map(x => x.score))}<small>/20</small>` : '—';
  $('#st-wrong').textContent = wrongIds().length;

  const spark = $('#spark');
  spark.innerHTML = '';
  const recent = a.slice(0, 5).reverse();
  (recent.length ? recent : Array(5).fill(null)).forEach(x => {
    const bar = document.createElement('i');
    bar.style.height = x ? `${clamp((x.score / 20) * 100, 10, 100)}%` : '18%';
    if (x) bar.className = x.passed ? 'pass' : 'fail';
    spark.append(bar);
  });

  const five = a.slice(0, 5);
  const score = $('.ready-score');
  score.style.fontSize = five.length ? '' : '30px';   // a lone em-dash at 46px reads as a rule
  if (five.length) {
    const pct = Math.round(five.reduce((s, x) => s + x.score, 0) / five.length / 20 * 100);
    $('#ready-value').textContent = `${pct}%`;
    let label, sub, color;
    if (pct >= 80) {
      label = 'Witeguye neza'; color = 'var(--go)';
      sub = 'Uri ku rwego rwo gutsinda. Komeza wimenyereze buri munsi.';
    } else if (pct >= 60) {
      label = 'Uri hafi gutsinda'; color = 'var(--caution)';
      sub = 'Urashobora gutsinda, ariko ntibirahamye. Reba amakosa yawe.';
    } else {
      label = 'Ukeneye kwiga'; color = 'var(--stop)';
      sub = 'Wimenyereze cyane mbere yo kujya mu kizamini nyacyo.';
    }
    score.style.color = color;
    $('#ready-label').textContent = label;
    $('#ready-sub').textContent = sub;
  } else {
    $('#ready-value').textContent = '—';
    score.style.color = 'var(--ink-3)';
    $('#ready-label').textContent = 'Ntabwo urapima';
    $('#ready-sub').textContent = 'Tangira ikizamini cya mbere kugira ngo umenye aho ugeze.';
  }

  $('#cnt-all').textContent = BANK.length;
  $('#cnt-sign').textContent = BANK.filter(q => q.c === 'sign').length;
  $('#cnt-rule').textContent = BANK.filter(q => q.c === 'rule').length;
  $('#cnt-wrong').textContent = wrongIds().length;

  // No separate upsell block on home: when the trial is spent the main
  // CTA has already turned into the unlock button, and the result screen
  // carries the pitch at the moment it actually lands.
  $('#home-upsell').classList.add('hidden');

  // recent history
  const hist = $('#home-hist');
  hist.innerHTML = '';
  if (!a.length) {
    hist.innerHTML = '<p class="empty" style="padding:22px 10px">Nta kizamini urakora.</p>';
  } else {
    a.slice(0, 2).forEach(att => hist.append(histRow(att)));
  }

  $('#fineprint').innerHTML = isPaid()
    ? `Ibibazo <b>${BANK.length}</b> byakuwe mu gitabo cya provisoire.`
      + ` Bika kode yawe ahantu hizewe — niyo ifungura iyi terefone burundu.`
    : `Ibibazo <b>${BANK.length}</b> byakuwe mu gitabo cya provisoire. Porogaramu ikora nta internet.`;

  // unfinished exam
  const saved = load(KEY.exam, null);
  const card = $('#resume-card');
  if (saved && saved.ids && saved.ids.length) {
    if (saved.endsAt && Date.now() > saved.endsAt) {
      localStorage.removeItem(KEY.exam);
      card.classList.add('hidden');
    } else {
      const done = Object.keys(saved.answers || {}).length;
      $('#resume-info').textContent =
        `Wasubije ${done}/${saved.ids.length} · ${saved.endsAt
          ? 'hasigaye ' + fmtClock((saved.endsAt - Date.now()) / 1000) : 'nta gihe'}`;
      card.classList.remove('hidden');
    }
  } else {
    card.classList.add('hidden');
  }
}

function histRow(att) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'hist';
  const sc = document.createElement('span');
  sc.className = `hist-score ${att.passed ? 'pass' : 'fail'}`;
  sc.textContent = att.score;
  const meta = document.createElement('span');
  meta.className = 'hist-meta';
  meta.innerHTML = `<strong>${att.passed ? 'Watsinze' : 'Ntiwatsinze'} — ${att.score}/${att.total}</strong>`
                 + `<span>${fmtDate(att.date)} · ${fmtClock(att.seconds)}</span>`;
  row.append(sc, meta, icon('i-chev', 17));
  row.addEventListener('click', () => showReview(att, fmtDate(att.date)));
  return row;
}

/* ══ SETTINGS ══════════════════════════════════════════════════════ */
function renderSettings() {
  const t = THEMES.includes(prefs.theme) ? prefs.theme : 'system';
  $$('[data-theme-opt]').forEach(b => b.classList.toggle('on', b.dataset.themeOpt === t));

  const box = $('#licence-box');
  box.innerHTML = '';
  if (isPaid()) {
    // A buyer who ever loses their storage can restore the unlock
    // themselves, so long as they still have the code. Show it.
    const card = document.createElement('div');
    card.className = 'licence-card';
    const mark = document.createElement('span');
    mark.className = 'lc-mark';
    mark.append(icon('i-check', 20));
    const body = document.createElement('div');
    body.className = 'lc-body';
    const strong = document.createElement('strong');
    strong.textContent = ent.code
      ? `${ent.code.slice(0, 4)}-${ent.code.slice(4)}` : 'Ifunguwe';
    const sub = document.createElement('span');
    sub.textContent = 'Burundu · bika iyi kode';
    body.append(strong, sub);
    card.append(mark, body);
    if (ent.code) {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'icon-btn';
      copy.style.marginLeft = 'auto';
      copy.setAttribute('aria-label', 'Koporora kode');
      copy.append(icon('i-copy', 18));
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(ent.code); toast('Kode yakoporowe.'); }
        catch { toast(ent.code); }
      });
      card.append(copy);
    }
    box.append(card);
  } else {
    const p = document.createElement('p');
    p.className = 'fineprint';
    p.style.margin = '10px 0 12px';
    p.textContent = `Bisigaye ku buntu: ikizamini ${examsLeft()}, ibibazo ${practiceLeft()}.`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-go btn-block';
    btn.textContent = `Fungura burundu — ${fmtMoney(CFG.price || 1000)} ${CFG.currency || 'RWF'}`;
    btn.addEventListener('click', () => openPaywall());
    box.append(p, btn);
  }

  $('#set-contact').classList.toggle('hidden', !CFG.whatsapp && !CFG.sms);

  // The build id makes "did my update actually land?" answerable on the
  // phone itself, instead of guessing.
  if (swReg && swReg.active && !swVersion) swReg.active.postMessage({ type: 'version' });
  $('#settings-info').innerHTML =
    `Kora Utware · ibibazo <b>${BANK.length}</b> byo mu gitabo cya provisoire`
    + (CFG.momoName ? ` · ${CFG.momoName}` : '')
    + (swVersion ? `<br>Verisiyo <b>${swVersion}</b>` : '');
}

async function clearHistory() {
  if (!await confirmAsk('Siba amateka?',
    "Ibizamini byose n'amakosa yawe bizasibwa burundu. Uburenganzira bwawe ntibuzasibwa.",
    'Siba')) return;
  stats = { attempts: [], perQ: {} };
  save(KEY.stats, stats);
  renderHome();
  toast('Amateka yasibwe.');
}

function renderHistory() {
  const body = $('#history-body');
  body.innerHTML = '';
  if (!stats.attempts.length) {
    body.innerHTML = '<p class="empty">Nta kizamini urakora.<br>Tangira ikizamini cya mbere.</p>';
  } else {
    const list = document.createElement('div');
    list.className = 'hist-list';
    stats.attempts.forEach(att => list.append(histRow(att)));
    body.append(list);
  }
  show('history');
}

/* ══ WIRING ════════════════════════════════════════════════════════ */
function wire() {
  $('#btn-start-exam').addEventListener('click', async () => {
    if (!canExam()) { openPaywall('exam'); return; }
    const saved = load(KEY.exam, null);
    if (saved && saved.ids) {
      if (!await confirmAsk('Tangira gishya?',
        "Hari ikizamini utarangije. Nutangira gishya, icya kera kizasibwa.", 'Tangira gishya')) return;
    }
    newExam();
  });

  $('#btn-resume').addEventListener('click', () => {
    const saved = load(KEY.exam, null);
    if (saved) resumeExam(saved);
  });
  $('#btn-discard').addEventListener('click', () => {
    localStorage.removeItem(KEY.exam);
    renderHome();
  });

  $('#btn-prev').addEventListener('click', () => move(-1));
  $('#btn-next').addEventListener('click', () => {
    if (exam.idx === exam.ids.length - 1) trySubmit(); else move(1);
  });
  $('#btn-grid').addEventListener('click', openGrid);
  $('#btn-flag').addEventListener('click', () => {
    const id = examQuestion().id;
    const i = exam.flags.indexOf(id);
    if (i >= 0) exam.flags.splice(i, 1); else exam.flags.push(id);
    save(KEY.exam, exam);
    renderExam();
  });
  $('#btn-submit').addEventListener('click', () => {
    $('#grid-sheet').classList.add('hidden');
    trySubmit();
  });
  $('#btn-quit').addEventListener('click', async () => {
    if (await confirmAsk('Sohoka mu kizamini?',
      'Ikizamini kizabikwa ushobora kugikomeza nyuma.', 'Sohoka')) {
      clearInterval(tick);
      save(KEY.exam, exam);
      exam = null;
      goHome();
    }
  });

  $('#btn-review').addEventListener('click', () => showReview(lastAttempt));
  $('#btn-again').addEventListener('click', () => {
    if (!canExam()) { openPaywall('exam'); return; }
    newExam();
  });
  $('#btn-home').addEventListener('click', goHome);
  $('#btn-history').addEventListener('click', renderHistory);
  $('#btn-clear').addEventListener('click', async () => {
    await clearHistory();
    renderHistory();
  });

  $$('[data-practice]').forEach(b =>
    b.addEventListener('click', () => startPractice(b.dataset.practice)));
  $('#pr-prev').addEventListener('click', () => movePractice(-1));
  $('#pr-next').addEventListener('click', () => movePractice(1));

  $$('[data-back]').forEach(b => b.addEventListener('click', back));
  $$('[data-close-sheet]').forEach(b =>
    b.addEventListener('click', () => b.closest('.sheet').classList.add('hidden')));
  $('#grid-sheet').addEventListener('click', e => {
    if (e.target.id === 'grid-sheet') e.target.classList.add('hidden');
  });

  // paywall
  $('#pay-dial').addEventListener('click', dialMomo);
  $('#pay-copy').addEventListener('click', copyMomo);
  $('#pay-whatsapp').addEventListener('click', () => openWhatsApp());
  $('#pay-unlock').addEventListener('click', openUnlock);
  $('#pay-back').addEventListener('click', back);

  // settings
  $('#btn-settings').addEventListener('click', () => {
    renderSettings();
    show('settings');
  });

  $$('[data-theme-opt]').forEach(b => b.addEventListener('click', () => {
    prefs.theme = b.dataset.themeOpt;
    save(KEY.prefs, prefs);
    applyTheme(prefs.theme);
    renderSettings();
  }));
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', syncThemeColor);

  $('#set-install').addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      renderSettings();
      return;
    }
    // iOS never fires beforeinstallprompt, so tell them where the button is
    await confirmAsk('Shyira kuri telefone',
      /iPad|iPhone|iPod/.test(navigator.userAgent)
        ? 'Muri Safari, kanda ikimenyetso cyo gusangiza (↑) hepfo, uhitemo “Add to Home Screen”.'
        : 'Muri Chrome, fungura menu (⋮) uhitemo “Install app” cyangwa “Add to Home screen”.',
      'Sawa', null);
  });

  $('#set-update').addEventListener('click', async () => {
    const end = $('#update-state');
    const restore = end.innerHTML;
    end.textContent = 'Turareba…';
    if (!navigator.onLine) {
      end.innerHTML = restore;
      toast('Nta internet. Gerageza nyuma.');
      return;
    }
    try {
      await checkForUpdate(true);
      if (swReg && swReg.active) swReg.active.postMessage({ type: 'topup' });
      // Reload either way: with a network-first shell this alone pulls down
      // whatever changed, even when the worker itself is unchanged.
      end.textContent = 'Byavuguruwe';
      setTimeout(applyUpdateNow, 800);
    } catch {
      end.innerHTML = restore;
      toast('Ntibishobotse. Genzura internet.');
    }
  });

  $('#set-contact').addEventListener('click', () => {
    const msg = 'Muraho. Mfite ikibazo kuri Kora Utware:\n';
    if (CFG.whatsapp) openWhatsApp(msg);
    else if (CFG.sms) openSms(msg);
  });

  $('#set-clear').addEventListener('click', clearHistory);

  // unlock
  const input = $('#code-input');
  input.addEventListener('input', () => {
    codeValue = normalizeCode(input.value).slice(0, 8);
    input.value = codeValue;
    codeMsg(null);
    renderCodeBoxes();
  });
  $('#code-boxes').parentElement.addEventListener('click', () => input.focus());
  $('#code-submit').addEventListener('click', submitCode);
  $('#code-paste').addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      codeValue = normalizeCode(t).slice(0, 8);
      input.value = codeValue;
      renderCodeBoxes();
      if (codeValue.length === 8) submitCode();
    } catch {
      toast('Komeka wenyine mu kazu ka kode.');
      input.focus();
    }
  });

  // settings
  $('#set-duration').value = String(prefs.duration);
  $('#set-duration').addEventListener('change', e => {
    prefs.duration = Number(e.target.value);
    save(KEY.prefs, prefs);
    renderHome();
  });
  $('#set-warn').checked = !!prefs.warn;
  $('#set-warn').addEventListener('change', e => {
    prefs.warn = e.target.checked;
    save(KEY.prefs, prefs);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && exam) updateTimer();
  });

  window.addEventListener('popstate', () => {
    if (screenStack.length > 1) {
      screenStack.pop();
      show(screenStack[screenStack.length - 1], false);
    }
  });
}

/* ── keeping an installed app current ────────────────────────────────
   An installed PWA can sit on an old build indefinitely: it may never
   do a fresh navigation, and on iOS its storage is a separate partition
   from Safari, so the browser looking up to date proves nothing. So we
   ask the browser to re-check the worker on every launch and every time
   the app comes back to the foreground, and reload once a new one takes
   over — but never in the middle of an exam.
   ------------------------------------------------------------------ */
let swReg = null;
let reloadPending = false;
let reloading = false;
let lastUpdateCheck = 0;
let swVersion = '';

function applyUpdateNow() {
  if (reloading) return;
  reloading = true;
  location.reload();
}

function onNewVersionReady() {
  if (exam) {                       // never yank the page mid-exam
    reloadPending = true;
    return;
  }
  toast('Porogaramu iravugururwa…');
  setTimeout(applyUpdateNow, 800);
}

async function checkForUpdate(force) {
  if (!('serviceWorker' in navigator)) return;
  if (!force && Date.now() - lastUpdateCheck < 60000) return;
  lastUpdateCheck = Date.now();
  try {
    if (!swReg) swReg = await navigator.serviceWorker.getRegistration();
    if (swReg) await swReg.update();
  } catch { /* offline, or the check was refused */ }
}

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;

  // A first install also fires controllerchange, but that page is already
  // running current code — only a REPLACEMENT means "reload".
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) onNewVersionReady();
  });

  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'version') {
      swVersion = String(e.data.cache || '').replace('kora-utware-', '');
      if ($('#screen-settings').classList.contains('active')) renderSettings();
    }
  });

  navigator.serviceWorker.register('sw.js').then(reg => {
    swReg = reg;
    if (!navigator.onLine) return;
    checkForUpdate(true);
    if (reg.active) {
      // fill any gaps left by a patchy first load, and learn the build id
      reg.active.postMessage({ type: 'topup' });
      reg.active.postMessage({ type: 'version' });
    }
  }).catch(() => {});

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && navigator.onLine) checkForUpdate();
  });
  window.addEventListener('online', () => checkForUpdate(true));
}

/* ── install prompt ──────────────────────────────────────────────────
   Captured here, offered from Igenamiterere → "Shyira kuri telefone".
   It is deliberately not in the header: brand + licence pill + gear
   already fill a 375 px screen, and a fourth control pushed the page
   into sideways scrolling. */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
});

/* ── boot ──────────────────────────────────────────────────────────── */
async function boot() {
  try {
    const data = await (await fetch('data/questions.json')).json();
    BANK = data.questions;
    byId = new Map(BANK.map(q => [q.id, q]));
    await hydrateEnt();
    askPersistence();
  } catch {
    $('#boot').innerHTML =
      '<p style="padding:24px;text-align:center">Ibibazo ntibyaboneka.<br>Ongera ufungure porogaramu.</p>';
    return;
  }

  wire();
  applyTheme(prefs.theme);
  renderPayConfig();
  renderCodeBoxes();
  renderHome();
  show('home', false);
  $('#boot').remove();

  if (new URLSearchParams(location.search).get('go') === 'exam') {
    canExam() ? newExam() : openPaywall('exam');
  }

  registerWorker();
}

boot();
