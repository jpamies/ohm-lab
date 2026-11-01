// Ohm Lab · datos y lógica de los tres niveles (sin DOM: se prueban con node --test)
import { current, ledCurrent, minLedResistance, nearlyEqual, isE12, shuffle } from './physics.js';

/* ───────────────────────── Nivel 1 · El agua y la corriente ───────────────────────── */

export const LEVEL1 = {
  voltage: { min: 1, max: 12, step: 0.5, initial: 9 },
  resistance: { min: 1, max: 100, step: 1, initial: 30 },
  targetCurrent: 0.5, // reto 1: «consigue exactamente 0,5 A»
  // Reto 3: opción múltiple. La correcta es «double».
  quizOptions: ['double', 'half', 'same', 'quadruple'],
  quizAnswer: 'double',
  // Reto 4: serie o paralelo. La correcta es «parallel».
  modes: ['single', 'series', 'parallel'],
  quiz2Options: ['series', 'parallel', 'same'],
  quiz2Answer: 'parallel',
  targetPower: 6, // reto 5: «consigue exactamente 6 W»
  challenges: 5
};

/** Resistencia total del montaje con dos resistencias iguales de valor r. */
export function totalResistance(r, mode = 'single') {
  if (mode === 'series') return 2 * r;      // Rt = R1 + R2
  if (mode === 'parallel') return r / 2;    // 1/Rt = 1/R1 + 1/R2
  return r;
}

/** Potencia eléctrica P = V · I (W). */
export function power(v, i) {
  return v * i;
}

/** Reto 1: ¿la corriente es exactamente la objetivo? */
export function isTargetCurrent(v, r, target = LEVEL1.targetCurrent) {
  return nearlyEqual(current(v, r), target);
}

/** Reto 5: ¿la potencia es exactamente la objetivo? (r = resistencia total) */
export function isTargetPower(v, r, target = LEVEL1.targetPower) {
  return nearlyEqual(power(v, current(v, r)), target);
}

/**
 * Reto 2: partiendo de (v0, r0), ¿se ha conseguido la mitad de corriente sin tocar la tensión?
 * Devuelve 'ok', 'voltage-changed' o 'not-yet'.
 */
export function checkHalfCurrent(start, v, r) {
  if (!nearlyEqual(v, start.v)) return 'voltage-changed';
  const i0 = current(start.v, start.r);
  return nearlyEqual(current(v, r), i0 / 2) ? 'ok' : 'not-yet';
}

/** Reto 2: con esta resistencia de partida, ¿se puede doblar sin pasar del máximo del deslizador? */
export function canHalveFrom(r0) {
  return r0 * 2 <= LEVEL1.resistance.max;
}

/**
 * Puntuación del nivel 1.
 * mistakes: errores totales en las preguntas de opción múltiple; failedQuizzes: preguntas con algún error.
 */
export function scoreLevel1(mistakes, failedQuizzes = Math.min(mistakes, 1)) {
  const total = LEVEL1.challenges;
  const points = total * 100 - Math.min(mistakes, 4) * 25;
  const stars = mistakes === 0 ? 3 : mistakes === 1 ? 2 : 1;
  return { hits: total - failedQuizzes, total, points, stars };
}

/* ───────────────────────── Nivel 2 · ¡Salva el LED! ───────────────────────── */

export const LED = { vLed: 2, iMax: 0.02 }; // 2 V y 20 mA

/**
 * Rondas fijas y comprobadas: la respuesta óptima es la resistencia válida más pequeña.
 * Rmin = (V − 2 V) / 0,02 A → 5 V: 150 Ω · 9 V: 350 Ω · 12 V: 500 Ω
 */
export const LEVEL2_ROUNDS = [
  { id: 'r1', battery: 9, options: [100, 220, 470, 1000] },        // óptima 470 Ω
  { id: 'r2', battery: 5, options: [68, 100, 180, 390, 1000] },    // óptima 180 Ω
  { id: 'r3', battery: 12, options: [220, 330, 560, 820, 1500] },  // óptima 560 Ω
  { id: 'r4', battery: 9, options: [150, 270, 390, 680] },         // óptima 390 Ω
  { id: 'r5', battery: 12, options: [100, 470, 680, 1200, 2200] }  // óptima 680 Ω
];

/** Valoración de una resistencia en una ronda: 'burn' | 'dim' | 'optimal'. */
export function evaluateLed(round, r) {
  const i = ledCurrent(round.battery, LED.vLed, r);
  if (i > LED.iMax + 1e-12) return { result: 'burn', current: i };
  return { result: r === optimalResistance(round) ? 'optimal' : 'dim', current: i };
}

