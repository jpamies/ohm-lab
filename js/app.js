// Ohm Lab · aplicación principal
import { CLAVE_SECRETA, IDIOMA_POR_DEFECTO } from './config.js';
import { t, setLang, getLang, applyTranslations } from './i18n.js';
import { createStore, recordLevel } from './storage.js';
import {
  current, formatNumber, formatOhms, parseUserNumber, withinTolerance, ledCurrent, minLedResistance, evaluateExpression
} from './physics.js';
import {
  LEVEL1, LED, LEVEL3, LEVEL_IDS, isTargetCurrent, checkHalfCurrent, canHalveFrom, scoreLevel1,
  totalResistance, power, isTargetPower,
  prepareLevel2, evaluateLed, validateRound, ledBrightness, roundPoints, scoreLevel2,
  generateQuestion, answerPoints, starsLevel3, isUnlocked, allDone, LEVEL2_ROUNDS
} from './levels.js';
import {
  signCertificate, isoSeconds, verifyUrl, buildDiplomaPdf, drawBadge, normalizeField
} from './certificate.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const SVG = 'http://www.w3.org/2000/svg';
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
  const id = { inicio: 'start', mapa: 'map', n1: 'n1', n2: 'n2', n3: 'n3', editar: 'start' }[target] || 'map';
  $$('.screen').forEach(s => { s.hidden = s.id !== `screen-${id}`; });
  currentScreen = target;
  renderChrome();
  if (id === 'start') renderStart(target === 'editar');
  if (id === 'map') renderMap();
  if (id === 'n1') startLevel1();
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
      el('div', { class: 'lc-icon', 'aria-hidden': 'true', text: ['💧', '💡', '⏱'][k] }),
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

/* ═══════════════════════ Nivel 1 · El agua y la corriente ═══════════════════════ */

const n1 = {};
let animFrame = null;

function resetLevel1State() {
  Object.assign(n1, {
    v: LEVEL1.voltage.initial, r: LEVEL1.resistance.initial, mode: 'single', step: 0, start: null,
    mistakes: 0, failedQuizzes: new Set(), visited: new Set(), message: '', feedbackClass: '', doneMsgs: [], speed: 0.1
  });
}
resetLevel1State();

const rTotal = () => totalResistance(n1.r, n1.mode);

function brightness(i) {
  return Math.max(0, Math.min(1, Math.sqrt(i / 3)));
}

function glowWord(b) {
  if (b < 0.12) return t('glow.off');
  if (b < 0.4) return t('glow.low');
  if (b < 0.75) return t('glow.mid');
  return t('glow.high');
}

function startLevel1() {
  resetLevel1State();
  $('#n1-done').hidden = true;
  const vIn = $('#n1-v');
  const rIn = $('#n1-r');
  Object.assign(vIn, { min: LEVEL1.voltage.min, max: LEVEL1.voltage.max, step: LEVEL1.voltage.step, value: n1.v });
  Object.assign(rIn, { min: LEVEL1.resistance.min, max: LEVEL1.resistance.max, step: LEVEL1.resistance.step, value: n1.r });
  buildCircuitSvg();
  buildWaterSvg();
  renderModes();
  updateLevel1();
  renderChallenges();

  let last = performance.now();
  const tick = now => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    animateLevel1(dt);
    animFrame = requestAnimationFrame(tick);
  };
  if (!reducedMotion) animFrame = requestAnimationFrame(tick);
  screenCleanup.push(() => cancelAnimationFrame(animFrame));
}

function onSlider() {
  n1.v = Number($('#n1-v').value);
  n1.r = Number($('#n1-r').value);
  updateLevel1();
  checkChallenges();
}
$('#n1-v').addEventListener('input', onSlider);
$('#n1-r').addEventListener('input', onSlider);

// ── Selector de montaje (se desbloquea en el reto 4) ──
function renderModes() {
  const box = $('#n1-modes');
  const unlocked = n1.step >= 3;
  box.hidden = !unlocked;
  if (!unlocked) return;
  box.innerHTML = '';
  box.append(el('p', { class: 'modes-label', id: 'n1-modes-label', text: t('n1.mode') }));
  const group = el('div', { class: 'modes', role: 'radiogroup', 'aria-labelledby': 'n1-modes-label' });
  LEVEL1.modes.forEach(mode => {
    const on = n1.mode === mode;
    group.append(el('button', {
      type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false',
      class: `btn btn-small mode-btn ${on ? 'btn-gold' : 'btn-stone'}`,
      html: `<span class="mode-icon mode-${mode}" aria-hidden="true"></span>${esc(t(`n1.mode.${mode}`))}`,
      onclick: () => setMode(mode)
    }));
  });
  box.append(group);
}

