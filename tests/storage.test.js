import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, sanitize, recordLevel, emptyState, STORAGE_KEY } from '../js/storage.js';

function memoryBackend() {
  const data = new Map();
  return {
    data,
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k)
  };
}

test('Guarda y recupera bajo la clave ohmlab:v1', () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  assert.equal(store.persistent, true);
  store.update(s => { s.profile = { name: 'Laia Puig', group: '3B', school: '' }; });
  assert.ok(backend.data.has(STORAGE_KEY));
  const again = createStore(backend);
  assert.equal(again.state.profile.name, 'Laia Puig');
});

test('Sin localStorage sigue funcionando en memoria', () => {
  const broken = {
    getItem() { throw new Error('bloqueado'); },
    setItem() { throw new Error('bloqueado'); },
    removeItem() { throw new Error('bloqueado'); }
  };
  const store = createStore(broken);
  store.update(s => { s.lang = 'ca'; });
  assert.equal(store.state.lang, 'ca');
  assert.equal(store.persistent, false);
  assert.doesNotThrow(() => store.clear());
});

test('Borrar mis datos', () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  store.update(s => { s.lang = 'ca'; s.profile = { name: 'A B', group: 'C', school: '' }; });
  store.clear();
  assert.equal(store.state.profile, null);
  assert.equal(store.state.lang, 'ca'); // se mantiene el idioma elegido
});

test('Datos corruptos o de otra versión', () => {
  assert.deepEqual(sanitize(null), emptyState());
  assert.deepEqual(sanitize({ version: 2 }), emptyState());
  const backend = memoryBackend();
  backend.setItem(STORAGE_KEY, '{no es json');
  assert.deepEqual(createStore(backend).state, emptyState());
});

test('Se guarda la mejor puntuación de cada nivel', () => {
  const s = emptyState();
  recordLevel(s, 'n3', { hits: 3, total: 5, points: 30, stars: 1 }, new Date('2026-11-05T10:00:00Z'));
  recordLevel(s, 'n3', { hits: 2, total: 4, points: 20, stars: 1 }, new Date('2026-11-05T11:00:00Z'));
  assert.equal(s.progress.n3.points, 30);
  recordLevel(s, 'n3', { hits: 7, total: 8, points: 85, stars: 3 }, new Date('2026-11-05T12:00:00Z'));
  assert.equal(s.progress.n3.points, 85);
  assert.equal(s.progress.n3.completedAt, '2026-11-05T10:00:00.000Z');
});
