// Ohm Lab · datos y lógica de los niveles (sin DOM: se prueban con node --test)
import { current, ledCurrent, minLedResistance, nearlyEqual, isE12, shuffle } from './physics.js';

/* ───────────────────────── Nivel 1 · El agua y la corriente (Ley de Ohm) ───────────────────────── */

export const LEVEL1 = {
  voltage: { min: 1, max: 12, step: 0.5, initial: 9 },
  resistance: { min: 1, max: 100, step: 1, initial: 30 },
  targetCurrent: 0.5, // reto 1: «consigue exactamente 0,5 A»
  // Reto 3: opción múltiple. La correcta es «double».
  quizOptions: ['double', 'half', 'same', 'quadruple'],
  quizAnswer: 'double',
  targetPower: 6, // reto 4: «la resistencia disipa exactamente 6 W»
  challenges: 4
};

/** Potencia eléctrica P = V · I (W). */
export function power(v, i) {
  return v * i;
}

/** Reto 1: ¿la corriente es exactamente la objetivo? */
export function isTargetCurrent(v, r, target = LEVEL1.targetCurrent) {
  return nearlyEqual(current(v, r), target);
}

/** Reto 4: ¿la potencia es exactamente la objetivo? */
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
 * Puntuación de un nivel de retos (niveles 1 y 2).
 * mistakes: errores en las preguntas de opción múltiple; failedQuizzes: preguntas con algún error.
 */
export function scoreChallenges(total, mistakes, failedQuizzes = Math.min(mistakes, 1)) {
  const points = total * 100 - Math.min(mistakes, 4) * 25;
  const stars = mistakes === 0 ? 3 : mistakes === 1 ? 2 : 1;
  return { hits: total - failedQuizzes, total, points, stars };
}

export function scoreLevel1(mistakes, failedQuizzes) {
  return scoreChallenges(LEVEL1.challenges, mistakes, failedQuizzes);
}

/* ───────────────────────── Nivel 2 · Serie, paralelo y Kirchhoff ───────────────────────── */

export const CIRCUITS = {
  voltage: { min: 1, max: 12, step: 1, initial: 12 },
  r1: { min: 5, max: 100, step: 5, initial: 40 },
  r2: { min: 5, max: 100, step: 5, initial: 40 },
  modes: ['series', 'parallel'],
  targetTotalCurrent: 1, // reto 3: en paralelo, I total = 1 A
  // Reto 2 (ley de las mallas): pila de 9 V, la bombilla 1 tiene 6 V → la 2 tiene 3 V
  kvlOptions: ['v3', 'v6', 'v9', 'v15'],
  kvlAnswer: 'v3',
  // Reto 4 (pregunta del itinerario en PhET): dos bombillas iguales, ¿dónde brillan más?
  brightOptions: ['series', 'parallel', 'same', 'off'],
  brightAnswer: 'parallel',
  challenges: 4
};

/** Circuito en serie con dos receptores: misma I, la tensión se reparte (V1 + V2 = V). */
export function seriesCircuit(v, r1, r2) {
  const rt = r1 + r2;
  const i = v / rt;
  const v1 = i * r1;
  const v2 = i * r2;
  return { mode: 'series', V: v, Rt: rt, I: i, items: [{ R: r1, I: i, V: v1, P: v1 * i }, { R: r2, I: i, V: v2, P: v2 * i }] };
}

/** Circuito en paralelo con dos receptores: misma V, la corriente se reparte (I = I1 + I2). */
export function parallelCircuit(v, r1, r2) {
  const i1 = v / r1;
  const i2 = v / r2;
  const rt = (r1 * r2) / (r1 + r2);
  return { mode: 'parallel', V: v, Rt: rt, I: i1 + i2, items: [{ R: r1, I: i1, V: v, P: v * i1 }, { R: r2, I: i2, V: v, P: v * i2 }] };
}

export function solveCircuit(mode, v, r1, r2) {
  return mode === 'parallel' ? parallelCircuit(v, r1, r2) : seriesCircuit(v, r1, r2);
}

/** Reto 1: en serie, la bombilla 1 tiene el doble de tensión que la 2. */
export function isDoubleVoltage(c) {
  return c.mode === 'series' && nearlyEqual(c.items[0].V, 2 * c.items[1].V);
}

/** Reto 3: en paralelo, la intensidad total es exactamente 1 A. */
export function isTargetTotalCurrent(c, target = CIRCUITS.targetTotalCurrent) {
  return c.mode === 'parallel' && nearlyEqual(c.I, target);
}

