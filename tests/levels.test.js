import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom, nearlyEqual, current } from '../js/physics.js';
import {
  LEVEL1, LEVEL2_ROUNDS, LED, isTargetCurrent, totalResistance, power, isTargetPower, checkHalfCurrent, canHalveFrom, scoreLevel1,
  evaluateLed, validOptions, optimalResistance, validateRound, prepareLevel2, scoreLevel2,
  generateQuestion, isConsistent, starsLevel3, answerPoints, isUnlocked, allDone
} from '../js/levels.js';

test('Nivel 1 · reto de 0,5 A alcanzable con los deslizadores', () => {
  assert.ok(isTargetCurrent(5, 10));
  assert.ok(isTargetCurrent(12, 24));
  assert.ok(!isTargetCurrent(9, 30));
  // Existe al menos una combinación con los pasos de los deslizadores
  let found = 0;
  for (let v = LEVEL1.voltage.min; v <= LEVEL1.voltage.max; v += LEVEL1.voltage.step) {
    for (let r = LEVEL1.resistance.min; r <= LEVEL1.resistance.max; r += LEVEL1.resistance.step) {
      if (isTargetCurrent(v, r)) found++;
    }
  }
  assert.ok(found >= 10);
});

test('Nivel 1 · mitad de corriente sin tocar la tensión', () => {
  const start = { v: 9, r: 30 };
  assert.equal(checkHalfCurrent(start, 9, 60), 'ok');
  assert.equal(checkHalfCurrent(start, 9, 45), 'not-yet');
  assert.equal(checkHalfCurrent(start, 4.5, 30), 'voltage-changed');
  assert.ok(canHalveFrom(50));
  assert.ok(!canHalveFrom(51));
});

test('Nivel 1 · la respuesta de opción múltiple es «se duplica»', () => {
  assert.equal(LEVEL1.quizAnswer, 'double');
  assert.ok(LEVEL1.quizOptions.includes('double'));
  assert.deepEqual(scoreLevel1(0), { hits: 5, total: 5, points: 500, stars: 3 });
  assert.equal(scoreLevel1(1).stars, 2);
  assert.equal(scoreLevel1(3, 2).stars, 1);
  assert.equal(scoreLevel1(3, 2).hits, 3);
});

test('Nivel 1 · serie, paralelo y potencia', () => {
  assert.equal(totalResistance(30, 'single'), 30);
  assert.equal(totalResistance(30, 'series'), 60);
  assert.equal(totalResistance(30, 'parallel'), 15);
  // En paralelo circula más corriente que en serie (misma tensión)
  assert.ok(current(9, totalResistance(30, 'parallel')) > current(9, totalResistance(30, 'series')));
  assert.equal(LEVEL1.quiz2Answer, 'parallel');
  assert.ok(nearlyEqual(power(9, 0.3), 2.7));
  assert.ok(isTargetPower(6, 6));
  assert.ok(isTargetPower(12, 24));
  assert.ok(!isTargetPower(9, 30));
  // 6 W se puede conseguir con los deslizadores en cualquiera de los montajes
  for (const mode of LEVEL1.modes) {
    let found = false;
    for (let v = LEVEL1.voltage.min; v <= LEVEL1.voltage.max; v += LEVEL1.voltage.step) {
      for (let r = LEVEL1.resistance.min; r <= LEVEL1.resistance.max; r += LEVEL1.resistance.step) {
        if (isTargetPower(v, totalResistance(r, mode))) found = true;
      }
    }
    assert.ok(found, mode);
  }
});

test('Nivel 2 · cada ronda tiene exactamente una respuesta óptima', () => {
  assert.equal(LEVEL2_ROUNDS.length, 5);
  for (const round of LEVEL2_ROUNDS) {
    assert.deepEqual(validateRound(round), [], `ronda ${round.id}`);
    const results = round.options.map(r => evaluateLed(round, r).result);
    assert.equal(results.filter(x => x === 'optimal').length, 1, `ronda ${round.id}: una sola óptima`);
    assert.ok(results.includes('burn'), `ronda ${round.id}: alguna opción quema el LED`);
    const best = optimalResistance(round);
    // La óptima protege el LED y la siguiente más pequeña no
    assert.ok((round.battery - LED.vLed) / best <= LED.iMax);
    const smaller = round.options.filter(r => r < best);
    for (const r of smaller) assert.ok((round.battery - LED.vLed) / r > LED.iMax);
  }
});