/** Resistencias de la ronda que protegen el LED (I ≤ Imax). */
export function validOptions(round) {
  return round.options.filter(r => ledCurrent(round.battery, LED.vLed, r) <= LED.iMax + 1e-12);
}

/** La resistencia válida más pequeña de la ronda. */
export function optimalResistance(round) {
  const valid = validOptions(round);
  return valid.length ? Math.min(...valid) : null;
}

/** Comprueba que la ronda está bien construida (lo usan los tests y la app al arrancar). */
export function validateRound(round) {
  const errors = [];
  if (![5, 9, 12].includes(round.battery)) errors.push('pila no permitida');
  if (round.options.length < 4 || round.options.length > 5) errors.push('debe haber 4 o 5 opciones');
  if (new Set(round.options).size !== round.options.length) errors.push('opciones repetidas');
  if (!round.options.every(isE12)) errors.push('alguna opción no es E12');
  const valid = validOptions(round);
  if (valid.length === 0) errors.push('ninguna opción protege el LED');
  if (valid.length === round.options.length) errors.push('no hay ninguna opción que queme el LED');
  const best = optimalResistance(round);
  if (best !== null && round.options.filter(r => r === best).length !== 1) errors.push('más de una óptima');
  if (best !== null && best < minLedResistance(round.battery, LED.vLed, LED.iMax) - 1e-9) errors.push('óptima incoherente');
  return errors;
}

/** Brillo relativo del LED (0–1) según la intensidad. */
export function ledBrightness(i) {
  return Math.max(0, Math.min(1, i / LED.iMax));
}

/** Puntos de una ronda según los intentos fallidos antes de acertar. */
export function roundPoints(failedAttempts) {
  if (failedAttempts === 0) return 100;
  if (failedAttempts === 1) return 60;
  return 30;
}

export function scoreLevel2(failsPerRound) {
  const points = failsPerRound.reduce((sum, f) => sum + roundPoints(f), 0);
  const hits = failsPerRound.filter(f => f === 0).length;
  const stars = hits === failsPerRound.length ? 3 : hits >= 3 ? 2 : 1;
  return { hits, total: failsPerRound.length, points, stars };
}

/** Rondas en orden aleatorio y opciones barajadas. */
export function prepareLevel2(rand = Math.random) {
  return shuffle(LEVEL2_ROUNDS, rand).map(r => ({ ...r, options: shuffle(r.options, rand) }));
}

/* ───────────────────────── Nivel 3 · Contrarreloj ───────────────────────── */

export const LEVEL3 = { seconds: 120, tolerance: 0.02, starThresholds: [3, 6, 9] };

const pick = (list, rand) => list[Math.floor(rand() * list.length)];
const isNice = (x, decimals = 1) => nearlyEqual(Math.round(x * 10 ** decimals) / 10 ** decimals, x);

/*
 * Cada pregunta: { unknown: 'V'|'I'|'R', unit, answer, given: { V?, I?, R? } }
 * Cada dato: { value, unit } en la unidad en que se muestra. `answer` está en `unit`.
 * `si` guarda los valores en unidades básicas (V, A, Ω) para la explicación.
 */
