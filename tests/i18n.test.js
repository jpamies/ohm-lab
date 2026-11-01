import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, t } from '../js/i18n.js';

test('Castellano y catalán tienen las mismas claves', () => {
  const es = Object.keys(STRINGS.es).sort();
  const ca = Object.keys(STRINGS.ca).sort();
  assert.deepEqual(ca, es);
});

test('Los parámetros coinciden en los dos idiomas', () => {
  const params = s => (typeof s === 'string' ? (s.match(/\{\w+\}/g) || []).sort() : []);
  for (const key of Object.keys(STRINGS.es)) {
    assert.deepEqual(params(STRINGS.ca[key]), params(STRINGS.es[key]), key);
  }
});

test('Sustitución de parámetros', () => {
  assert.equal(t('n1.calc', { v: '9', r: '30', i: '0,3' }, 'es'), 'I = V / R = 9 V / 30 Ω = 0,3 A');
  assert.equal(t('map.hello', { name: 'Laia' }, 'ca'), 'Hola, Laia!');
});

test('El pie de créditos es el acordado', () => {
  assert.equal(STRINGS.es.footer, 'Ohm Lab · Diseño didáctico: Jordi Pàmies · Desarrollado con asistencia de IA (Claude, Anthropic) · 2026 · Contenido CC BY 4.0');
});