test('Nivel 2 · óptimas calculadas a mano', () => {
  const expected = { r1: 470, r2: 180, r3: 560, r4: 390, r5: 680 };
  for (const round of LEVEL2_ROUNDS) assert.equal(optimalResistance(round), expected[round.id]);
  // Pregunta del itinerario: 9 V, opciones 100/220/470/1k → 470 Ω
  const itinerary = { battery: 9, options: [100, 220, 470, 1000] };
  assert.equal(optimalResistance(itinerary), 470);
  assert.equal(evaluateLed(itinerary, 220).result, 'burn');
  assert.equal(evaluateLed(itinerary, 1000).result, 'dim');
  assert.deepEqual(validOptions(itinerary).sort((a, b) => a - b), [470, 1000]);
});

test('Nivel 2 · validateRound detecta rondas mal hechas', () => {
  assert.ok(validateRound({ battery: 9, options: [470, 1000, 2200, 4700] }).length > 0); // nada quema
  assert.ok(validateRound({ battery: 9, options: [10, 22, 47, 100] }).length > 0); // nada protege
  assert.ok(validateRound({ battery: 7, options: [100, 220, 470, 1000] }).length > 0);
  assert.ok(validateRound({ battery: 9, options: [100, 220, 450, 1000] }).length > 0); // 450 no es E12
});

test('Nivel 2 · barajar no cambia la óptima ni pierde rondas', () => {
  const rounds = prepareLevel2(seededRandom(42));
  assert.equal(rounds.length, 5);
  assert.deepEqual(rounds.map(r => r.id).sort(), ['r1', 'r2', 'r3', 'r4', 'r5']);
  for (const r of rounds) {
    const original = LEVEL2_ROUNDS.find(x => x.id === r.id);
    assert.equal(optimalResistance(r), optimalResistance(original));
  }
  assert.deepEqual(scoreLevel2([0, 0, 0, 0, 0]), { hits: 5, total: 5, points: 500, stars: 3 });
  assert.deepEqual(scoreLevel2([1, 0, 2, 0, 0]), { hits: 3, total: 5, points: 390, stars: 2 });
});

test('Nivel 3 · 2000 preguntas aleatorias coherentes con V = I · R', () => {
  const rand = seededRandom(2026);
  const kinds = new Set();
  let prev = null;
  for (let k = 0; k < 2000; k++) {
    const q = generateQuestion(rand, prev);
    assert.ok(isConsistent(q), JSON.stringify(q));
    assert.ok(Number.isFinite(q.answer) && q.answer > 0);
    assert.ok(['V', 'I', 'R'].includes(q.unknown));
    assert.equal(Object.keys(q.given).length, 2);
    assert.ok(!(q.unknown in q.given));
    // Valores de nivel ESO
    const vSI = q.si.V;
    assert.ok(vSI > 0 && vSI <= 230, `tensión ${vSI}`);
    kinds.add(`${q.unknown}-${q.unit}-${Object.values(q.given).map(g => g.unit).join(',')}`);
    prev = q;
  }
  // Aparecen conversiones de mA y kΩ
  assert.ok([...kinds].some(k => k.includes('mA')));
  assert.ok([...kinds].some(k => k.includes('kΩ')));
  assert.ok(kinds.size >= 6);
});

test('Nivel 3 · números redondos (poco cálculo mental)', () => {
  const rand = seededRandom(7);
  for (let k = 0; k < 2000; k++) {
    const q = generateQuestion(rand);
    for (const g of Object.values(q.given)) {
      assert.ok(Number.isInteger(g.value * 2), `dato poco redondo: ${g.value} ${g.unit}`);
    }
    assert.ok(Number.isInteger(q.answer * 2), `respuesta poco redonda: ${q.answer} ${q.unit}`);
  }
});

test('Nivel 3 · puntuación y estrellas', () => {
  assert.equal(answerPoints(1), 10);
  assert.equal(answerPoints(3), 15);
  assert.equal(starsLevel3(2), 0);
  assert.equal(starsLevel3(3), 1);
  assert.equal(starsLevel3(6), 2);
  assert.equal(starsLevel3(9), 3);
});

test('Desbloqueo de niveles', () => {
  assert.ok(isUnlocked({}, 'n1'));
  assert.ok(!isUnlocked({}, 'n2'));
  assert.ok(isUnlocked({ n1: { done: true } }, 'n2'));
  assert.ok(!isUnlocked({ n1: { done: true } }, 'n3'));
  assert.ok(allDone({ n1: { done: true }, n2: { done: true }, n3: { done: true } }));
  assert.ok(!allDone({ n1: { done: true }, n2: { done: true } }));
});