function setMode(mode) {
  n1.mode = mode;
  if (mode !== 'single') n1.visited.add(mode);
  buildCircuitSvg();
  renderModes();
  updateLevel1();
  if (n1.step === 3) renderChallenges();
  checkChallenges();
  const btn = document.querySelector('#n1-modes .mode-btn[aria-checked="true"]');
  if (btn) btn.focus();
}

// ── SVG del circuito ──
const CIRCUIT_LOOP = [[40, 40], [280, 40], [280, 180], [40, 180]];
// En paralelo, la mitad de los electrones baja por la rama de la resistencia de abajo
const BRANCH_LOOP = [[40, 40], [104, 40], [104, 104], [216, 104], [216, 40], [280, 40], [280, 180], [40, 180]];
let circuitDots = [];
let waterDots = [];
let wheelAngle = 0;
let phase = 0;

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function resistorSvg(x, y, w, labelId, labelY = -6) {
  return `
    <g transform="translate(${x} ${y})" shape-rendering="crispEdges">
      <rect width="${w}" height="28" fill="#d9b382" stroke="#111" stroke-width="3"/>
      <rect x="${w * 0.17}" y="0" width="7" height="28" fill="#8b4513"/>
      <rect x="${w * 0.36}" y="0" width="7" height="28" fill="#111"/>
      <rect x="${w * 0.55}" y="0" width="7" height="28" fill="#ff4d6d"/>
      <rect x="${w * 0.78}" y="0" width="5" height="28" fill="#ffd34d"/>
      <text x="${w / 2}" y="${labelY}" text-anchor="middle" font-size="13" font-weight="800" fill="#fff" class="c-rtext">30 Ω</text>
    </g>`;
}

function buildCircuitSvg() {
  const svg = $('#n1-circuit');
  let resistors = '';
  let extraWires = '';
  if (n1.mode === 'series') {
    resistors = resistorSvg(84, 26, 70) + resistorSvg(178, 26, 70);
  } else if (n1.mode === 'parallel') {
    extraWires = '<path d="M104 40 V104 H216 V40" stroke="#e07b39" stroke-width="8" fill="none" shape-rendering="crispEdges"/>';
    resistors = resistorSvg(125, 26, 70) + resistorSvg(125, 90, 70, null, 46);
  } else {
    resistors = resistorSvg(118, 26, 84);
  }
  svg.innerHTML = `
    <defs>
      <radialGradient id="glow"><stop offset="0" stop-color="#fff7b0"/><stop offset=".5" stop-color="#ffd34d" stop-opacity=".7"/><stop offset="1" stop-color="#ffd34d" stop-opacity="0"/></radialGradient>
    </defs>
    <rect x="0" y="0" width="320" height="220" fill="#1f2a44"/>
    <g fill="#2a3756">${Array.from({ length: 40 }, (_, k) => `<rect x="${(k % 10) * 32}" y="${Math.floor(k / 10) * 55}" width="16" height="16"/>`).join('')}</g>
    <g stroke="#e07b39" stroke-width="8" fill="none" shape-rendering="crispEdges">
      <path d="M40 40 H280 V180 H40 Z"/>
    </g>
    ${extraWires}
    <!-- Pila -->
    <g transform="translate(16 82)" shape-rendering="crispEdges">
      <rect width="48" height="56" fill="#3b3b3b" stroke="#111" stroke-width="3"/>
      <rect x="0" y="0" width="48" height="16" fill="#ff4d6d"/>
      <rect x="16" y="-8" width="16" height="8" fill="#bbb"/>
      <text x="24" y="12" text-anchor="middle" font-size="12" font-weight="800" fill="#fff">+</text>
      <text x="24" y="44" text-anchor="middle" font-size="13" font-weight="800" fill="#ffd34d" id="c-vtext">9 V</text>
    </g>
    ${resistors}
    <g id="c-dots"></g>
    <!-- Bombilla -->
    <circle id="c-glow" cx="280" cy="110" r="60" fill="url(#glow)" opacity=".5"/>
    <g transform="translate(256 82)" shape-rendering="crispEdges">
      <rect x="4" y="0" width="40" height="36" fill="#fff6c9" stroke="#111" stroke-width="3" id="c-bulb"/>
      <rect x="12" y="10" width="24" height="4" fill="#9a7b00"/>
      <rect x="12" y="36" width="24" height="18" fill="#9aa0a6" stroke="#111" stroke-width="3"/>
    </g>
    <text x="160" y="206" text-anchor="middle" font-size="15" font-weight="800" fill="#7ee08a" id="c-itext">I = 0,3 A</text>
  `;
  circuitDots = Array.from({ length: 14 }, (_, k) => ({ s: k / 14, branch: n1.mode === 'parallel' && k % 2 === 1 }));
  const g = svg.querySelector('#c-dots');
  circuitDots.forEach(d => { d.node = svgEl('rect', { width: 8, height: 8, fill: '#7ee08a' }); g.append(d.node); });
}

