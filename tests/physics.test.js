import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  current, voltage, resistance, ledCurrent, minLedResistance, withinTolerance,
  parseUserNumber, formatNumber, formatOhms, isE12, nearlyEqual, evaluateExpression
} from '../js/physics.js';

test('Ley de Ohm: I = V / R, V = I · R, R = V / I', () => {
  assert.ok(nearlyEqual(current(9, 30), 0.3));
  assert.ok(nearlyEqual(current(9, 3), 3));
  assert.ok(nearlyEqual(voltage(0.5, 10), 5));
  assert.ok(nearlyEqual(resistance(12, 0.02), 600));
  assert.throws(() => current(9, 0));
  assert.throws(() => resistance(9, 0));
});

test('LED: I = (Vpila − VLED) / R y resistencia mínima', () => {
  assert.ok(nearlyEqual(ledCurrent(9, 2, 470), 7 / 470));
  assert.ok(nearlyEqual(minLedResistance(5, 2, 0.02), 150));
  assert.ok(nearlyEqual(minLedResistance(9, 2, 0.02), 350));
  assert.ok(nearlyEqual(minLedResistance(12, 2, 0.02), 500));
  assert.equal(ledCurrent(1, 2, 100), 0);
});

test('Tolerancia del ±2 %', () => {
  assert.ok(withinTolerance(0.3, 0.3));
  assert.ok(withinTolerance(0.306, 0.3));
  assert.ok(withinTolerance(0.294, 0.3));
  assert.ok(!withinTolerance(0.307, 0.3));
  assert.ok(!withinTolerance(Number.NaN, 0.3));
  assert.ok(withinTolerance(450, 450));
  assert.ok(!withinTolerance(460, 450));
});

test('Lectura de números con coma o punto', () => {
  assert.equal(parseUserNumber('0,5'), 0.5);
  assert.equal(parseUserNumber('0.5'), 0.5);
  assert.equal(parseUserNumber(' 12 '), 12);
  assert.equal(parseUserNumber('1.000,5'), 1000.5);
  assert.equal(parseUserNumber(',5'), 0.5);
  assert.ok(Number.isNaN(parseUserNumber('abc')));
  assert.ok(Number.isNaN(parseUserNumber('')));
  assert.ok(Number.isNaN(parseUserNumber('5 V')));
});

test('Formato con coma decimal', () => {
  assert.equal(formatNumber(0.1 + 0.2, 'es', 2), '0,3');
  assert.equal(formatNumber(0.30, 'ca', 2), '0,3');
  assert.equal(formatNumber(1500, 'es', 2), '1500');
  assert.equal(formatOhms(470, 'es'), '470 Ω');
  assert.equal(formatOhms(1000, 'es'), '1 kΩ');
  assert.equal(formatOhms(2200, 'ca'), '2,2 kΩ');
});

test('Serie E12', () => {
  for (const r of [10, 100, 220, 470, 1000, 1200, 2200, 68, 180, 390, 560, 680, 820, 1500, 150, 270, 330]) {
    assert.ok(isE12(r), `${r} debería ser E12`);
  }
  for (const r of [200, 450, 500, 250]) assert.ok(!isE12(r), `${r} no es E12`);
});

test('Calculadora segura', () => {
  assert.equal(evaluateExpression('9 / 450'), 0.02);
  assert.equal(evaluateExpression('(12 − 2) / 0,02'), 500);
  assert.equal(evaluateExpression('2 × 3 + 1'), 7);
  assert.equal(evaluateExpression('0,5·20'), 10);
  assert.equal(evaluateExpression('-3+5'), 2);
  assert.ok(Number.isNaN(evaluateExpression('5/0')));
  assert.ok(Number.isNaN(evaluateExpression('alert(1)')));
  assert.ok(Number.isNaN(evaluateExpression('2+')));
  assert.ok(Number.isNaN(evaluateExpression('')));
});
