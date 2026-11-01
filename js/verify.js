// Ohm Lab · página de verificación de diplomas (todo se calcula en el dispositivo)
import { CLAVE_SECRETA, IDIOMA_POR_DEFECTO } from './config.js';
import { t, setLang, getLang, applyTranslations } from './i18n.js';
import { createStore } from './storage.js';
import { decodePayload, verifyCertificate, normalizeField } from './certificate.js';

const $ = sel => document.querySelector(sel);
const store = createStore();
setLang(store.state.lang || IDIOMA_POR_DEFECTO);

let lastCheck = null;

function render() {
  applyTranslations();
  $('#lang-btn').textContent = t('lang.switch');
  if (lastCheck) showResult(lastCheck.data, lastCheck.result);
}

function fillForm(data, code) {
  $('#v-name').value = data.name;
  $('#v-group').value = data.group;
  $('#v-school').value = data.school;
  $('#v-date').value = data.date;
  $('#v-p1').value = data.points[0];
  $('#v-p2').value = data.points[1];
  $('#v-p3').value = data.points[2];
  $('#v-code').value = code;
}

function showResult(data, result) {
  lastCheck = { data, result };
  $('#result-panel').hidden = false;
  const out = $('#verify-result');
  out.textContent = result.valid ? t('verify.valid') : t('verify.invalid');
  out.className = `verify-result ${result.valid ? 'ok' : 'bad'}`;
  $('#verify-help').textContent = result.valid ? '' : t('verify.invalidHelp');
  const rows = [
    [t('verify.name'), normalizeField(data.name)],
    [t('verify.group'), normalizeField(data.group)],
    [t('verify.school'), normalizeField(data.school) || '—'],
    [t('verify.date'), formatDate(data.date)],
    [t('verify.p1'), data.points[0]],
    [t('verify.p2'), data.points[1]],
    [t('verify.p3'), data.points[2]],
    [t('verify.total'), data.points.reduce((a, b) => a + b, 0)],
    [t('verify.code'), result.given || '—']
  ];
  const body = $('#verify-data');
  body.innerHTML = '';
  for (const [k, v] of rows) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    const td = document.createElement('td');
    th.textContent = k;
    td.textContent = String(v);
    tr.append(th, td);
    body.append(tr);
  }
  $('#result-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const locale = getLang() === 'ca' ? 'ca-ES' : 'es-ES';
  return `${d.toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' })} (${iso})`;
}

async function check(data, code) {
  const result = await verifyCertificate(data, code, CLAVE_SECRETA);
  showResult(data, result);
}

async function loadFromText(text) {
  const payload = decodePayload(text);
  if (!payload) {
    $('#link-error').textContent = t('verify.badLink');
    return false;
  }
  $('#link-error').textContent = '';
  fillForm(payload.data, payload.code);
  await check(payload.data, payload.code);
  return true;
}

$('#link-form').addEventListener('submit', e => {
  e.preventDefault();
  loadFromText($('#v-link').value);
});

$('#manual-form').addEventListener('submit', e => {
  e.preventDefault();
  const num = id => Math.round(Number(String($(id).value).replace(',', '.'))) || 0;
  const data = {
    name: $('#v-name').value,
    group: $('#v-group').value,
    school: $('#v-school').value,
    date: $('#v-date').value.trim(),
    points: [num('#v-p1'), num('#v-p2'), num('#v-p3')]
  };
  check(data, $('#v-code').value);
});

$('#lang-btn').addEventListener('click', () => {
  const lang = getLang() === 'es' ? 'ca' : 'es';
  setLang(lang);
  store.update(s => { s.lang = lang; });
  render();
});

render();
if (location.hash.length > 3) loadFromText(location.hash);
window.addEventListener('hashchange', () => loadFromText(location.hash));
