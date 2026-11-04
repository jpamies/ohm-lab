// Ohm Lab · aplicación principal
import { CLAVE_SECRETA, IDIOMA_POR_DEFECTO } from './config.js';
import { t, setLang, getLang, applyTranslations } from './i18n.js';
import { createStore, recordLevel } from './storage.js';
import {
  current, formatNumber, formatOhms, parseUserNumber, withinTolerance, ledCurrent, minLedResistance, evaluateExpression
} from './physics.js';
import {
  LEVEL1, LED, LEVEL3, LEVEL_IDS, CIRCUITS, isTargetCurrent, checkHalfCurrent, canHalveFrom, scoreLevel1,
  power, isTargetPower, solveCircuit, isDoubleVoltage, isTargetTotalCurrent, scoreCircuits,
  prepareLevel2, evaluateLed, validateRound, ledBrightness, roundPoints, scoreLevel2,
  generateQuestion, solveQuestion, toSI, answerPoints, starsLevel3, isUnlocked, allDone, LEVEL2_ROUNDS
} from './levels.js';
import {
  signCertificate, isoSeconds, verifyUrl, buildDiplomaPdf, drawBadge, normalizeField
} from './certificate.js';
import { createCircuitView } from './circuitview.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const store = createStore();
setLang(store.state.lang || IDIOMA_POR_DEFECTO);

// Comprobación de integridad de las rondas del nivel 2 (si falla, se ve en la consola)
LEVEL2_ROUNDS.forEach(r => {
  const errors = validateRound(r);
  if (errors.length) console.error('Ronda mal construida', r.id, errors);
});

/* ═══════════════════════ Utilidades ═══════════════════════ */

const fmt = (n, d = 2) => formatNumber(n, getLang(), d);
const ohms = r => formatOhms(r, getLang());
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

function toast(message, ms = 3200) {
  const box = $('#toast');
  box.textContent = message;
  box.hidden = false;
  box.classList.remove('show');
  void box.offsetWidth;
  box.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { box.hidden = true; }, ms);
}

function starsHtml(n) {
  return Array.from({ length: 3 }, (_, k) =>
    `<span class="star ${k < n ? 'on' : ''}" aria-hidden="true">★</span>`).join('');
}

function dateText(iso) {
  if (!iso) return '';
  const locale = getLang() === 'ca' ? 'ca-ES' : 'es-ES';
  return new Date(iso).toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' });
}

function shortDate(iso) {
  const locale = getLang() === 'ca' ? 'ca-ES' : 'es-ES';
  return new Date(iso || Date.now()).toLocaleDateString(locale);
}

/* ═══════════════════════ Navegación ═══════════════════════ */

let currentScreen = null;
const screenCleanup = [];

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const profile = store.state.profile;
  let target = hash || (profile ? 'mapa' : 'inicio');
  if (!profile && target !== 'inicio') target = 'inicio';
  if (LEVEL_IDS.includes(target) && !isUnlocked(store.state.progress, target)) target = 'mapa';
  show(target);
}

function go(target) {
  if (location.hash === `#/${target}`) route();
  else location.hash = `#/${target}`;
}

function show(target) {
  while (screenCleanup.length) screenCleanup.pop()();
  const id = { inicio: 'start', mapa: 'map', n1: 'n1', nc: 'nc', n2: 'n2', n3: 'n3', editar: 'start' }[target] || 'map';
  $$('.screen').forEach(s => { s.hidden = s.id !== `screen-${id}`; });
  currentScreen = target;
  renderChrome();
  if (id === 'start') renderStart(target === 'editar');
  if (id === 'map') renderMap();
  if (id === 'n1') startLevel1();
  if (id === 'nc') startCircuits();
  if (id === 'n2') startLevel2();
  if (id === 'n3') startLevel3();
  window.scrollTo(0, 0);
  const heading = document.querySelector(`#screen-${id} h1`);
  if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
}

function renderChrome() {
  applyTranslations();
  $('#lang-btn').textContent = t('lang.switch');
  $('#storage-warning').hidden = store.persistent;
  const progress = store.state.progress;
  const done = LEVEL_IDS.filter(id => progress[id]?.done).length;
  $('#progress').setAttribute('aria-label', t('progress.label', { n: done }));
  $$('.pblock').forEach(b => {
    const id = b.dataset.level;
    b.classList.toggle('done', Boolean(progress[id]?.done));
    b.classList.toggle('current', currentScreen === id);
  });
}

/* ═══════════════════════ Inicio ═══════════════════════ */