function pointOnLoop(points, s) {
  const segs = [];
  let total = 0;
  for (let k = 0; k < points.length; k++) {
    const a = points[k];
    const b = points[(k + 1) % points.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, len });
    total += len;
  }
  let d = ((s % 1) + 1) % 1 * total;
  for (const seg of segs) {
    if (d <= seg.len) {
      const f = d / seg.len;
      return [seg.a[0] + (seg.b[0] - seg.a[0]) * f, seg.a[1] + (seg.b[1] - seg.a[1]) * f];
    }
    d -= seg.len;
  }
  return points[0];
}

// ── SVG de la analogía hidráulica ──
function pipeWidth(r) {
  return 4 + 24 * (1 - Math.log10(r) / 2);
}

// Tramos estrechos de la tubería según el montaje
function narrowSections() {
  if (n1.mode === 'series') return [[112, 46], [196, 46]];
  return [[150, 60]];
}

function buildWaterSvg() {
  const svg = $('#n1-water');
  svg.innerHTML = `
    <rect x="0" y="0" width="320" height="220" fill="#8fd3ff"/>
    <g fill="#fff" shape-rendering="crispEdges"><rect x="200" y="18" width="48" height="12"/><rect x="212" y="10" width="24" height="8"/><rect x="40" y="10" width="32" height="8"/></g>
    <g shape-rendering="crispEdges">
      <rect x="0" y="196" width="320" height="8" fill="#5fbf3a"/>
      <rect x="0" y="204" width="320" height="16" fill="#8b5a2b"/>
      ${Array.from({ length: 20 }, (_, k) => `<rect x="${k * 16 + (k % 3) * 3}" y="${208 + (k % 2) * 6}" width="4" height="4" fill="#6e4320"/>`).join('')}
    </g>
    <!-- Torre del depósito -->
    <g shape-rendering="crispEdges">
      <rect x="18" y="40" width="72" height="156" fill="#9e9e9e" stroke="#555" stroke-width="3"/>
      ${Array.from({ length: 9 }, (_, k) => `<rect x="${k % 2 ? 22 : 54}" y="${46 + k * 16}" width="30" height="12" fill="#b5b5b5"/>`).join('')}
      <rect id="w-water" x="21" y="100" width="66" height="93" fill="#2f80ff" opacity=".9"/>
      <rect id="w-surface" x="21" y="100" width="66" height="4" fill="#9fd0ff"/>
    </g>
    <text x="54" y="34" text-anchor="middle" font-size="11" font-weight="800" fill="#1d1b2f" id="w-vtext">9 V</text>
    <!-- Tubería -->
    <rect x="90" y="166" width="190" height="30" fill="#6b6b6b" shape-rendering="crispEdges"/>
    <rect id="w-pipe" x="90" y="170" width="190" height="22" fill="#2f80ff" shape-rendering="crispEdges"/>
    <g id="w-narrows"></g>
    <!-- Tubería paralela (solo en el montaje en paralelo) -->
    <g id="w-parallel" shape-rendering="crispEdges">
      <rect x="130" y="128" width="100" height="30" fill="#6b6b6b"/>
      <rect x="130" y="132" width="100" height="22" fill="#2f80ff"/>
      <rect x="130" y="128" width="8" height="38" fill="#6b6b6b"/>
      <rect x="222" y="128" width="8" height="38" fill="#6b6b6b"/>
      <g id="w-narrows-2"></g>
    </g>
    <text x="180" y="124" text-anchor="middle" font-size="11" font-weight="800" fill="#1d1b2f" id="w-rtext">30 Ω</text>
    <g id="w-dots"></g>
    <!-- Rueda hidráulica -->
    <g id="w-wheel" transform="translate(284 150)">
      <circle r="26" fill="none" stroke="#7a4a1f" stroke-width="6"/>
      ${Array.from({ length: 8 }, (_, k) => `<rect x="-3" y="-30" width="6" height="14" fill="#a8672e" transform="rotate(${k * 45})"/>`).join('')}
      <rect x="-4" y="-4" width="8" height="8" fill="#333"/>
    </g>
    <text x="250" y="214" font-size="10" font-weight="800" fill="#fff" id="w-itext"></text>
    <g font-size="10" font-weight="700" fill="#1d1b2f">
      <text x="100" y="52" id="w-l1"></text>
      <text x="100" y="66" id="w-l2"></text>
      <text x="100" y="80" id="w-l3"></text>
    </g>
  `;
  waterDots = Array.from({ length: 16 }, (_, k) => ({ s: k / 16 }));
  const g = svg.querySelector('#w-dots');
  waterDots.forEach(d => { d.node = svgEl('rect', { width: 6, height: 6, fill: '#e6f4ff' }); g.append(d.node); });
}