export function scoreCircuits(mistakes, failedQuizzes) {
  return scoreChallenges(CIRCUITS.challenges, mistakes, failedQuizzes);
}

/* ───────────────────────── Nivel 3 · ¡Salva el LED! ───────────────────────── */

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

/* ───────────────────────── Nivel 4 · Contrarreloj ───────────────────────── */

export const LEVEL3 = { seconds: 120, tolerance: 0.02, starThresholds: [3, 6, 9] };

const pick = (list, rand) => list[Math.floor(rand() * list.length)];
const g = (sym, value, unit) => ({ sym, value, unit });

/*
 * Cada pregunta: { kind, unknown, unit, answer, given: [{ sym, value, unit }] }
 *  kind: 'ohm' (falta V, I o R) · 'series' (I con R1 y R2 en serie) · 'kvl' (V2 en serie)
 *        'kcl' (I total en paralelo con I1 e I2) · 'parallel' (I total con R1 y R2 en paralelo)
 * Todos los datos y resultados son números «redondos» (enteros o ,5) para no exigir cálculo mental difícil.
 */
const TEMPLATES = [
  // Ley de Ohm: I con R en Ω
  rand => {
    const r = pick([2, 3, 4, 5, 6, 10, 20], rand);
    const i = pick([0.5, 1, 2, 3], rand);
    const v = i * r;
    if (v > 24 || v < 1 || !Number.isInteger(v)) return null;
    return { kind: 'ohm', unknown: 'I', unit: 'A', answer: i, given: [g('V', v, 'V'), g('R', r, 'Ω')] };
  },
  // Ley de Ohm: V
  rand => {
    const r = pick([2, 3, 4, 5, 10, 20, 50, 100], rand);
    const i = pick([0.5, 1, 2, 3], rand);
    const v = i * r;
    if (v > 230 || v < 1 || !Number.isInteger(v)) return null;
    return { kind: 'ohm', unknown: 'V', unit: 'V', answer: v, given: [g('I', i, 'A'), g('R', r, 'Ω')] };
  },
  // Ley de Ohm: R
  rand => {
    const r = pick([2, 3, 4, 5, 6, 10, 12, 20], rand);
    const i = pick([0.5, 1, 2, 3], rand);
    const v = i * r;
    if (v > 24 || v < 1 || !Number.isInteger(v)) return null;
    return { kind: 'ohm', unknown: 'R', unit: 'Ω', answer: r, given: [g('V', v, 'V'), g('I', i, 'A')] };
  },
  // Conversión: I en mA con R en kΩ
  rand => {
    const rk = pick([1, 2, 3, 4, 5, 10], rand);
    const imA = pick([1, 2, 3, 4, 5, 10], rand);
    const v = imA * rk;
    if (v > 24 || v < 2) return null;
    return { kind: 'ohm', unknown: 'I', unit: 'mA', answer: imA, given: [g('V', v, 'V'), g('R', rk, 'kΩ')] };
  },
  // Conversión: R en Ω con I en mA
  rand => {
    const r = pick([100, 200, 300, 400, 500, 600], rand);
    const imA = pick([10, 20, 30, 50], rand);
    const v = Math.round((imA / 1000) * r * 1e6) / 1e6;
    if (v > 24 || v < 1 || !Number.isInteger(v)) return null;
    return { kind: 'ohm', unknown: 'R', unit: 'Ω', answer: r, given: [g('V', v, 'V'), g('I', imA, 'mA')] };
  },
  // Serie: R total = R1 + R2 → I
  rand => {
    const r1 = pick([2, 4, 5, 6, 10, 20], rand);
    const r2 = pick([2, 4, 5, 6, 10, 20], rand);
    const i = pick([0.5, 1, 2], rand);
    const v = i * (r1 + r2);
    if (v > 24 || !Number.isInteger(v)) return null;
    return { kind: 'series', unknown: 'I', unit: 'A', answer: i, given: [g('V', v, 'V'), g('R₁', r1, 'Ω'), g('R₂', r2, 'Ω')] };
  },
  // Serie (Kirchhoff, mallas): V2 = V − V1
  rand => {
    const v = pick([6, 9, 12, 24], rand);
    const v1 = pick([1, 2, 3, 4, 5, 6, 8, 10, 15, 18], rand);
    if (v1 >= v) return null;
    return { kind: 'kvl', unknown: 'V₂', unit: 'V', answer: v - v1, given: [g('V', v, 'V'), g('V₁', v1, 'V')] };
  },
  // Paralelo (Kirchhoff, nudos): I = I1 + I2
  rand => {
    const i1 = pick([0.5, 1, 1.5, 2, 3], rand);
    const i2 = pick([0.5, 1, 2, 2.5, 4], rand);
    return { kind: 'kcl', unknown: 'I', unit: 'A', answer: i1 + i2, given: [g('I₁', i1, 'A'), g('I₂', i2, 'A')] };
  },
  // Paralelo: I1 = V/R1, I2 = V/R2, I = I1 + I2
  rand => {
    const v = pick([6, 12], rand);
    const r1 = pick([2, 3, 4, 6, 12], rand);
    const r2 = pick([2, 3, 4, 6, 12], rand);
    const i = v / r1 + v / r2;
    if (!Number.isInteger(i * 2)) return null;
    return { kind: 'parallel', unknown: 'I', unit: 'A', answer: i, given: [g('V', v, 'V'), g('R₁', r1, 'Ω'), g('R₂', r2, 'Ω')] };
  }
];