const NAME_RE = /^[\p{L}\p{M}0-9 .'’·\-]+$/u;
const GROUP_RE = /^[\p{L}\p{M}0-9 .'’·ºª\-/]+$/u;
const tidy = s => s.normalize('NFC').replace(/\s+/g, ' ').trim();

function validateProfile(raw) {
  const name = tidy(raw.name);
  const group = tidy(raw.group);
  const school = tidy(raw.school);
  const errors = {};
  if (name.split(' ').filter(Boolean).length < 2) errors.name = t('start.err.name');
  else if (name.length > 60) errors.name = t('start.err.long');
  else if (!NAME_RE.test(name)) errors.name = t('start.err.chars');
  if (!group) errors.group = t('start.err.group');
  else if (group.length > 12) errors.group = t('start.err.long');
  else if (!GROUP_RE.test(group)) errors.group = t('start.err.chars');
  if (school.length > 60) errors.school = t('start.err.long');
  else if (school && !GROUP_RE.test(school.replace(/[,()]/g, ''))) errors.school = t('start.err.chars');
  return { profile: { name, group, school }, errors };
}

function renderStart(editing) {
  const form = $('#start-form');
  const p = store.state.profile;
  if (editing && p) {
    form.name.value = p.name;
    form.group.value = p.group;
    form.school.value = p.school;
  }
  ['name', 'group', 'school'].forEach(f => { $(`#e-${f}`).textContent = ''; form[f].removeAttribute('aria-invalid'); });
}

$('#start-form').addEventListener('submit', e => {
  e.preventDefault();
  const form = e.currentTarget;
  const { profile, errors } = validateProfile({
    name: form.name.value, group: form.group.value, school: form.school.value
  });
  let first = null;
  ['name', 'group', 'school'].forEach(f => {
    $(`#e-${f}`).textContent = errors[f] || '';
    if (errors[f]) { form[f].setAttribute('aria-invalid', 'true'); first = first || form[f]; }
    else form[f].removeAttribute('aria-invalid');
  });
  if (first) { first.focus(); return; }
  store.update(s => { s.profile = profile; });
  go('mapa');
});

/* ═══════════════════════ Mapa ═══════════════════════ */

let resetArmed = false;

function renderMap() {
  const { profile, progress } = store.state;
  $('#map-hello').textContent = t('map.hello', { name: profile.name.split(' ')[0] });
  $('#map-group').textContent = t('map.group', { group: profile.group }) + (profile.school ? ` · ${profile.school}` : '');

  const world = $('#world');
  world.innerHTML = '';
  LEVEL_IDS.forEach((id, k) => {
    const p = progress[id];
    const unlocked = isUnlocked(progress, id);
    const card = el('li', { class: `level-card lc-${id} ${unlocked ? '' : 'locked'} ${p?.done ? 'done' : ''}` });
    card.append(
      el('div', { class: 'lc-icon', 'aria-hidden': 'true', text: ['💧', '🔀', '💡', '⏱'][k] }),
      el('p', { class: 'pixel lc-world', text: t('map.world', { n: k + 1 }) }),
      el('h2', { class: 'lc-name', text: t(`level.${id}.name`) }),
      el('p', { class: 'lc-verb', text: t(`level.${id}.verb`) })
    );
    if (p?.done) {
      card.append(
        el('p', { class: 'lc-stars', html: starsHtml(p.stars) + `<span class="sr-only">${esc(t('result.stars', { stars: p.stars }))}</span>` }),
        el('p', { class: 'lc-best', text: `${t('map.done')} · ${t('map.best', { points: p.points })}` })
      );
    }
    if (unlocked) {
      card.append(el('button', {
        type: 'button', class: `btn ${p?.done ? 'btn-stone' : 'btn-grass'} btn-big`,
        text: p?.done ? t('map.replay') : `▶ ${t('map.play')}`,
        'aria-label': `${p?.done ? t('map.replay') : t('map.play')}: ${t(`level.${id}.name`)}`,
        onclick: () => go(id)
      }));
    } else {
      card.append(el('p', { class: 'lc-locked', text: t('map.locked', { n: k }) }));
    }
    world.append(card);
  });

  renderRewards();
  renderDiplomaPanel();

  const resetBtn = $('#reset-btn');
  resetArmed = false;
  resetBtn.textContent = t('map.reset');
}

async function renderRewards() {
  try { await document.fonts.load('16px PressStart'); } catch { /* se usa la fuente de respaldo */ }
  const box = $('#rewards');
  box.innerHTML = '';
  const { progress, profile } = store.state;
  LEVEL_IDS.forEach((id, k) => {
    const p = progress[id];
    const card = el('div', { class: `reward ${p?.done ? '' : 'locked'}` });
    if (p?.done) {
      const canvas = $('#badge-canvas');
      drawBadge(canvas, {
        levelId: id, title: t(`badge.${id}`), name: profile.name,
        subtitle: t(`level.${id}.name`), dateText: shortDate(p.completedAt)
      });
      const url = canvas.toDataURL('image/png');
      card.append(
        el('img', { src: url, alt: `${t(`badge.${id}`)} · ${profile.name}`, width: 150, height: 150 }),
        el('p', { class: 'reward-name', text: t(`badge.${id}`) }),
        el('a', { class: 'btn btn-small btn-gold', href: url, download: `badge-ohm-lab-${k + 1}.png`, text: t('map.download') })
      );
    } else {
      card.append(
        el('div', { class: 'reward-lock', 'aria-hidden': 'true', text: '?' }),
        el('p', { class: 'reward-name', text: t(`badge.${id}`) }),
        el('p', { class: 'small muted', text: t('map.badgeLocked', { n: k + 1 }) })
      );
    }
    box.append(card);
  });
}

function diplomaData() {
  const { profile, progress, finishedAt } = store.state;
  return {
    name: profile.name,
    group: profile.group,
    school: profile.school,
    date: isoSeconds(finishedAt),
    points: LEVEL_IDS.map(id => progress[id].points)
  };
}

async function renderDiplomaPanel() {
  const ready = allDone(store.state.progress);
  const panel = $('#diploma-panel');
  panel.classList.toggle('locked', !ready);
  $('#diploma-text').textContent = ready ? t('map.diplomaReady') : t('map.diplomaLocked');
  $('#diploma-btn').hidden = !ready;
  $('#diploma-code').textContent = '';
  if (ready) {
    try {
      const code = await signCertificate(diplomaData(), CLAVE_SECRETA);
      $('#diploma-code').textContent = t('map.diplomaCode', { code });
    } catch { /* sin Web Crypto: se informará al descargar */ }
  }
}

// Algunos caracteres no existen en las fuentes estándar del PDF: se simplifican.
function pdfSafe(text) {
  return Array.from(String(text).normalize('NFC')).map(ch => {
    if (ch.charCodeAt(0) <= 0xff || '’‘“”–—…·€'.includes(ch)) return ch;
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
    return base.charCodeAt(0) <= 0xff ? base : '?';
  }).join('');
}

$('#diploma-btn').addEventListener('click', async () => {
  try {
    const data = diplomaData();
    const code = await signCertificate(data, CLAVE_SECRETA);
    const url = verifyUrl(location.href, data, code);
    const results = LEVEL_IDS.map(id => store.state.progress[id]);
    const doc = buildDiplomaPdf({
      jsPDF: window.jspdf.jsPDF,
      qrcode: window.qrcode,
      data: { ...data, name: pdfSafe(data.name), group: pdfSafe(data.group), school: pdfSafe(data.school) },
      code,
      results,
      url,
      shortUrl: (() => { const u = new URL('verificar.html', location.href); return u.host + u.pathname; })(),
      dateText: pdfSafe(dateText(store.state.finishedAt)),
      texts: {
        title: t('diploma.title'),
        awardedTo: t('diploma.awardedTo'),
        groupLabel: t('diploma.group'),
        reason: t('diploma.reason'),
        cols: t('diploma.cols'),
        levels: LEVEL_IDS.map((id, k) => `${k + 1}. ${t(`level.${id}.name`)}`),
        total: t('diploma.total'),
        dateLabel: t('diploma.date'),
        scan: t('diploma.scan'),
        codeLabel: t('diploma.codeLabel'),
        verifyAt: t('diploma.verifyAt'),
        footer: t('footer')
      }
    });
    store.update(s => {
      s.certificates = s.certificates.filter(c => c.code !== code);
      s.certificates.push({ data, code, issuedAt: new Date().toISOString() });
    });
    const slug = normalizeField(data.name).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-');
    doc.save(`${t('diploma.file')}-${slug}.pdf`);
  } catch (err) {
    console.error(err);
    toast(t('diploma.error'));
  }
});

$('#edit-btn').addEventListener('click', () => go('editar'));

$('#reset-btn').addEventListener('click', () => {
  const btn = $('#reset-btn');
  if (!resetArmed) {
    resetArmed = true;
    btn.textContent = t('map.resetConfirm');
    btn.classList.add('armed');
    return;
  }
  btn.classList.remove('armed');
  store.clear();
  $('#start-form').reset();
  toast(t('map.resetDone'));
  go('inicio');
});

/* ═══════════════════════ Final de nivel ═══════════════════════ */

function finishLevel(levelId, result, boxId, message) {
  const wasAllDone = allDone(store.state.progress);
  const wasDone = Boolean(store.state.progress[levelId]?.done);
  store.update(s => {
    recordLevel(s, levelId, result);
    if (!wasAllDone && allDone(s.progress)) s.finishedAt = new Date().toISOString();
  });
  renderChrome();
  const box = $(boxId);
  box.hidden = false;
  box.innerHTML = '';
  const k = LEVEL_IDS.indexOf(levelId);
  box.append(
    el('div', { class: 'panel done-panel' }, [
      el('p', { class: 'pixel done-title', text: 'LEVEL CLEAR!' }),
      el('p', { class: 'done-msg', text: message }),
      el('p', { class: 'done-stars', html: starsHtml(result.stars) + `<span class="sr-only">${esc(t('result.stars', { stars: result.stars }))}</span>` }),
      el('p', { text: `${t('result.points', { points: result.points })} · ${t('result.hits', { hits: result.hits, total: result.total })}` }),
      !wasDone ? el('p', { class: 'badge-unlock', text: `🏅 ${t('badge.unlocked')} «${t(`badge.${levelId}`)}»` }) : null,
      el('button', { type: 'button', class: 'btn btn-grass btn-big', text: t('result.toMap'), onclick: () => go('mapa') })
    ])
  );
  if (!wasDone) toast(`🏅 ${t('badge.unlocked')} ${t(`badge.${levelId}`)}`);
  confetti();
  box.querySelector('button').focus();
  return k;
}

function confetti() {
  if (reducedMotion) return;
  const colors = ['#5fbf3a', '#ffd34d', '#ff4d6d', '#3fa9f5', '#e07b39', '#b06cff'];
  const layer = el('div', { class: 'confetti', 'aria-hidden': 'true' });
  for (let k = 0; k < 40; k++) {
    const bit = el('span');
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = colors[k % colors.length];
    bit.style.animationDelay = `${Math.random() * 0.4}s`;
    bit.style.animationDuration = `${1.4 + Math.random()}s`;
    layer.append(bit);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2800);
}

/* ═══════════════════════ Animación común de los niveles con circuito ═══════════════════════ */

let animFrame = null;
let activeViews = [];

function startAnimation(views) {
  activeViews = views;
  cancelAnimationFrame(animFrame);
  if (reducedMotion) return;
  let last = performance.now();
  const tick = now => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    activeViews.forEach(v => v.tick(dt));
    animFrame = requestAnimationFrame(tick);
  };
  animFrame = requestAnimationFrame(tick);
  screenCleanup.push(() => { cancelAnimationFrame(animFrame); activeViews = []; });
}

/* ═══════════════════════ Motor de retos (niveles 1 y 2) ═══════════════════════ */

// Cada nivel de retos: { id, prefix, count, state, body(k), onComplete() }
function renderChallengeList(level) {
  const st = level.state;
  const list = $(`#${level.id}-challenges`);
  list.innerHTML = '';
  for (let k = 0; k < level.count; k++) {
    const status = k < st.step ? 'done' : k === st.step ? 'active' : 'locked';
    const li = el('li', { class: `challenge ${status}` });
    li.append(el('div', { class: 'ch-head' }, [
      el('span', { class: 'ch-icon', 'aria-hidden': 'true', text: status === 'done' ? '✔' : status === 'active' ? '▶' : '🔒' }),
      el('p', { class: 'ch-title', text: t(`${level.prefix}.c${k + 1}`) }),
      el('span', { class: 'ch-state', text: t(`challenge.${status === 'done' ? 'done' : status === 'active' ? 'pending' : 'locked'}`) })
    ]));
    if (status === 'active') {
      const body = el('div', { class: 'ch-body' });
      level.body(k, body);
      body.append(el('p', { class: `ch-msg ${st.feedbackClass}`, id: `${level.id}-msg`, 'aria-live': 'polite', text: st.message }));
      li.append(body);
    }
    if (status === 'done' && st.doneMsgs[k]) li.append(el('p', { class: 'ch-msg ok', text: st.doneMsgs[k] }));
    list.append(li);
  }
}

function setMsg(level, text, cls) {
  level.state.message = text;
  level.state.feedbackClass = cls;
  const p = $(`#${level.id}-msg`);
  if (p) { p.textContent = text; p.className = `ch-msg ${cls}`; }
}

function completeChallengeOf(level, k, msg) {
  const st = level.state;
  if (st.step !== k) return;
  st.doneMsgs[k] = msg;
  st.step = k + 1;
  st.message = '';
  st.feedbackClass = '';
  renderChallengeList(level);
  if (st.step === level.count) level.onComplete();
}

function quizGroup(level, k, label, options, prefix, correct) {
  const group = el('div', { class: 'quiz', role: 'group', 'aria-label': label });
  options.forEach((opt, idx) => {
    group.append(el('button', {
      type: 'button', class: 'btn btn-stone quiz-opt', 'data-opt': opt,
      text: `${'abcd'[idx]}) ${t(`${prefix}.${opt}`)}`,
      onclick: e => {
        if (opt === correct) { completeChallengeOf(level, k, t(`${prefix}.ok`)); return; }
        level.state.mistakes += 1;
        level.state.failedQuizzes.add(k);
        const b = e.currentTarget;
        b.disabled = true;
        b.classList.add('wrong');
        b.textContent = `✘ ${b.textContent}`;
        setMsg(level, t(`${prefix}.no.${opt}`), 'bad');
      }
    }));
  });
  return group;
}

const freshChallengeState = () => ({ step: 0, mistakes: 0, failedQuizzes: new Set(), message: '', feedbackClass: '', doneMsgs: [] });

function setupSlider(input, cfg, value) {
  Object.assign(input, { min: cfg.min, max: cfg.max, step: cfg.step });
  input.value = value;
}

/* ═══════════════════════ Nivel 1 · El agua y la corriente (Ley de Ohm) ═══════════════════════ */

const n1 = { state: freshChallengeState() };
const L1 = {
  id: 'n1',
  prefix: 'n1',
  count: LEVEL1.challenges,
  get state() { return n1.state; },
  body: (k, body) => {
    if (k === 0) body.append(el('p', { class: 'muted', text: t('n1.c1.hint') }));
    if (k === 1) {
      body.append(el('button', {
        type: 'button', class: 'btn btn-gold', text: t('n1.c2.start'),
        onclick: () => {
          if (!canHalveFrom(n1.r)) {
            n1.start = null;
            setMsg(L1, t('n1.c2.tooBig', { r: fmt(n1.r, 0) }), 'warn');
            return;
          }
          n1.start = { v: n1.v, r: n1.r };
          const i0 = current(n1.v, n1.r);
          setMsg(L1, t('n1.c2.started', { v: fmt(n1.v, 1), i: fmt(i0, 3), half: fmt(i0 / 2, 3) }), 'info');
        }
      }));
    }
    if (k === 2) body.append(quizGroup(L1, 2, t('n1.c3'), LEVEL1.quizOptions, 'n1.c3', LEVEL1.quizAnswer));
    if (k === 3) body.append(el('p', { class: 'muted', text: t('n1.c4.hint') }));
  },
  onComplete: () => finishLevel('n1', scoreLevel1(n1.state.mistakes, n1.state.failedQuizzes.size), '#n1-done', t('n1.done'))
};

function startLevel1() {
  Object.assign(n1, { v: LEVEL1.voltage.initial, r: LEVEL1.resistance.initial, start: null, state: freshChallengeState() });
  $('#n1-done').hidden = true;
  setupSlider($('#n1-v'), LEVEL1.voltage, n1.v);
  setupSlider($('#n1-r'), LEVEL1.resistance, n1.r);
  n1.elec = createCircuitView($('#n1-circuit'), { style: 'elec', topology: 'single', load: 'resistor', reducedMotion });
  n1.water = createCircuitView($('#n1-water'), { style: 'water', topology: 'single', load: 'resistor', reducedMotion });
  updateLevel1();
  renderChallengeList(L1);
  startAnimation([n1.elec, n1.water]);
}

function updateLevel1() {
  const { v, r } = n1;
  const i = current(v, r);
  const p = power(v, i);
  const P = { v: fmt(v, 1), r: fmt(r, 0), i: fmt(i, 3), p: fmt(p, 2) };
  $('#n1-v-out').textContent = `${P.v} V`;
  $('#n1-r-out').textContent = `${P.r} Ω`;
  $('#n1-v').setAttribute('aria-valuetext', `${P.v} V`);
  $('#n1-r').setAttribute('aria-valuetext', `${P.r} Ω`);
  $('#n1-calc').textContent = t('n1.calc', P);
  $('#n1-power').textContent = t('n1.power', P);
  const item = [{ R: r, I: i, V: v, P: p }];
  n1.elec.update({ V: v, I: i, items: item, labels: { source: `${P.v} V`, items: [`R = ${P.r} Ω`], bottom: `I = ${P.i} A · P = ${P.p} W` } });
  n1.water.update({ V: v, I: i, items: item, labels: { source: `${P.v} V`, items: [`${P.r} Ω`], bottom: t('n1.waterBottom', P) } });
  $('#n1-circuit').setAttribute('aria-label', t('n1.circuitAlt', P));
  $('#n1-water').setAttribute('aria-label', t('n1.waterAlt', P));
}

function checkLevel1() {
  const st = n1.state;
  if (st.step === 0 && isTargetCurrent(n1.v, n1.r)) {
    completeChallengeOf(L1, 0, t('n1.c1.ok', { v: fmt(n1.v, 1), r: fmt(n1.r, 0) }));
  } else if (st.step === 1 && n1.start) {
    const res = checkHalfCurrent(n1.start, n1.v, n1.r);
    if (res === 'voltage-changed') setMsg(L1, t('n1.c2.voltage', { v: fmt(n1.start.v, 1) }), 'warn');
    else if (res === 'ok') completeChallengeOf(L1, 1, t('n1.c2.ok', { r0: fmt(n1.start.r, 0), r: fmt(n1.r, 0) }));
    else if (st.feedbackClass === 'warn') {
      const i0 = current(n1.start.v, n1.start.r);
      setMsg(L1, t('n1.c2.started', { v: fmt(n1.start.v, 1), i: fmt(i0, 3), half: fmt(i0 / 2, 3) }), 'info');
    }
  } else if (st.step === 3 && isTargetPower(n1.v, n1.r)) {
    completeChallengeOf(L1, 3, t('n1.c4.ok', { v: fmt(n1.v, 1), i: fmt(current(n1.v, n1.r), 2) }));
  }
}

function onSliderL1() {
  n1.v = Number($('#n1-v').value);
  n1.r = Number($('#n1-r').value);
  updateLevel1();
  checkLevel1();
}
$('#n1-v').addEventListener('input', onSliderL1);
$('#n1-r').addEventListener('input', onSliderL1);

/* ═══════════════════════ Nivel 2 · Serie y paralelo ═══════════════════════ */

const nc = { state: freshChallengeState() };
const LC = {
  id: 'nc',
  prefix: 'nc',
  count: CIRCUITS.challenges,
  get state() { return nc.state; },
  body: (k, body) => {
    if (k === 0) body.append(el('p', { class: 'muted', text: t('nc.c1.hint') }));
    if (k === 1) body.append(quizGroup(LC, 1, t('nc.c2'), CIRCUITS.kvlOptions, 'nc.c2', CIRCUITS.kvlAnswer));
    if (k === 2) body.append(el('p', { class: 'muted', text: t('nc.c3.hint') }));
    if (k === 3) {
      body.append(el('p', { class: 'muted', text: t('nc.c4.hint') }));
      body.append(quizGroup(LC, 3, t('nc.c4'), CIRCUITS.brightOptions, 'nc.c4', CIRCUITS.brightAnswer));
    }
  },
  onComplete: () => finishLevel('nc', scoreCircuits(nc.state.mistakes, nc.state.failedQuizzes.size), '#nc-done', t('nc.done'))
};

function startCircuits() {
  Object.assign(nc, { v: CIRCUITS.voltage.initial, r1: CIRCUITS.r1.initial, r2: CIRCUITS.r2.initial, mode: 'series', state: freshChallengeState() });
  $('#nc-done').hidden = true;
  setupSlider($('#nc-v'), CIRCUITS.voltage, nc.v);
  setupSlider($('#nc-r1'), CIRCUITS.r1, nc.r1);
  setupSlider($('#nc-r2'), CIRCUITS.r2, nc.r2);
  buildCircuitViews();
  renderCircuitModes();
  updateCircuits();
  renderChallengeList(LC);
}

function buildCircuitViews() {
  nc.elec = createCircuitView($('#nc-circuit'), { style: 'elec', topology: nc.mode, load: 'bulb', reducedMotion });
  nc.water = createCircuitView($('#nc-water'), { style: 'water', topology: nc.mode, load: 'bulb', reducedMotion });
  while (screenCleanup.length) screenCleanup.pop()();
  startAnimation([nc.elec, nc.water]);
}

function renderCircuitModes() {
  const box = $('#nc-modes');
  box.innerHTML = '';
  CIRCUITS.modes.forEach(mode => {
    const on = nc.mode === mode;
    box.append(el('button', {
      type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false',
      class: `btn mode-btn ${on ? 'btn-gold' : 'btn-stone'}`,
      html: `<span class="mode-icon mode-${mode}" aria-hidden="true"></span>${esc(t(`nc.mode.${mode}`))}`,
      onclick: () => {
        if (nc.mode === mode) return;
        nc.mode = mode;
        buildCircuitViews();
        renderCircuitModes();
        updateCircuits();
        checkCircuits();
        $('#nc-modes [aria-checked="true"]')?.focus();
      }
    }));
  });
}

function updateCircuits() {
  const c = solveCircuit(nc.mode, nc.v, nc.r1, nc.r2);
  nc.c = c;
  const [a, b] = c.items;
  const P = {
    v: fmt(nc.v, 1), r1: fmt(nc.r1, 0), r2: fmt(nc.r2, 0), rt: fmt(c.Rt, 1), i: fmt(c.I, 3),
    i1: fmt(a.I, 3), i2: fmt(b.I, 3), v1: fmt(a.V, 2), v2: fmt(b.V, 2), p1: fmt(a.P, 2), p2: fmt(b.P, 2)
  };
  $('#nc-v-out').textContent = `${P.v} V`;
  $('#nc-r1-out').textContent = `${P.r1} Ω`;
  $('#nc-r2-out').textContent = `${P.r2} Ω`;
  $('#nc-v').setAttribute('aria-valuetext', `${P.v} V`);
  $('#nc-r1').setAttribute('aria-valuetext', `${P.r1} Ω`);
  $('#nc-r2').setAttribute('aria-valuetext', `${P.r2} Ω`);

  const series = nc.mode === 'series';
  const lines = series ? ['nc.s1', 'nc.s2', 'nc.s3', 'nc.s4'] : ['nc.p1', 'nc.p2', 'nc.p3'];
  const calc = $('#nc-calc');
  calc.innerHTML = '';
  lines.forEach((key, k) => calc.append(el('p', { class: `calc ${k === 3 - (series ? 0 : 1) ? 'calc-law' : ''}`, text: t(key, P) })));
  calc.append(el('p', { class: 'calc calc-power', text: t('nc.power', P) }));
  $('#nc-legend').textContent = `${t(`nc.legend.${nc.mode}`)} ${t('nc.legend.common')}`;

  const elecLabels = series
    ? { source: `${P.v} V`, items: [`R₁ = ${P.r1} Ω`, `R₂ = ${P.r2} Ω`], meters: [`V₁ = ${P.v1} V`, `V₂ = ${P.v2} V`], bottom: `I = ${P.i} A · V₁ + V₂ = ${P.v} V` }
    : { source: `${P.v} V`, items: [`R₁ ${P.r1} Ω · I₁ ${P.i1} A`, `R₂ ${P.r2} Ω · I₂ ${P.i2} A`], bottom: `I = I₁ + I₂ = ${P.i} A` };
  const waterLabels = series
    ? { source: `${P.v} V`, items: [`${P.r1} Ω`, `${P.r2} Ω`], meters: [`Δp₁ ↔ ${P.v1} V`, `Δp₂ ↔ ${P.v2} V`], bottom: t('nc.wb.series') }
    : { source: `${P.v} V`, items: [`Q₁ ↔ ${P.i1} A`, `Q₂ ↔ ${P.i2} A`], bottom: t('nc.wb.parallel', P) };
  nc.elec.update({ V: c.V, I: c.I, items: c.items, labels: elecLabels });
  nc.water.update({ V: c.V, I: c.I, items: c.items, labels: waterLabels });
  $('#nc-circuit').setAttribute('aria-label', t(`nc.alt.${nc.mode}`, P));
  $('#nc-water').setAttribute('aria-label', `${t(`nc.legend.${nc.mode}`)}`);
}

function checkCircuits() {
  const st = nc.state;
  const c = nc.c;
  const P = { v: fmt(nc.v, 1), v1: fmt(c.items[0].V, 2), v2: fmt(c.items[1].V, 2), i1: fmt(c.items[0].I, 3), i2: fmt(c.items[1].I, 3) };
  if (st.step === 0) {
    if (isDoubleVoltage(c)) completeChallengeOf(LC, 0, t('nc.c1.ok', P));
    else setMsg(LC, c.mode === 'series' ? '' : t('nc.c1.mode'), c.mode === 'series' ? '' : 'info');
  } else if (st.step === 2) {
    if (isTargetTotalCurrent(c)) completeChallengeOf(LC, 2, t('nc.c3.ok', P));
    else setMsg(LC, c.mode === 'parallel' ? '' : t('nc.c3.mode'), c.mode === 'parallel' ? '' : 'info');
  }
}

function onSliderNC() {
  nc.v = Number($('#nc-v').value);
  nc.r1 = Number($('#nc-r1').value);
  nc.r2 = Number($('#nc-r2').value);
  updateCircuits();
  checkCircuits();
}
['#nc-v', '#nc-r1', '#nc-r2'].forEach(id => $(id).addEventListener('input', onSliderNC));

/* ═══════════════════════ Nivel 3 · ¡Salva el LED! ═══════════════════════ */

const n2 = { rounds: [], idx: 0, fails: [], roundFails: 0, tried: new Set(), solved: false, ledState: 'off', chosen: null };

function startLevel2() {
  Object.assign(n2, { rounds: prepareLevel2(), idx: 0, fails: [], roundFails: 0, tried: new Set(), solved: false, ledState: 'off', chosen: null, lastResult: null });
  $('#n2-done').hidden = true;
  $('#n2-game').hidden = false;
  renderRound();
}

function renderRound() {
  const round = n2.rounds[n2.idx];
  $('#n2-round').textContent = t('n2.round', { n: n2.idx + 1, total: n2.rounds.length });
  $('#n2-battery').textContent = t('n2.battery', { v: round.battery });
  const dots = $('#n2-dots');
  dots.innerHTML = '';
  n2.rounds.forEach((_, k) => dots.append(el('span', { class: `dot ${k < n2.idx ? 'done' : k === n2.idx ? 'now' : ''}` })));

  const opts = $('#n2-options');
  opts.innerHTML = '';
  round.options.forEach(r => {
    const tried = n2.tried.has(r);
    const res = tried ? evaluateLed(round, r).result : null;
    opts.append(el('button', {
      type: 'button',
      class: `btn opt-btn ${res === 'burn' ? 'opt-burn' : res === 'dim' ? 'opt-dim' : res === 'optimal' ? 'opt-ok' : 'btn-stone'}`,
      disabled: n2.solved || res === 'burn' || res === 'dim',
      onclick: () => chooseResistor(r),
      html: `<span class="res-icon" aria-hidden="true"></span>${esc(ohms(r))}${res === 'burn' ? ' <span aria-hidden="true">💥</span>' : ''}`
    }));
  });
  drawLedCircuit(round);
  renderFeedback2();
  const next = $('#n2-next');
  next.hidden = !n2.solved;
  next.textContent = n2.idx === n2.rounds.length - 1 ? t('n2.finish') : t('n2.next');
}

function drawLedCircuit(round) {
  const svg = $('#n2-circuit');
  const state = n2.ledState;
  const r = n2.chosen;
  const i = r ? ledCurrent(round.battery, LED.vLed, r) : 0;
  const b = state === 'burnt' ? 0 : r ? ledBrightness(i) : 0;
  const ledColor = state === 'burnt' ? '#3a3a3a' : b > 0 ? `hsl(350 100% ${45 + b * 25}%)` : '#7a2b3a';
  const wire = state === 'burnt' || !r ? '#e07b39' : '#ffb366';
  svg.setAttribute('aria-label', t('n2.circuitAlt', {
    v: round.battery,
    state: t(`led.${state === 'burnt' ? 'burnt' : state === 'dim' ? 'dim' : state === 'on' ? 'on' : 'off'}`)
  }));
  svg.innerHTML = `
    <defs><radialGradient id="ledglow"><stop offset="0" stop-color="#ff8fa3"/><stop offset="1" stop-color="#ff4d6d" stop-opacity="0"/></radialGradient></defs>
    <rect width="340" height="200" fill="#1f2a44"/>
    <g fill="#2a3756">${Array.from({ length: 30 }, (_, k) => `<rect x="${(k % 10) * 34}" y="${Math.floor(k / 10) * 68 + 8}" width="17" height="17"/>`).join('')}</g>
    <path d="M50 40 H290 V160 H50 Z" stroke="${wire}" stroke-width="8" fill="none" shape-rendering="crispEdges"/>
    <g transform="translate(24 70)" shape-rendering="crispEdges">
      <rect width="52" height="60" fill="#3b3b3b" stroke="#111" stroke-width="3"/>
      <rect width="52" height="16" fill="#ff4d6d"/>
      <rect x="18" y="-8" width="16" height="8" fill="#bbb"/>
      <text x="26" y="44" text-anchor="middle" font-size="15" font-weight="800" fill="#ffd34d">${round.battery} V</text>
    </g>
    <g transform="translate(126 26)" shape-rendering="crispEdges">
      <rect width="88" height="28" fill="${r ? '#d9b382' : '#777'}" stroke="#111" stroke-width="3"/>
      ${r ? '<rect x="16" width="8" height="28" fill="#ffd34d"/><rect x="32" width="8" height="28" fill="#7f3fbf"/><rect x="48" width="8" height="28" fill="#8b4513"/><rect x="70" width="6" height="28" fill="#c9a227"/>' : ''}
      <text x="44" y="-6" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">${r ? esc(ohms(r)) : 'R = ?'}</text>
    </g>
    ${b > 0 ? `<circle cx="290" cy="100" r="${30 + b * 40}" fill="url(#ledglow)" opacity="${0.25 + b * 0.75}"/>` : ''}
    <g transform="translate(270 76)" shape-rendering="crispEdges" class="${state === 'burnt' ? 'shake' : ''}">
      <rect x="4" y="0" width="32" height="34" fill="${ledColor}" stroke="#111" stroke-width="3"/>
      <rect x="0" y="34" width="40" height="8" fill="${state === 'burnt' ? '#222' : '#c0c0c0'}" stroke="#111" stroke-width="2"/>
      <text x="20" y="62" text-anchor="middle" font-size="12" font-weight="800" fill="#fff">LED</text>
    </g>
    ${state === 'burnt' ? `
      <g class="${reducedMotion ? '' : 'spark'}" fill="#ffd34d" shape-rendering="crispEdges">
        <rect x="262" y="62" width="8" height="8"/><rect x="306" y="58" width="8" height="8"/><rect x="250" y="94" width="6" height="6"/>
        <rect x="316" y="92" width="6" height="6"/><rect x="284" y="46" width="8" height="8" fill="#ff7b00"/>
      </g>
      <g class="${reducedMotion ? '' : 'smoke'}" fill="#9a9a9a" opacity=".8"><rect x="282" y="30" width="10" height="10"/><rect x="292" y="18" width="8" height="8"/><rect x="276" y="10" width="6" height="6"/></g>` : ''}
    <text x="170" y="188" text-anchor="middle" font-size="14" font-weight="800" fill="${state === 'burnt' ? '#ff8fa3' : '#7ee08a'}">${r ? `I = ${esc(fmt(i * 1000, 1))} mA` : ''}</text>
  `;
}

function renderFeedback2() {
  const box = $('#n2-feedback');
  box.innerHTML = '';
  const res = n2.lastResult;
  if (!res) return;
  const round = n2.rounds[n2.idx];
  const r = n2.chosen;
  const i = ledCurrent(round.battery, LED.vLed, r);
  const params = {
    r: ohms(r), rohm: fmt(r, 0), v: round.battery, a: fmt(i, 4), ma: fmt(i * 1000, 1),
    rmin: fmt(minLedResistance(round.battery, LED.vLed, LED.iMax), 0), vr: fmt(round.battery - LED.vLed, 1)
  };
  const kvl = el('p', { class: 'calc calc-law', text: t('n2.kvl', params) });
  if (res === 'burn') {
    box.className = 'feedback bad';
    box.append(el('p', { text: t('n2.burn', params) }), kvl, el('p', { class: 'calc', text: t('n2.calcBurn', params) }), el('p', { text: t('n2.burnHint', params) }));
  } else if (res === 'dim') {
    box.className = 'feedback warn';
    box.append(el('p', { text: t('n2.dim', params) }), kvl, el('p', { class: 'calc', text: t('n2.calc', params) }));
  } else {
    box.className = 'feedback ok';
    box.append(el('p', { text: t('n2.ok', params) }), kvl, el('p', { class: 'calc', text: t('n2.calc', params) }));
  }
}

function chooseResistor(r) {
  if (n2.solved) return;
  const round = n2.rounds[n2.idx];
  const { result } = evaluateLed(round, r);
  n2.chosen = r;
  n2.tried.add(r);
  n2.lastResult = result;
  if (result === 'burn') { n2.ledState = 'burnt'; n2.roundFails += 1; }
  if (result === 'dim') { n2.ledState = 'dim'; n2.roundFails += 1; }
  if (result === 'optimal') { n2.ledState = 'on'; n2.solved = true; }
  renderRound();
  if (n2.solved) $('#n2-next').focus();
  else $('#n2-feedback').focus?.();
}

$('#n2-next').addEventListener('click', () => {
  n2.fails.push(n2.roundFails);
  if (n2.idx === n2.rounds.length - 1) {
    $('#n2-game').hidden = true;
    finishLevel('n2', scoreLevel2(n2.fails), '#n2-done', t('n2.done'));
    return;
  }
  Object.assign(n2, { idx: n2.idx + 1, roundFails: 0, tried: new Set(), solved: false, ledState: 'off', chosen: null, lastResult: null });
  renderRound();
  $('#n2-options button')?.focus();
});

/* ═══════════════════════ Nivel 4 · Contrarreloj ═══════════════════════ */

const n3 = { running: false, q: null, score: 0, streak: 0, correct: 0, log: [], endAt: 0, timer: null };

function startLevel3() {
  stopTimer();
  $('#n3-ready').hidden = false;
  $('#n3-game').hidden = true;
  $('#n3-summary').hidden = true;
  screenCleanup.push(stopTimer);
}

function stopTimer() {
  clearInterval(n3.timer);
  n3.timer = null;
  n3.running = false;
}

$('#n3-start').addEventListener('click', () => {
  Object.assign(n3, { running: true, q: null, score: 0, streak: 0, correct: 0, log: [] });
  $('#n3-ready').hidden = true;
  $('#n3-summary').hidden = true;
  $('#n3-game').hidden = false;
  $('#n3-feedback').textContent = '';
  n3.endAt = performance.now() + LEVEL3.seconds * 1000;
  nextQuestion();
  updateHud();
  n3.timer = setInterval(updateHud, 200);
});

function unitText(u) { return u; }

function givenText(g) {
  return `${g.sym} = ${fmt(g.value, 3)} ${g.unit}`;
}

// Clave de texto para «Calcula …» y para el contexto (serie/paralelo)
const whatKey = q => (q.kind === 'kvl' ? 'V2' : q.kind === 'ohm' ? q.unknown : 'It');
const blockClass = sym => `g-${sym[0]}`;

function nextQuestion() {
  n3.q = generateQuestion(Math.random, n3.q);
  const q = n3.q;
  $('#n3-find').textContent = t('n3.find', { what: t(`n3.what.${whatKey(q)}`) });
  $('#n3-ctx').textContent = q.kind === 'ohm' ? '' : t(`n3.ctx.${q.kind}`);
  $('#n3-ctx').hidden = q.kind === 'ohm';
  const given = $('#n3-given');
  given.innerHTML = '';
  for (const g of q.given) {
    given.append(el('div', { class: `gblock ${blockClass(g.sym)}` }, [el('span', { class: 'sym', text: g.sym }), el('strong', { text: `${fmt(g.value, 3)} ${g.unit}` })]));
  }
  given.append(el('div', { class: `gblock ${blockClass(q.unknown)} unknown` }, [el('span', { class: 'sym', text: q.unknown }), el('strong', { text: `? ${q.unit}` })]));
  $('#n3-label').textContent = t('n3.answer', { unit: q.unit });
  $('#n3-unit').textContent = unitText(q.unit);
  const input = $('#n3-input');
  input.value = '';
  input.focus();
}

function updateHud() {
  const left = Math.max(0, (n3.endAt - performance.now()) / 1000);
  $('#n3-time').textContent = Math.ceil(left);
  $('#n3-score').textContent = n3.score;
  $('#n3-streak').textContent = n3.streak;
  $('#n3-bar').style.width = `${(left / LEVEL3.seconds) * 100}%`;
  $('#n3-bar').classList.toggle('hurry', left < 10);
  if (left <= 0 && n3.running) endLevel3();
}

$('#n3-form').addEventListener('submit', e => {
  e.preventDefault();
  if (!n3.running) return;
  const raw = $('#n3-input').value;
  const value = parseUserNumber(raw);
  const fb = $('#n3-feedback');
  if (Number.isNaN(value)) {
    fb.textContent = t('n3.nan');
    fb.className = 'feedback warn';
    return;
  }
  const q = n3.q;
  const ok = withinTolerance(value, q.answer, LEVEL3.tolerance);
  if (ok) {
    n3.streak += 1;
    n3.correct += 1;
    n3.score += answerPoints(n3.streak);
    fb.textContent = n3.streak >= 3 ? `${t('n3.ok')} ${t('n3.bonus', { n: n3.streak })}` : t('n3.ok');
    fb.className = 'feedback ok pop';
  } else {
    n3.streak = 0;
    fb.textContent = t('n3.no', { answer: fmt(q.answer, 3), unit: q.unit });
    fb.className = 'feedback bad shake-x';
  }
  n3.log.push({ q, value, ok });
  updateHud();
  nextQuestion();
});

$('#n3-skip').addEventListener('click', () => {
  if (!n3.running) return;
  n3.streak = 0;
  n3.log.push({ q: n3.q, value: null, ok: false });
  $('#n3-feedback').textContent = '';
  nextQuestion();
});

// ── Calculadora del nivel 3 ──
function updateCalc() {
  const value = evaluateExpression($('#n3-calc-in').value);
  const out = $('#n3-calc-out');
  if (!$('#n3-calc-in').value.trim()) out.textContent = '=';
  else out.textContent = Number.isNaN(value) ? t('n3.calcErr') : `= ${fmt(value, 4)}`;
  return value;
}
$('#n3-calc-in').addEventListener('input', updateCalc);
$('#n3-calc-in').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('#n3-calc-use').click(); }
});
document.querySelectorAll('#n3-calc-box [data-key]').forEach(b => b.addEventListener('click', () => {
  const input = $('#n3-calc-in');
  input.value = b.dataset.key === 'C' ? '' : input.value + b.dataset.key;
  updateCalc();
  input.focus();
}));
$('#n3-calc-use').addEventListener('click', () => {
  const value = updateCalc();
  if (Number.isNaN(value)) return;
  $('#n3-input').value = fmt(value, 4);
  $('#n3-input').focus();
});

