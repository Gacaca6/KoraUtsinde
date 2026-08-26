/* ── Kora Utware — ikizamini cya provisoire ────────────────────────
   Offline exam simulator built on the official provisoire question book.
   Exam rules: 20 random questions, 12/20 to pass, 20 minutes.
   ─────────────────────────────────────────────────────────────────── */

'use strict';

const EXAM_SIZE = 20;
const PASS_MARK = 12;
const LETTERS = ['A', 'B', 'C', 'D'];

const KEY = {
  stats: 'kora.stats.v1',
  prefs: 'kora.prefs.v1',
  exam: 'kora.exam.v1',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ── storage ─────────────────────────────────────────────────────── */
const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};
const save = (key, val) => {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* full / private mode */ }
};

let BANK = [];
let byId = new Map();
let stats = load(KEY.stats, { attempts: [], perQ: {} });
let prefs = load(KEY.prefs, { duration: 20, warn: true });

/* ── helpers ─────────────────────────────────────────────────────── */
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
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const day = ['Ku cyumweru', 'Kuwa mbere', 'Kuwa kabiri', 'Kuwa gatatu',
               'Kuwa kane', 'Kuwa gatanu', 'Kuwa gatandatu'][d.getDay()];
  return `${day}, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} · ${
    String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

function confirmAsk(title, text, yes = 'Yego') {
  return new Promise(resolve => {
    const sheet = $('#confirm');
    $('#cf-title').textContent = title;
    $('#cf-text').textContent = text;
    $('#cf-yes').textContent = yes;
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

/* ── router ──────────────────────────────────────────────────────── */
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

/** Go back one screen. Routed through history so the Android back
 *  button and the in-app '‹' button behave identically. */
function back() {
  if (screenStack.length > 1) history.back();
}

function goHome() {
  screenStack = ['home'];
  show('home', false);
  renderHome();
}

/* ── question rendering ──────────────────────────────────────────── */
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
      f.className = 'q-flagged';
      f.textContent = '⚑ Wamenyesheje';
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
      img.loading = 'eager';
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

    if (reveal) {
      const mark = document.createElement('span');
      mark.className = 'opt-mark';
      if (i === q.a) mark.textContent = '✓';
      else if (chosen === i) mark.textContent = '✕';
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

/* ── stats bookkeeping ───────────────────────────────────────────── */
function recordAnswer(qid, correct) {
  const rec = stats.perQ[qid] || (stats.perQ[qid] = { seen: 0, wrong: 0 });
  rec.seen++;
  if (!correct) rec.wrong++;
  else if (rec.wrong > 0) rec.wrong--;   // decays as he gets it right again
  save(KEY.stats, stats);
}

const wrongIds = () => Object.entries(stats.perQ)
  .filter(([, r]) => r.wrong > 0)
  .sort((a, b) => b[1].wrong - a[1].wrong)
  .map(([id]) => Number(id))
  .filter(id => byId.has(id));

/* ═══════════════════════ EXAM ════════════════════════════════════ */
let exam = null;
let tick = null;

function newExam() {
  const picked = shuffled(BANK).slice(0, Math.min(EXAM_SIZE, BANK.length));
  const mins = Number(prefs.duration) || 0;
  exam = {
    ids: picked.map(q => q.id),
    answers: {},
    flags: [],
    idx: 0,
    startedAt: Date.now(),
    duration: mins * 60,
    endsAt: mins ? Date.now() + mins * 60000 : 0,
    warned: false,
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

function examQuestion(i = exam.idx) { return byId.get(exam.ids[i]); }

function renderExam() {
  const q = examQuestion();
  const body = $('#ex-body');
  body.innerHTML = '';
  body.append(questionNode(q, {
    chosen: exam.answers[q.id] ?? null,
    position: exam.idx + 1,
    total: exam.ids.length,
    flagged: exam.flags.includes(q.id),
    onPick: i => {
      exam.answers[q.id] = i;
      save(KEY.exam, exam);
      renderExam();
      if (exam.idx < exam.ids.length - 1) setTimeout(() => move(1), 180);
    },
  }));

  $('#ex-pos').textContent = exam.idx + 1;
  $('#ex-total').textContent = exam.ids.length;
  $('#ex-pbar').style.width = `${((exam.idx + 1) / exam.ids.length) * 100}%`;
  $('#btn-prev').disabled = exam.idx === 0;
  $('#btn-flag').classList.toggle('on', exam.flags.includes(q.id));
  $('#btn-next').textContent = exam.idx === exam.ids.length - 1 ? 'Ohereza' : 'Komeza ›';
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
  if (!exam.endsAt) {                                   // no time limit
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
    try { navigator.vibrate?.([120, 60, 120]); } catch { /* not allowed yet */ }
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
  const blank = detail.filter(d => d.chosen === null).length;
  const seconds = Math.round((Date.now() - exam.startedAt) / 1000);
  const attempt = {
    date: Date.now(), score, total: exam.ids.length,
    passed: score >= PASS_MARK, seconds, timedOut,
    detail: detail.map(d => [d.id, d.chosen]),
  };
  stats.attempts.unshift(attempt);
  stats.attempts = stats.attempts.slice(0, 60);
  save(KEY.stats, stats);

  localStorage.removeItem(KEY.exam);
  const finished = exam;
  exam = null;

  showResult(attempt, finished, timedOut);
}

/* ── result ──────────────────────────────────────────────────────── */
let lastAttempt = null;

function showResult(attempt, finished, timedOut) {
  lastAttempt = attempt;
  const pass = attempt.passed;
  const v = $('#verdict');
  v.className = `verdict ${pass ? 'pass' : 'fail'}`;
  $('#rs-score').textContent = attempt.score;
  $('#rs-title').textContent = pass ? 'Watsinze!' : 'Ntabwo watsinze';
  $('#rs-sub').textContent = timedOut
    ? `Igihe cyarangiye. Amanota yo gutsinda ni ${PASS_MARK}/20.`
    : pass
      ? `Warenze amanota yo gutsinda (${PASS_MARK}/20). Komeza gutyo!`
      : `Ukeneye nibura ${PASS_MARK}/20. Ongera wimenyereze hanyuma ugerageze.`;

  const wrong = attempt.total - attempt.score;
  const blank = attempt.detail.filter(([, c]) => c === null).length;
  $('#rs-right').textContent = attempt.score;
  $('#rs-wrong').textContent = wrong - blank;
  $('#rs-blank').textContent = blank;
  $('#rs-time').textContent = fmtClock(attempt.seconds);

  // per-category breakdown
  const groups = { sign: [0, 0], rule: [0, 0] };
  attempt.detail.forEach(([id, chosen]) => {
    const q = byId.get(id);
    if (!q) return;
    const g = groups[q.c];
    g[1]++;
    if (chosen === q.a) g[0]++;
  });
  const labels = { sign: 'Ibyapa', rule: 'Amategeko' };
  const bd = $('#rs-breakdown');
  bd.innerHTML = '<h2>Uko wagenze</h2>';
  Object.entries(groups).forEach(([k, [ok, n]]) => {
    if (!n) return;
    const row = document.createElement('div');
    row.className = 'bd-row';
    row.innerHTML = `<span class="bd-label">${labels[k]}</span>
      <span class="bd-track"><span class="bd-fill" style="width:${(ok / n) * 100}%"></span></span>
      <span class="bd-val">${ok}/${n}</span>`;
    bd.append(row);
  });

  renderHome();
  screenStack = ['home'];      // the finished exam screen is gone; back → home
  show('result');
}

/* ── review ──────────────────────────────────────────────────────── */
function showReview(attempt, title = 'Gusubiramo') {
  $('#review-title').textContent = title;
  const body = $('#review-body');
  body.innerHTML = '';

  attempt.detail.forEach(([id, chosen], i) => {
    const q = byId.get(id);
    if (!q) return;
    const item = document.createElement('div');
    item.className = 'rv-item card';

    const head = document.createElement('div');
    head.className = 'q-head';
    const tag = document.createElement('span');
    tag.className = 'q-tag';
    tag.textContent = `Ikibazo ${i + 1}`;
    const kind = document.createElement('span');
    kind.className = 'q-tag';
    kind.style.cssText = 'background:transparent;color:var(--ink-3);padding-left:0';
    kind.textContent = q.c === 'sign' ? 'Icyapa' : 'Itegeko';
    const badge = document.createElement('span');
    const ok = chosen === q.a;
    badge.className = `rv-badge ${chosen === null ? 'blank' : ok ? 'ok' : 'bad'}`;
    badge.textContent = chosen === null ? 'Ntiwasubije' : ok ? 'Nibyo' : 'Sibyo';
    head.append(tag, badge, kind);
    item.append(head);

    item.append(questionNode(q, { chosen, reveal: true, showHead: false }));
    body.append(item);
  });

  show('review');
}

/* ═══════════════════════ PRACTICE ════════════════════════════════ */
let practice = null;

function startPractice(kind) {
  let pool;
  const titles = { all: 'Ibibazo byose', sign: 'Ibyapa', rule: 'Amategeko', wrong: 'Amakosa yanjye' };

  if (kind === 'wrong') {
    const ids = wrongIds();
    if (!ids.length) {
      toast('Nta makosa ufite ubu. Tangira ikizamini!');
      return;
    }
    pool = ids.map(id => byId.get(id));
  } else if (kind === 'all') {
    pool = shuffled(BANK);
  } else {
    pool = shuffled(BANK.filter(q => q.c === kind));
  }

  practice = { qs: pool, idx: 0, answers: {}, ok: 0, bad: 0 };
  $('#pr-title').textContent = titles[kind];
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
    position: practice.idx + 1,
    total: practice.qs.length,
    onPick: chosen !== undefined ? null : i => {
      practice.answers[q.id] = i;
      const correct = i === q.a;
      correct ? practice.ok++ : practice.bad++;
      recordAnswer(q.id, correct);
      renderPractice();
    },
  }));

  if (chosen !== undefined) {
    const fb = document.createElement('div');
    const correct = chosen === q.a;
    fb.className = `feedback ${correct ? 'ok' : 'bad'}`;
    fb.textContent = correct
      ? '✓ Nibyo — igisubizo ni cyo.'
      : `✕ Sibyo — igisubizo nyacyo ni ${LETTERS[q.a]}.`;
    body.append(fb);
    fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  $('#pr-tally').innerHTML =
    `<span class="t-ok">${practice.ok}</span> · <span class="t-bad">${practice.bad}</span>`;
  $('#pr-prev').disabled = practice.idx === 0;
  $('#pr-next').textContent =
    practice.idx === practice.qs.length - 1 ? 'Birarangiye' : 'Komeza ›';
}

function movePractice(delta) {
  const next = practice.idx + delta;
  if (next < 0) return;
  if (next >= practice.qs.length) {
    toast(`Warangije: ${practice.ok} byiza, ${practice.bad} bibi.`);
    goHome();
    return;
  }
  practice.idx = next;
  renderPractice();
}

/* ═══════════════════════ HOME ════════════════════════════════════ */
function renderHome() {
  const a = stats.attempts;
  $('#st-attempts').textContent = a.length;
  $('#st-passed').textContent = a.filter(x => x.passed).length;
  $('#st-best').textContent = a.length ? `${Math.max(...a.map(x => x.score))}/20` : '—';
  $('#st-avg').textContent = a.length
    ? `${(a.reduce((s, x) => s + x.score, 0) / a.length).toFixed(1)}/20` : '—';

  // sparkline of the last 12 attempts, oldest first
  const spark = $('#spark');
  spark.innerHTML = '';
  a.slice(0, 12).reverse().forEach(x => {
    const bar = document.createElement('i');
    bar.style.height = `${clamp((x.score / 20) * 100, 8, 100)}%`;
    bar.className = x.passed ? 'pass' : 'fail';
    bar.title = `${x.score}/20`;
    spark.append(bar);
  });
  if (!a.length) spark.innerHTML = '<i style="height:8%"></i>'.repeat(12);

  // readiness = average of the last five attempts
  const recent = a.slice(0, 5);
  const ring = $('#ring-fg');
  const CIRC = 327;
  if (recent.length) {
    const pct = Math.round(recent.reduce((s, x) => s + x.score, 0) / recent.length / 20 * 100);
    $('#ready-value').textContent = `${pct}%`;
    ring.style.strokeDashoffset = String(CIRC - (CIRC * pct) / 100);
    let label, sub, color;
    if (pct >= 80) {
      label = 'Witeguye neza'; color = '#14b88a';
      sub = 'Uri ku rwego rwo gutsinda. Komeza wimenyereze buri munsi.';
    } else if (pct >= 60) {
      label = 'Uri hafi'; color = '#e0a94a';
      sub = 'Urashobora gutsinda, ariko ntibirahamye. Reba amakosa yawe.';
    } else {
      label = 'Ukeneye kwiga'; color = '#f0736a';
      sub = 'Wimenyereze cyane mbere yo kujya mu kizamini nyacyo.';
    }
    $('#ready-label').textContent = label;
    $('#ready-sub').textContent = sub;
    ring.style.stroke = color;
  } else {
    $('#ready-value').textContent = '—';
    ring.style.strokeDashoffset = String(CIRC);
    $('#ready-label').textContent = 'Ntabwo urapima';
    $('#ready-sub').textContent = 'Tangira ikizamini cya mbere kugira ngo umenye aho ugeze.';
  }

  $('#cnt-all').textContent = BANK.length;
  $('#cnt-sign').textContent = BANK.filter(q => q.c === 'sign').length;
  $('#cnt-rule').textContent = BANK.filter(q => q.c === 'rule').length;
  $('#cnt-wrong').textContent = wrongIds().length;
  $('#fp-count').textContent = BANK.length;

  $$('[data-mins]').forEach(el => {
    el.textContent = Number(prefs.duration) ? prefs.duration : '∞';
  });

  // unfinished exam?
  const saved = load(KEY.exam, null);
  const card = $('#resume-card');
  if (saved && saved.ids && saved.ids.length) {
    const done = Object.keys(saved.answers || {}).length;
    const expired = saved.endsAt && Date.now() > saved.endsAt;
    if (expired) {
      localStorage.removeItem(KEY.exam);
      card.classList.add('hidden');
    } else {
      $('#resume-info').textContent =
        `Wasubije ${done}/${saved.ids.length} · ${saved.endsAt
          ? 'hasigaye ' + fmtClock((saved.endsAt - Date.now()) / 1000) : 'nta gihe ntarengwa'}`;
      card.classList.remove('hidden');
    }
  } else {
    card.classList.add('hidden');
  }
}

function renderHistory() {
  const body = $('#history-body');
  body.innerHTML = '';
  if (!stats.attempts.length) {
    body.innerHTML = '<p class="empty">Nta kizamini urakora.<br>Tangira ikizamini cya mbere.</p>';
    show('history');
    return;
  }
  stats.attempts.forEach(att => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'hist-row';
    row.style.cssText = 'width:100%;background:none;border:0;border-bottom:1px solid var(--line);text-align:left';
    row.innerHTML = `
      <span class="hist-score ${att.passed ? 'pass' : 'fail'}">${att.score}</span>
      <span class="hist-meta">
        <strong>${att.passed ? 'Watsinze' : 'Ntiwatsinze'} — ${att.score}/${att.total}</strong>
        <span>${fmtDate(att.date)} · ${fmtClock(att.seconds)}${att.timedOut ? ' · igihe cyarangiye' : ''}</span>
      </span>
      <span class="muted">›</span>`;
    row.addEventListener('click', () => showReview(att, `Ikizamini cyo ku ${fmtDate(att.date)}`));
    body.append(row);
  });
  show('history');
}

/* ═══════════════════════ WIRING ══════════════════════════════════ */
function wire() {
  $('#btn-start-exam').addEventListener('click', async () => {
    const saved = load(KEY.exam, null);
    if (saved && saved.ids) {
      if (!await confirmAsk('Tangira gishya?', 'Hari ikizamini utarangije. Nutangira gishya, icya kera kizasibwa.', 'Tangira gishya')) return;
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
    if (exam.idx === exam.ids.length - 1) trySubmit();
    else move(1);
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
    if (await confirmAsk('Sohoka mu kizamini?', 'Ikizamini kizabikwa ushobora kugikomeza nyuma.', 'Sohoka')) {
      clearInterval(tick);
      save(KEY.exam, exam);
      exam = null;
      goHome();
    }
  });

  $('#btn-review').addEventListener('click', () => showReview(lastAttempt));
  $('#btn-again').addEventListener('click', newExam);
  $('#btn-home').addEventListener('click', goHome);
  $('#btn-history').addEventListener('click', renderHistory);
  $('#btn-clear').addEventListener('click', async () => {
    if (await confirmAsk('Siba amateka?', 'Ibizamini byose n\'amakosa yawe bizasibwa burundu.', 'Siba')) {
      stats = { attempts: [], perQ: {} };
      save(KEY.stats, stats);
      renderHistory();
      renderHome();
    }
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

  // keep the countdown honest when the phone sleeps or the tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && exam) updateTimer();
  });

  // Android back button / browser back
  window.addEventListener('popstate', () => {
    if (screenStack.length > 1) {
      screenStack.pop();
      show(screenStack[screenStack.length - 1], false);
    }
  });
}

/* ── install prompt ──────────────────────────────────────────────── */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  $('#btn-install').classList.remove('hidden');
});
$('#btn-install').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#btn-install').classList.add('hidden');
});

/* ── boot ────────────────────────────────────────────────────────── */
async function boot() {
  try {
    const res = await fetch('data/questions.json');
    const data = await res.json();
    BANK = data.questions;
    byId = new Map(BANK.map(q => [q.id, q]));
  } catch (err) {
    $('#boot').innerHTML =
      '<p style="padding:24px;text-align:center">Ibibazo ntibyaboneka.<br>Ongera ufungure porogaramu.</p>';
    return;
  }

  wire();
  renderHome();
  show('home', false);
  $('#boot').remove();

  // launched from the home-screen shortcut
  if (new URLSearchParams(location.search).get('go') === 'exam') newExam();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install optional */ });
  }
}

boot();
