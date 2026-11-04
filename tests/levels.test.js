import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom, nearlyEqual, current } from '../js/physics.js';
import {
  LEVEL1, LEVEL2_ROUNDS, LED, CIRCUITS, isTargetCurrent, power, isTargetPower, checkHalfCurrent, canHalveFrom,
  scoreLevel1, scoreCircuits, seriesCircuit, parallelCircuit, solveCircuit, isDoubleVoltage, isTargetTotalCurrent,
  evaluateLed, validOptions, optimalResistance, validateRound, prepareLevel2, scoreLevel2,
  generateQuestion, isConsistent, solveQuestion, starsLevel3, answerPoints, isUnlocked, allDone, LEVEL_IDS
} from '../js/levels.js';

const range = ({ min, max, step }) => {
  const out = [];
  for (let x = min; x <= max + 1e-9; x += step) out.push(Math.round(x * 1000) / 1000);
  return out;
};

test('Nivel 1 · reto de 0,5 A alcanzable con los deslizadores', () => {
  assert.ok(isTargetCurrent(5, 10));
  assert.ok(!isTargetCurrent(9, 30));
  let found = 0;
  for (const v of range(LEVEL1.voltage)) for (const r of range(LEVEL1.resistance)) if (isTargetCurrent(v, r)) found++;
  assert.ok(found >= 10);
  // El estado inicial no resuelve ningún reto por sí solo
  assert.ok(!isTargetCurrent(LEVEL1.voltage.initial, LEVEL1.resistance.initial));
  assert.ok(!isTargetPower(LEVEL1.voltage.initial, LEVEL1.resistance.initial));
});

test('Nivel 1 · mitad de corriente sin tocar la tensión', () => {
  const start = { v: 9, r: 30 };
  assert.equal(checkHalfCurrent(start, 9, 60), 'ok');
  assert.equal(checkHalfCurrent(start, 9, 45), 'not-yet');
  assert.equal(checkHalfCurrent(start, 4.5, 30), 'voltage-changed');
  assert.ok(canHalveFrom(50));
  assert.ok(!canHalveFrom(51));
});

test('Nivel 1 · opción múltiple, potencia y puntuación', () => {
  assert.equal(LEVEL1.quizAnswer, 'double');
  assert.ok(nearlyEqual(power(9, 0.3), 2.7));
  assert.ok(isTargetPower(6, 6));
  assert.ok(isTargetPower(12, 24));
  let found = false;
  for (const v of range(LEVEL1.voltage)) for (const r of range(LEVEL1.resistance)) if (isTargetPower(v, r)) found = true;
  assert.ok(found);
  assert.deepEqual(scoreLevel1(0, 0), { hits: 4, total: 4, points: 400, stars: 3 });
  assert.equal(scoreLevel1(1, 1).stars, 2);
  assert.equal(scoreLevel1(3, 1).stars, 1);
});

test('Nivel 2 · serie: misma intensidad y V1 + V2 = V (la tensión se reparte)', () => {
  const c = seriesCircuit(12, 40, 20);
  assert.equal(c.Rt, 60);
  assert.ok(nearlyEqual(c.I, 0.2));
  assert.ok(nearlyEqual(c.items[0].I, c.items[1].I));
  assert.ok(nearlyEqual(c.items[0].V, 8));
  assert.ok(nearlyEqual(c.items[1].V, 4));
  for (const v of range(CIRCUITS.voltage)) for (const r1 of range(CIRCUITS.r1)) for (const r2 of [5, 35, 100]) {
    const s = seriesCircuit(v, r1, r2);
    assert.ok(nearlyEqual(s.items[0].V + s.items[1].V, v));
  }
});

test('Nivel 2 · paralelo: misma tensión e I = I1 + I2 (la intensidad total es la suma de las ramas)', () => {
  const c = parallelCircuit(12, 40, 20);
  assert.ok(nearlyEqual(c.items[0].I, 0.3));
  assert.ok(nearlyEqual(c.items[1].I, 0.6));
  assert.ok(nearlyEqual(c.I, 0.9));
  assert.ok(nearlyEqual(c.Rt, 40 * 20 / 60));
  assert.ok(nearlyEqual(c.items[0].V, 12) && nearlyEqual(c.items[1].V, 12));
  // Ley de Ohm con la resistencia equivalente
  assert.ok(nearlyEqual(current(12, c.Rt), c.I));
});