function solutionText(q) {
  const d = Object.fromEntries(q.given.map(g => [g.sym, toSI(g)]));
  const f = (x, dig = 3) => fmt(x, dig);
  const parts = [];
  for (const g of q.given) {
    if (g.unit === 'mA') parts.push(`${g.sym} = ${f(g.value)} mA = ${f(g.value / 1000, 6)} A`);
    if (g.unit === 'kΩ') parts.push(`${g.sym} = ${f(g.value)} kΩ = ${f(g.value * 1000)} Ω`);
  }
  const ans = solveQuestion(q);
  if (q.kind === 'ohm') {
    if (q.unknown === 'I') {
      const iA = d.V / d.R;
      let main = `I = V / R = ${f(d.V)} V / ${f(d.R)} Ω = ${f(iA, 6)} A`;
      if (q.unit === 'mA') main += ` = ${f(ans)} mA`;
      parts.push(main);
    } else if (q.unknown === 'V') parts.push(`V = I · R = ${f(d.I, 6)} A · ${f(d.R)} Ω = ${f(ans)} V`);
    else parts.push(`R = V / I = ${f(d.V)} V / ${f(d.I, 6)} A = ${f(ans)} Ω`);
  } else if (q.kind === 'series') {
    const rt = d['R₁'] + d['R₂'];
    parts.push(`R total = R₁ + R₂ = ${f(d['R₁'])} Ω + ${f(d['R₂'])} Ω = ${f(rt)} Ω`, `I = V / R total = ${f(d.V)} V / ${f(rt)} Ω = ${f(ans)} A`);
  } else if (q.kind === 'kvl') {
    parts.push(`V₁ + V₂ = V → V₂ = V − V₁ = ${f(d.V)} V − ${f(d['V₁'])} V = ${f(ans)} V`);
  } else if (q.kind === 'kcl') {
    parts.push(`I = I₁ + I₂ = ${f(d['I₁'])} A + ${f(d['I₂'])} A = ${f(ans)} A`);
  } else if (q.kind === 'parallel') {
    const i1 = d.V / d['R₁'];
    const i2 = d.V / d['R₂'];
    parts.push(`I₁ = V / R₁ = ${f(i1)} A`, `I₂ = V / R₂ = ${f(i2)} A`, `I = I₁ + I₂ = ${f(ans)} A`);
  }
  return parts.join(' → ');
}