function narrowRects(sections, yTop, pw) {
  const block = Math.max(0, (22 - pw) / 2 + 4);
  return sections.map(([x, w]) => `
    <rect x="${x}" y="${yTop}" width="${w}" height="${block.toFixed(1)}" fill="#e07b39" stroke="#7a3d12" stroke-width="2"/>
    <rect x="${x}" y="${(yTop + 30 - block).toFixed(1)}" width="${w}" height="${block.toFixed(1)}" fill="#e07b39" stroke="#7a3d12" stroke-width="2"/>`).join('');
}

function updateLevel1() {
  const { v, r, mode } = n1;
  const rt = rTotal();
  const i = current(v, rt);
  const p = power(v, i);
  const b = brightness(i);
  $('#n1-v-out').textContent = `${fmt(v, 1)} V`;
  $('#n1-r-out').textContent = `${fmt(r, 0)} Ω`;
  $('#n1-v').setAttribute('aria-valuetext', `${fmt(v, 1)} V`);
  $('#n1-r').setAttribute('aria-valuetext', `${fmt(r, 0)} Ω`);
  const params = { v: fmt(v, 1), r: fmt(r, 0), rt: fmt(rt, 1), i: fmt(i, 3), p: fmt(p, 2) };
  $('#n1-calc').textContent = mode === 'single' ? t('n1.calc', params) : t(`n1.calc.${mode}`, params);
  $('#n1-power').textContent = t('n1.power', params);

  // Circuito
  const c = $('#n1-circuit');
  c.setAttribute('aria-label', t('n1.circuitAlt', { v: params.v, r: params.rt, i: params.i, glow: glowWord(b) }));
  c.querySelector('#c-vtext').textContent = `${fmt(v, 1)} V`;
  c.querySelectorAll('.c-rtext').forEach(n => { n.textContent = `${fmt(r, 0)} Ω`; });
  c.querySelector('#c-itext').textContent = `I = ${fmt(i, 2)} A · P = ${fmt(p, 1)} W`;
  c.querySelector('#c-glow').setAttribute('opacity', (0.05 + b * 0.95).toFixed(2));
  c.querySelector('#c-glow').setAttribute('r', (30 + b * 50).toFixed(0));
  c.querySelector('#c-bulb').setAttribute('fill', b > 0.1 ? `hsl(52 100% ${55 + b * 35}%)` : '#d8d4c0');

  // Agua
  const w = $('#n1-water');
  w.setAttribute('aria-label', t('n1.waterAlt', { v: params.v, r: params.rt, i: params.i }));
  const top = 193 - (v / LEVEL1.voltage.max) * 148;
  w.querySelector('#w-water').setAttribute('y', top.toFixed(1));
  w.querySelector('#w-water').setAttribute('height', (193 - top).toFixed(1));
  w.querySelector('#w-surface').setAttribute('y', top.toFixed(1));
  w.querySelector('#w-vtext').textContent = `${fmt(v, 1)} V`;
  w.querySelector('#w-rtext').textContent = mode === 'single' ? `${fmt(r, 0)} Ω` : `${t(`n1.mode.${mode}`)}: ${fmt(rt, 1)} Ω`;
  const pw = pipeWidth(r);
  w.querySelector('#w-narrows').innerHTML = narrowRects(narrowSections(), 166, pw);
  w.querySelector('#w-parallel').style.display = mode === 'parallel' ? '' : 'none';
  w.querySelector('#w-narrows-2').innerHTML = mode === 'parallel' ? narrowRects([[150, 60]], 128, pw) : '';
  w.querySelector('#w-itext').textContent = `${fmt(i, 2)} A`;
  w.querySelector('#w-l1').textContent = `▲ ${t('n1.tank')}`;
  w.querySelector('#w-l2').textContent = `▬ ${t('n1.pipe')}`;
  w.querySelector('#w-l3').textContent = `➜ ${t('n1.flow')}`;
  n1.speed = 0.02 + 0.6 * Math.sqrt(Math.min(i, 24) / 12);
  if (reducedMotion) animateLevel1(0);
}

