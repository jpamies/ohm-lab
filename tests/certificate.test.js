import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  normalizeField, canonicalString, signCertificate, verifyCertificate, normalizeCode,
  encodePayload, decodePayload, verifyUrl, toBase32, BASE32_ALPHABET, isoSeconds
} from '../js/certificate.js';

const KEY = 'clave-de-prueba';
const sample = {
  name: '  laia   puig ',
  group: '3.º b',
  school: 'Institut Joan Oró',
  date: '2026-11-05T10:23:45Z',
  points: [300, 460, 85]
};

test('Normalización de campos', () => {
  assert.equal(normalizeField('  laia   puig '), 'LAIA PUIG');
  assert.equal(normalizeField('Núria Ça|ls'), 'NÚRIA ÇA LS');
  assert.equal(normalizeField(undefined), '');
});

test('Cadena canónica con el formato pedido', () => {
  assert.equal(
    canonicalString(sample),
    'v1|LAIA PUIG|3.º B|INSTITUT JOAN ORÓ|2026-11-05T10:23:45Z|n1:300|n2:460|n3:85'
  );
});

test('Fecha ISO sin milisegundos', () => {
  assert.equal(isoSeconds('2026-11-05T10:23:45.678Z'), '2026-11-05T10:23:45Z');
});

test('Base32 sin caracteres ambiguos', () => {
  assert.equal(BASE32_ALPHABET.length, 32);
  assert.equal(new Set(BASE32_ALPHABET).size, 32);
  for (const ch of 'IO01') assert.ok(!BASE32_ALPHABET.includes(ch));
  assert.equal(toBase32(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]), 12), 'AAAAAAAAAAAA');
  assert.equal(toBase32(new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]), 12), '999999999999');
});

test('La firma es SHA-256(CLAVE|cadena) en base32 y formato OHM-XXXX-XXXX-XXXX', async () => {
  const code = await signCertificate(sample, KEY);
  assert.match(code, /^OHM-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  // Comprobación independiente con el módulo crypto de Node
  const digest = createHash('sha256').update(`${KEY}|${canonicalString(sample)}`, 'utf8').digest();
  const raw = toBase32(new Uint8Array(digest), 12);
  assert.equal(code, `OHM-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`);
  // Determinista
  assert.equal(await signCertificate(sample, KEY), code);
});

test('Verificación: válido, datos cambiados, clave distinta', async () => {
  const code = await signCertificate(sample, KEY);
  assert.equal((await verifyCertificate(sample, code, KEY)).valid, true);
  // Escrito a mano en minúsculas y sin guiones
  assert.equal((await verifyCertificate(sample, code.toLowerCase().replace(/-/g, ' '), KEY)).valid, true);
  // Mayúsculas/espacios del nombre no importan
  assert.equal((await verifyCertificate({ ...sample, name: 'LAIA PUIG' }, code, KEY)).valid, true);
  // Una letra cambiada → no coincide
  assert.equal((await verifyCertificate({ ...sample, name: 'Laia Puix' }, code, KEY)).valid, false);
  assert.equal((await verifyCertificate({ ...sample, points: [300, 460, 86] }, code, KEY)).valid, false);
  assert.equal((await verifyCertificate({ ...sample, date: '2026-11-05T10:23:46Z' }, code, KEY)).valid, false);
  assert.equal((await verifyCertificate(sample, code, 'otra-clave')).valid, false);
  assert.equal((await verifyCertificate(sample, 'OHM-AAAA-AAAA', KEY)).valid, false);
});

test('normalizeCode', () => {
  assert.equal(normalizeCode('ohm 7k2q-9xpa m4td'), 'OHM-7K2Q-9XPA-M4TD');
  assert.equal(normalizeCode('7K2Q9XPAM4TD'), 'OHM-7K2Q-9XPA-M4TD');
  assert.equal(normalizeCode('OHM-7K2Q'), null);
});

test('Datos en el fragmento: ida y vuelta con acentos', async () => {
  const code = await signCertificate(sample, KEY);
  const url = verifyUrl('https://jpamies.github.io/ohm-lab/index.html#/mapa', sample, code);
  assert.ok(url.startsWith('https://jpamies.github.io/ohm-lab/verificar.html#d='));
  assert.ok(!url.includes('?'), 'los datos no van en la query (no viajan al servidor)');
  const back = decodePayload(new URL(url).hash);
  assert.equal(back.code, code);
  assert.deepEqual(back.data, sample);
  assert.equal((await verifyCertificate(back.data, back.code, KEY)).valid, true);
  assert.deepEqual(decodePayload(url), back);
  assert.deepEqual(decodePayload(encodePayload(sample, code)), back);
  assert.equal(decodePayload('#d=basura'), null);
  assert.equal(decodePayload(''), null);
});