function endLevel3() {
  stopTimer();
  $('#n3-game').hidden = true;
  const total = n3.log.length;
  const stars = starsLevel3(n3.correct);
  const box = $('#n3-summary');
  box.hidden = false;
  box.innerHTML = '';
  box.append(
    el('p', { class: 'pixel done-title', text: t('n3.over') }),
    el('p', { text: t('n3.result', { ok: n3.correct, total, points: n3.score }) }),
    el('p', { class: 'done-stars', html: starsHtml(stars) + `<span class="sr-only">${esc(t('n3.stars', { stars }))}</span>` })
  );
  if (stars === 0) box.append(el('p', { class: 'feedback warn', text: t('n3.needMore', { n: LEVEL3.starThresholds[0] }) }));

  const mistakes = n3.log.filter(x => !x.ok);
  box.append(el('h2', { class: 'pixel h-panel', text: t('n3.mistakes') }));
  if (!mistakes.length) box.append(el('p', { text: t('n3.noMistakes') }));
  else {
    const list = el('ol', { class: 'mistakes' });
    mistakes.forEach(({ q, value }) => {
      const given = q.given.map(givenText).join(' · ');
      const ctx = q.kind === 'ohm' ? '' : `${t(`n3.ctx.${q.kind}`)}: `;
      list.append(el('li', {}, [
        el('p', { class: 'm-q', text: `${ctx}${given} → ${t('n3.find', { what: t(`n3.what.${whatKey(q)}`) })} (${q.unit})` }),
        el('p', { class: 'm-yours', text: value === null ? t('n3.skipped') : t('n3.yours', { value: `${fmt(value, 4)} ${q.unit}` }) }),
        el('p', { class: 'calc', text: solutionText(q) })
      ]));
    });
    box.append(list);
  }
  box.append(el('div', { class: 'map-actions' }, [
    el('button', { type: 'button', class: 'btn btn-gold', text: t('n3.again'), onclick: () => $('#n3-start').click() })
  ]));
  if (stars > 0) {
    const doneBox = el('div', { id: 'n3-done' });
    box.prepend(doneBox);
    finishLevel('n3', { hits: n3.correct, total, points: n3.score, stars }, '#n3-done', t('n3.done'));
  } else {
    box.querySelector('button').focus();
  }
}