function animateLevel1(dt) {
  phase += dt * n1.speed;
  circuitDots.forEach(d => {
    const [x, y] = pointOnLoop(d.branch ? BRANCH_LOOP : CIRCUIT_LOOP, d.s + phase);
    d.node.setAttribute('x', (x - 4).toFixed(1));
    d.node.setAttribute('y', (y - 4).toFixed(1));
  });
  const pw = pipeWidth(n1.r);
  const sections = narrowSections();
  waterDots.forEach((d, k) => {
    const s = ((d.s + phase * 2) % 1 + 1) % 1;
    const x = 92 + s * 186;
    const inNarrow = sections.some(([a, w]) => x > a && x < a + w);
    const spread = inNarrow ? pw / 2 - 3 : 8;
    const y = 181 + (k % 3 - 1) * Math.max(0, spread);
    d.node.setAttribute('x', x.toFixed(1));
    d.node.setAttribute('y', (y - 3).toFixed(1));
  });
  wheelAngle = (wheelAngle + dt * n1.speed * 720) % 360;
  const wheel = document.querySelector('#w-wheel');
  if (wheel) wheel.setAttribute('transform', `translate(284 150) rotate(${wheelAngle.toFixed(1)})`);
}

// ── Retos ──
function renderChallenges() {
  const list = $('#n1-challenges');
  list.innerHTML = '';
  for (let k = 0; k < LEVEL1.challenges; k++) {
    const state = k < n1.step ? 'done' : k === n1.step ? 'active' : 'locked';
    const li = el('li', { class: `challenge ${state}` });
    li.append(
      el('div', { class: 'ch-head' }, [
        el('span', { class: 'ch-icon', 'aria-hidden': 'true', text: state === 'done' ? '✔' : state === 'active' ? '▶' : '🔒' }),
        el('p', { class: 'ch-title', text: t(`n1.c${k + 1}`) }),
        el('span', { class: 'ch-state', text: t(`challenge.${state === 'done' ? 'done' : state === 'active' ? 'pending' : 'locked'}`) })
      ])
    );
    if (state === 'active') li.append(challengeBody(k));
    if (state === 'done' && n1.doneMsgs[k]) li.append(el('p', { class: 'ch-msg ok', text: n1.doneMsgs[k] }));
    list.append(li);
  }
}

function quizGroup(label, options, prefix, onAnswer) {
  const group = el('div', { class: 'quiz', role: 'group', 'aria-label': label });
  options.forEach((opt, idx) => {
    group.append(el('button', {
      type: 'button', class: 'btn btn-stone quiz-opt', 'data-opt': opt,
      text: `${'abcd'[idx]}) ${t(`${prefix}.${opt}`)}`,
      onclick: e => onAnswer(opt, e.currentTarget)
    }));
  });
  return group;
}