const TEMPLATES = [
  // I en A con R en Ω (resultado entero o con un decimal sencillo)
  rand => {
    const r = pick([2, 3, 4, 5, 6, 10, 20], rand);
    const i = pick([0.5, 1, 2, 3], rand);
    const v = i * r;
    if (v > 24 || v < 1 || !Number.isInteger(v)) return null;
    return { unknown: 'I', unit: 'A', answer: i, given: { V: { value: v, unit: 'V' }, R: { value: r, unit: 'Ω' } }, si: { V: v, I: i, R: r } };
  },
  // V en V con I en A
  rand => {
    const r = pick([2, 3, 4, 5, 10, 20, 50, 100], rand);
    const i = pick([0.5, 1, 2, 3], rand);
    const v = i * r;
    if (v > 230 || v < 1 || !Number.isInteger(v)) return null;
    return { unknown: 'V', unit: 'V', answer: v, given: { I: { value: i, unit: 'A' }, R: { value: r, unit: 'Ω' } }, si: { V: v, I: i, R: r } };
  },
  // R en Ω con I en A
  rand => {
    const r = pick([2, 3, 4, 5, 6, 10, 12, 20], rand);
    const i = pick([0.5, 1, 2, 3], rand);
    const v = i * r;
    if (v > 24 || v < 1 || !Number.isInteger(v)) return null;
    return { unknown: 'R', unit: 'Ω', answer: r, given: { V: { value: v, unit: 'V' }, I: { value: i, unit: 'A' } }, si: { V: v, I: i, R: r } };
  },
  // Conversión: I en mA con R en kΩ (V en V / R en kΩ = I en mA)
  rand => {
    const rk = pick([1, 2, 3, 4, 5, 10], rand);
    const imA = pick([1, 2, 3, 4, 5, 10], rand);
    const v = imA * rk;
    if (v > 24 || v < 2) return null;
    return { unknown: 'I', unit: 'mA', answer: imA, given: { V: { value: v, unit: 'V' }, R: { value: rk, unit: 'kΩ' } }, si: { V: v, I: imA / 1000, R: rk * 1000 } };
  },
  // Conversión: R en Ω con I en mA
  rand => {
    const r = pick([100, 200, 300, 400, 500, 600], rand);
    const imA = pick([10, 20, 30, 50], rand);
    const v = (imA / 1000) * r;
    if (v > 24 || v < 1 || !Number.isInteger(Math.round(v * 1e6) / 1e6)) return null;
    return { unknown: 'R', unit: 'Ω', answer: r, given: { V: { value: v, unit: 'V' }, I: { value: imA, unit: 'mA' } }, si: { V: v, I: imA / 1000, R: r } };
  },
  // Conversión: V con I en mA y R en kΩ
  rand => {
    const rk = pick([1, 2, 3, 5, 10], rand);
    const imA = pick([1, 2, 3, 5], rand);
    const v = imA * rk;
    if (v > 24 || v < 1) return null;
    return { unknown: 'V', unit: 'V', answer: v, given: { I: { value: imA, unit: 'mA' }, R: { value: rk, unit: 'kΩ' } }, si: { V: v, I: imA / 1000, R: rk * 1000 } };
  }
];

/** Genera una pregunta aleatoria (evita repetir la anterior). */
export function generateQuestion(rand = Math.random, previous = null) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const q = pick(TEMPLATES, rand)(rand);
    if (!q) continue;
    q.answer = Math.round(q.answer * 1e6) / 1e6;
    if (previous && questionKey(previous) === questionKey(q)) continue;
    return q;
  }
  // Respaldo determinista (no debería llegar aquí)
  return { unknown: 'I', unit: 'A', answer: 0.3, given: { V: { value: 9, unit: 'V' }, R: { value: 30, unit: 'Ω' } }, si: { V: 9, I: 0.3, R: 30 } };
}

export function questionKey(q) {
  return [q.unknown, q.unit, ...Object.entries(q.given).map(([k, g]) => `${k}${g.value}${g.unit}`)].join('|');
}

/** Comprueba que los datos de la pregunta cumplen V = I · R. */
export function isConsistent(q) {
  const toSI = (g, sym) => {
    if (!g) return null;
    if (g.unit === 'mA') return g.value / 1000;
    if (g.unit === 'kΩ') return g.value * 1000;
    return g.value;
  };
  const V = q.unknown === 'V' ? q.answer : toSI(q.given.V, 'V');
  const I = q.unknown === 'I' ? (q.unit === 'mA' ? q.answer / 1000 : q.answer) : toSI(q.given.I, 'I');
  const R = q.unknown === 'R' ? (q.unit === 'kΩ' ? q.answer * 1000 : q.answer) : toSI(q.given.R, 'R');
  return nearlyEqual(V, I * R, 1e-6);
}

/** Puntos por acierto en la contrarreloj: 10 + 5 de bonus a partir de una racha de 3. */
export function answerPoints(streak) {
  return 10 + (streak >= 3 ? 5 : 0);
}

export function starsLevel3(correct) {
  const [one, two, three] = LEVEL3.starThresholds;
  if (correct >= three) return 3;
  if (correct >= two) return 2;
  if (correct >= one) return 1;
  return 0;
}

/* ───────────────────────── Común ───────────────────────── */

export const LEVEL_IDS = ['n1', 'n2', 'n3'];

/** Un nivel está desbloqueado si el anterior está completado. */
export function isUnlocked(progress, levelId) {
  const idx = LEVEL_IDS.indexOf(levelId);
  if (idx <= 0) return true;
  return Boolean(progress[LEVEL_IDS[idx - 1]]?.done);
}

export function allDone(progress) {
  return LEVEL_IDS.every(id => progress[id]?.done);
}