/* ═══════════════════════ Ayuda: triángulo de Ohm ═══════════════════════ */

function drawTriangle(cover) {
  const svg = $('#ohm-triangle');
  const formula = { V: 'V = I · R', I: 'I = V / R', R: 'R = V / I' };
  const covered = sym => cover === sym;
  const letter = (sym, x, y, color) => covered(sym)
    ? `<rect x="${x - 26}" y="${y - 30}" width="52" height="52" fill="#8b5a2b" stroke="#3d2610" stroke-width="4"/><rect x="${x - 26}" y="${y - 30}" width="52" height="12" fill="#5fbf3a"/>`
    : `<text x="${x}" y="${y + 12}" text-anchor="middle" font-size="40" font-weight="900" fill="${color}">${sym}</text>`;
  svg.innerHTML = `
    <polygon points="120,10 230,200 10,200" fill="#fff6d6" stroke="#1d1b2f" stroke-width="6" stroke-linejoin="round"/>
    <line x1="60" y1="115" x2="180" y2="115" stroke="#1d1b2f" stroke-width="5"/>
    <line x1="120" y1="115" x2="120" y2="200" stroke="#1d1b2f" stroke-width="5"/>
    ${letter('V', 120, 72, '#d6336c')}
    ${letter('I', 78, 158, '#1c7ed6')}
    ${letter('R', 162, 158, '#2b8a3e')}
    <text x="120" y="160" text-anchor="middle" font-size="22" font-weight="900" fill="#1d1b2f">${cover === 'V' ? '·' : ''}</text>
  `;
  $('#triangle-result').textContent = cover ? formula[cover] : '';
}