function challengeBody(k) {
  const body = el('div', { class: 'ch-body' });
  if (k === 0) {
    body.append(el('p', { class: 'muted', text: t('n1.c1.hint') }));
  }
  if (k === 1) {
    body.append(el('button', {
      type: 'button', class: 'btn btn-gold', text: t('n1.c2.start'),
      onclick: () => {
        if (!canHalveFrom(n1.r)) {
          n1.start = null;
          setChallengeMsg(t('n1.c2.tooBig', { r: fmt(n1.r, 0) }), 'warn');
          return;
        }
        n1.start = { v: n1.v, r: n1.r };
        const i0 = current(n1.v, n1.r);
        setChallengeMsg(t('n1.c2.started', { v: fmt(n1.v, 1), i: fmt(i0, 3), half: fmt(i0 / 2, 3) }), 'info');
      }
    }));
  }
  if (k === 2) {
    body.append(quizGroup(t('n1.c3'), LEVEL1.quizOptions, 'n1.c3', (opt, btn) => answerQuiz(2, opt, btn)));
  }
  if (k === 3) {
    body.append(el('p', { class: 'muted', text: t('n1.c4.hint') }));
    const s = n1.visited.has('series');
    const p = n1.visited.has('parallel');
    body.append(el('p', { class: 'tried', text: t('n1.c4.tried', { s: s ? '✔' : '✘', p: p ? '✔' : '✘' }) }));
    if (s && p) body.append(quizGroup(t('n1.c4'), LEVEL1.quiz2Options, 'n1.c4', (opt, btn) => answerQuiz(3, opt, btn)));
  }
  if (k === 4) {
    body.append(el('p', { class: 'muted', text: t('n1.c5.hint') }));
  }
  body.append(el('p', { class: `ch-msg ${n1.feedbackClass}`, id: 'n1-msg', 'aria-live': 'polite', text: n1.message }));
  return body;
}

function setChallengeMsg(text, cls) {
  n1.message = text;
  n1.feedbackClass = cls;
  const p = $('#n1-msg');
  if (p) { p.textContent = text; p.className = `ch-msg ${cls}`; }
}

function completeChallenge(k, msg) {
  n1.doneMsgs[k] = msg;
  n1.step = k + 1;
  n1.message = '';
  n1.feedbackClass = '';
  renderChallenges();
  renderModes();
  if (n1.step === 3) toast(`🔓 ${t('n1.modesUnlocked')}`);
  if (n1.step === LEVEL1.challenges) {
    finishLevel('n1', scoreLevel1(n1.mistakes, n1.failedQuizzes.size), '#n1-done', t('n1.done'));
  }
}

function checkChallenges() {
  const rt = rTotal();
  if (n1.step === 0 && isTargetCurrent(n1.v, rt)) {
    completeChallenge(0, t('n1.c1.ok', { v: fmt(n1.v, 1), r: fmt(rt, 0) }));
    return;
  }
  if (n1.step === 1 && n1.start) {
    const res = checkHalfCurrent(n1.start, n1.v, rt);
    if (res === 'voltage-changed') setChallengeMsg(t('n1.c2.voltage', { v: fmt(n1.start.v, 1) }), 'warn');
    else if (res === 'ok') completeChallenge(1, t('n1.c2.ok', { r0: fmt(n1.start.r, 0), r: fmt(rt, 0) }));
    else if (n1.feedbackClass === 'warn') {
      const i0 = current(n1.start.v, n1.start.r);
      setChallengeMsg(t('n1.c2.started', { v: fmt(n1.start.v, 1), i: fmt(i0, 3), half: fmt(i0 / 2, 3) }), 'info');
    }
  }
  if (n1.step === 4 && isTargetPower(n1.v, rt)) {
    completeChallenge(4, t('n1.c5.ok', { v: fmt(n1.v, 1), i: fmt(current(n1.v, rt), 2) }));
  }
}

function answerQuiz(k, opt, button) {
  const correct = k === 2 ? LEVEL1.quizAnswer : LEVEL1.quiz2Answer;
  const prefix = k === 2 ? 'n1.c3' : 'n1.c4';
  if (opt === correct) {
    completeChallenge(k, t(`${prefix}.ok`));
    return;
  }
  n1.mistakes += 1;
  n1.failedQuizzes.add(k);
  button.disabled = true;
  button.classList.add('wrong');
  button.textContent = `✘ ${button.textContent}`;
  setChallengeMsg(t(`${prefix}.no.${opt}`), 'bad');
}