test('Nivel 2 · dos bombillas iguales brillan más en paralelo', () => {
  const s = seriesCircuit(12, 40, 40);
  const p = parallelCircuit(12, 40, 40);
  assert.ok(nearlyEqual(p.items[0].P, 4 * s.items[0].P));
  assert.equal(CIRCUITS.brightAnswer, 'parallel');
  assert.equal(CIRCUITS.kvlAnswer, 'v3');
});

test('Nivel 2 · los retos son alcanzables y el estado inicial no los resuelve', () => {
  const { voltage, r1, r2 } = CIRCUITS;
  assert.ok(!isDoubleVoltage(solveCircuit('series', voltage.initial, r1.initial, r2.initial)));
  assert.ok(!isTargetTotalCurrent(solveCircuit('parallel', voltage.initial, r1.initial, r2.initial)));
  let d = 0;
  let t = 0;
  for (const v of range(voltage)) for (const a of range(r1)) for (const b of range(r2)) {
    if (isDoubleVoltage(solveCircuit('series', v, a, b))) d++;
    if (isTargetTotalCurrent(solveCircuit('parallel', v, a, b))) t++;
  }
  assert.ok(d > 10, 'doble tensión en serie');
  assert.ok(t > 5, '1 A en paralelo');
  assert.ok(!isDoubleVoltage(solveCircuit('parallel', 12, 40, 20)), 'el reto 1 exige serie');
  assert.deepEqual(scoreCircuits(0, 0), { hits: 4, total: 4, points: 400, stars: 3 });
});

test('Nivel 3 (LED) · cada ronda tiene exactamente una respuesta óptima', () => {
  assert.equal(LEVEL2_ROUNDS.length, 5);
  for (const round of LEVEL2_ROUNDS) {
    assert.deepEqual(validateRound(round), [], `ronda ${round.id}`);
    const results = round.options.map(r => evaluateLed(round, r).result);
    assert.equal(results.filter(x => x === 'optimal').length, 1, `ronda ${round.id}: una sola óptima`);
    assert.ok(results.includes('burn'), `ronda ${round.id}: alguna opción quema el LED`);
    const best = optimalResistance(round);
    assert.ok((round.battery - LED.vLed) / best <= LED.iMax);
    for (const r of round.options.filter(x => x < best)) assert.ok((round.battery - LED.vLed) / r > LED.iMax);
  }
});

test('Nivel 3 (LED) · óptimas calculadas a mano', () => {
  const expected = { r1: 470, r2: 180, r3: 560, r4: 390, r5: 680 };
  for (const round of LEVEL2_ROUNDS) assert.equal(optimalResistance(round), expected[round.id]);
  const itinerary = { battery: 9, options: [100, 220, 470, 1000] };
  assert.equal(optimalResistance(itinerary), 470);
  assert.equal(evaluateLed(itinerary, 220).result, 'burn');
  assert.equal(evaluateLed(itinerary, 1000).result, 'dim');
  assert.deepEqual(validOptions(itinerary).sort((a, b) => a - b), [470, 1000]);
});

test('Nivel 3 (LED) · validateRound detecta rondas mal hechas', () => {
  assert.ok(validateRound({ battery: 9, options: [470, 1000, 2200, 4700] }).length > 0);
  assert.ok(validateRound({ battery: 9, options: [10, 22, 47, 100] }).length > 0);
  assert.ok(validateRound({ battery: 7, options: [100, 220, 470, 1000] }).length > 0);
  assert.ok(validateRound({ battery: 9, options: [100, 220, 450, 1000] }).length > 0);
});

test('Nivel 3 (LED) · barajar no cambia la óptima ni pierde rondas', () => {
  const rounds = prepareLevel2(seededRandom(42));
  assert.deepEqual(rounds.map(r => r.id).sort(), ['r1', 'r2', 'r3', 'r4', 'r5']);
  for (const r of rounds) assert.equal(optimalResistance(r), optimalResistance(LEVEL2_ROUNDS.find(x => x.id === r.id)));
  assert.deepEqual(scoreLevel2([0, 0, 0, 0, 0]), { hits: 5, total: 5, points: 500, stars: 3 });
  assert.deepEqual(scoreLevel2([1, 0, 2, 0, 0]), { hits: 3, total: 5, points: 390, stars: 2 });
});