const OHM_TEMPLATES = 5;
const OHM_SHARE = 0.6;

/** Genera una pregunta aleatoria (evita repetir la anterior). */
export function generateQuestion(rand = Math.random, previous = null) {
  for (let attempt = 0; attempt < 500; attempt++) {
    // Primero se elige el tipo (60 % Ley de Ohm, 40 % serie/paralelo/Kirchhoff) y después
    // se reintenta esa misma plantilla: así las plantillas con más descartes no pierden peso.
    const ohm = rand() < OHM_SHARE;
    const template = ohm ? pick(TEMPLATES.slice(0, OHM_TEMPLATES), rand) : pick(TEMPLATES.slice(OHM_TEMPLATES), rand);
    let q = null;
    for (let k = 0; k < 50 && !q; k++) q = template(rand);
    if (!q) continue;
    q.answer = Math.round(q.answer * 1e6) / 1e6;
    if (previous && questionKey(previous) === questionKey(q)) continue;
    return q;
  }
  return { kind: 'ohm', unknown: 'I', unit: 'A', answer: 3, given: [g('V', 9, 'V'), g('R', 3, 'Ω')] };
}

export function questionKey(q) {
  return [q.kind, q.unknown, q.unit, ...q.given.map(x => `${x.sym}${x.value}${x.unit}`)].join('|');
}

/** Valor del dato en unidades básicas (V, A, Ω). */
export function toSI(x) {
  if (x.unit === 'mA') return x.value / 1000;
  if (x.unit === 'kΩ') return x.value * 1000;
  return x.value;
}

/** Resuelve la pregunta a partir de los datos (independiente de cómo se generó). Devuelve la respuesta en q.unit. */
export function solveQuestion(q) {
  const d = Object.fromEntries(q.given.map(x => [x.sym, toSI(x)]));
  let si;
  if (q.kind === 'ohm') {
    if (q.unknown === 'I') si = d.V / d.R;
    else if (q.unknown === 'V') si = d.I * d.R;
    else si = d.V / d.I;
  } else if (q.kind === 'series') si = d.V / (d['R₁'] + d['R₂']);
  else if (q.kind === 'kvl') si = d.V - d['V₁'];
  else if (q.kind === 'kcl') si = d['I₁'] + d['I₂'];
  else if (q.kind === 'parallel') si = d.V / d['R₁'] + d.V / d['R₂'];
  if (q.unit === 'mA') return si * 1000;
  if (q.unit === 'kΩ') return si / 1000;
  return si;
}

export function isConsistent(q) {
  return nearlyEqual(solveQuestion(q), q.answer, 1e-6);
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

// Orden de juego. Los identificadores se conservan por compatibilidad: n1 Ohm, nc circuitos, n2 LED, n3 contrarreloj.
export const LEVEL_IDS = ['n1', 'nc', 'n2', 'n3'];

/** Un nivel está desbloqueado si el anterior está completado. */
export function isUnlocked(progress, levelId) {
  const idx = LEVEL_IDS.indexOf(levelId);
  if (idx <= 0) return true;
  return Boolean(progress[LEVEL_IDS[idx - 1]]?.done);
}

export function allDone(progress) {
  return LEVEL_IDS.every(id => progress[id]?.done);
}