/* ═══════════════════════ Nivel 2 · ¡Salva el LED! ═══════════════════════ */

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
    rmin: fmt(minLedResistance(round.battery, LED.vLed, LED.iMax), 0)
  };
  if (res === 'burn') {
    box.className = 'feedback bad';
    box.append(el('p', { text: t('n2.burn', params) }), el('p', { class: 'calc', text: t('n2.calcBurn', params) }), el('p', { text: t('n2.burnHint', params) }));
  } else if (res === 'dim') {
    box.className = 'feedback warn';
    box.append(el('p', { text: t('n2.dim', params) }), el('p', { class: 'calc', text: t('n2.calc', params) }));
  } else {
    box.className = 'feedback ok';
    box.append(el('p', { text: t('n2.ok', params) }), el('p', { class: 'calc', text: t('n2.calc', params) }));
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

/* ═══════════════════════ Nivel 3 · Contrarreloj ═══════════════════════ */

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

function givenText(sym, g) {
  return `${sym} = ${fmt(g.value, 3)} ${g.unit}`;
}

function nextQuestion() {
  n3.q = generateQuestion(Math.random, n3.q);
  const q = n3.q;
  $('#n3-find').textContent = t('n3.find', { what: t(`n3.what.${q.unknown}`) });
  const given = $('#n3-given');
  given.innerHTML = '';
  for (const [sym, g] of Object.entries(q.given)) {
    given.append(el('div', { class: `gblock g-${sym}` }, [el('span', { class: 'pixel', text: sym }), el('strong', { text: `${fmt(g.value, 3)} ${g.unit}` })]));
  }
  given.append(el('div', { class: `gblock g-${q.unknown} unknown` }, [el('span', { class: 'pixel', text: q.unknown }), el('strong', { text: `? ${q.unit}` })]));
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
  const parts = [];
  const si = q.si;
  for (const [sym, g] of Object.entries(q.given)) {
    if (g.unit === 'mA') parts.push(`${sym} = ${fmt(g.value, 3)} mA = ${fmt(g.value / 1000, 6)} A`);
    if (g.unit === 'kΩ') parts.push(`${sym} = ${fmt(g.value, 3)} kΩ = ${fmt(g.value * 1000, 3)} Ω`);
  }
  let main;
  if (q.unknown === 'I') {
    main = `I = V / R = ${fmt(si.V, 3)} V / ${fmt(si.R, 3)} Ω = ${fmt(si.I, 6)} A`;
    if (q.unit === 'mA') main += ` = ${fmt(si.I * 1000, 3)} mA`;
  } else if (q.unknown === 'V') {
    main = `V = I · R = ${fmt(si.I, 6)} A · ${fmt(si.R, 3)} Ω = ${fmt(si.V, 3)} V`;
  } else {
    main = `R = V / I = ${fmt(si.V, 3)} V / ${fmt(si.I, 6)} A = ${fmt(si.R, 3)} Ω`;
  }
  return [...parts, main].join(' → ');
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
      const given = Object.entries(q.given).map(([s, g]) => givenText(s, g)).join(' · ');
      list.append(el('li', {}, [
        el('p', { class: 'm-q', text: `${given} → ${t('n3.find', { what: t(`n3.what.${q.unknown}`) })} (${q.unit})` }),
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
  if (currentScreen === 'n1') { renderModes(); updateLevel1(); renderChallenges(); }
  if (currentScreen === 'n2') renderRound();
  if (currentScreen === 'n3' && n3.running && n3.q) {
    $('#n3-find').textContent = t('n3.find', { what: t(`n3.what.${n3.q.unknown}`) });
    $('#n3-label').textContent = t('n3.answer', { unit: n3.q.unit });
  }
});

$('#logo').addEventListener('click', e => { e.preventDefault(); go(store.state.profile ? 'mapa' : 'inicio'); });
$$('.back').forEach(b => b.addEventListener('click', () => go('mapa')));
window.addEventListener('hashchange', route);
route();