test('Nivel 4 · 3000 preguntas coherentes, de todos los tipos y con números redondos', () => {
  const rand = seededRandom(2026);
  const kinds = new Map();
  let prev = null;
  for (let k = 0; k < 3000; k++) {
    const q = generateQuestion(rand, prev);
    assert.ok(isConsistent(q), JSON.stringify(q));
    assert.ok(q.answer > 0);
    assert.ok(!q.given.some(x => x.sym === q.unknown), 'la incógnita no está entre los datos');
    for (const x of q.given) assert.ok(Number.isInteger(x.value * 2), `dato poco redondo: ${x.value}`);
    assert.ok(Number.isInteger(q.answer * 2), `respuesta poco redonda: ${q.answer}`);
    kinds.set(q.kind, (kinds.get(q.kind) || 0) + 1);
    prev = q;
  }
  for (const kind of ['ohm', 'series', 'kvl', 'kcl', 'parallel']) assert.ok(kinds.get(kind) > 100, kind);
  // La mayoría siguen siendo de Ley de Ohm
  assert.ok(kinds.get('ohm') > 3000 * 0.45);
});

test('Nivel 4 · soluciones a mano', () => {
  const q = (kind, unknown, unit, given) => ({ kind, unknown, unit, given: given.map(([sym, value, u]) => ({ sym, value, unit: u })) });
  assert.equal(solveQuestion(q('ohm', 'I', 'A', [['V', 9, 'V'], ['R', 3, 'Ω']])), 3);
  assert.equal(solveQuestion(q('ohm', 'I', 'mA', [['V', 10, 'V'], ['R', 2, 'kΩ']])), 5);
  assert.equal(solveQuestion(q('series', 'I', 'A', [['V', 12, 'V'], ['R₁', 4, 'Ω'], ['R₂', 2, 'Ω']])), 2);
  assert.equal(solveQuestion(q('kvl', 'V₂', 'V', [['V', 9, 'V'], ['V₁', 6, 'V']])), 3);
  assert.equal(solveQuestion(q('kcl', 'I', 'A', [['I₁', 1.5, 'A'], ['I₂', 2.5, 'A']])), 4);
  assert.equal(solveQuestion(q('parallel', 'I', 'A', [['V', 12, 'V'], ['R₁', 4, 'Ω'], ['R₂', 6, 'Ω']])), 5);
});

test('Nivel 4 · puntuación y estrellas', () => {
  assert.equal(answerPoints(1), 10);
  assert.equal(answerPoints(3), 15);
  assert.equal(starsLevel3(2), 0);
  assert.equal(starsLevel3(3), 1);
  assert.equal(starsLevel3(6), 2);
  assert.equal(starsLevel3(9), 3);
});

test('Orden y desbloqueo de los cuatro niveles', () => {
  assert.deepEqual(LEVEL_IDS, ['n1', 'nc', 'n2', 'n3']);
  assert.ok(isUnlocked({}, 'n1'));
  assert.ok(!isUnlocked({}, 'nc'));
  assert.ok(isUnlocked({ n1: { done: true } }, 'nc'));
  assert.ok(!isUnlocked({ n1: { done: true } }, 'n2'));
  assert.ok(isUnlocked({ n1: { done: true }, nc: { done: true } }, 'n2'));
  const all = { n1: { done: true }, nc: { done: true }, n2: { done: true }, n3: { done: true } };
  assert.ok(allDone(all));
  assert.ok(!allDone({ ...all, nc: undefined }));
});

test('Ningún texto de la app nombra a Kirchhoff ni usa fórmulas fuera del nivel de 3.º ESO', async () => {
  const { STRINGS } = await import('../js/i18n.js');
  for (const lang of ['es', 'ca']) {
    for (const [key, text] of Object.entries(STRINGS[lang])) {
      assert.ok(!/kirch/i.test(text), `${lang}.${key} nombra a Kirchhoff`);
      assert.ok(!/malla|nudo|\bnus\b|nusos|malles/i.test(text), `${lang}.${key} usa mallas o nudos`);
      assert.ok(!text.includes('R₁ · R₂'), `${lang}.${key} usa la fórmula de la resistencia en paralelo`);
    }
  }
});