$('#help-btn').addEventListener('click', () => {
  drawTriangle(null);
  const dlg = $('#help-dialog');
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
});
$$('[data-cover]').forEach(b => b.addEventListener('click', () => drawTriangle(b.dataset.cover)));

/* ═══════════════════════ Idioma y arranque ═══════════════════════ */

$('#lang-btn').addEventListener('click', () => {
  const lang = getLang() === 'es' ? 'ca' : 'es';
  setLang(lang);
  store.update(s => { s.lang = lang; });
  // Volvemos a pintar la pantalla actual sin perder el estado del nivel 1 y 2
  renderChrome();
  if (currentScreen === 'mapa') renderMap();
  if (currentScreen === 'n1') { updateLevel1(); renderChallengeList(L1); }
  if (currentScreen === 'nc') { renderCircuitModes(); updateCircuits(); renderChallengeList(LC); }
  if (currentScreen === 'n2') renderRound();
  if (currentScreen === 'n3' && n3.running && n3.q) {
    $('#n3-find').textContent = t('n3.find', { what: t(`n3.what.${whatKey(n3.q)}`) });
    $('#n3-ctx').textContent = n3.q.kind === 'ohm' ? '' : t(`n3.ctx.${n3.q.kind}`);
    $('#n3-label').textContent = t('n3.answer', { unit: n3.q.unit });
  }
});

$('#logo').addEventListener('click', e => { e.preventDefault(); go(store.state.profile ? 'mapa' : 'inicio'); });
$$('.back').forEach(b => b.addEventListener('click', () => go('mapa')));
window.addEventListener('hashchange', route);
route();
