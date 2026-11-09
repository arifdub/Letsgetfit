import test from 'node:test';
import assert from 'node:assert/strict';
import {
  feetInchesToCm,
  cmToFeetInches,
  stonePoundsToKg,
  kgToStonePounds,
  kcalToKj,
  roundTo,
} from '../../public/assets/js/lib/units.js';

const close = (actual, expected, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

test('feet and inches convert to centimetres exactly', () => {
  close(feetInchesToCm(5, 9), 175.26);
  close(feetInchesToCm(6, 0), 182.88);
  close(feetInchesToCm(0, 1), 2.54);
});

test('stone and pounds convert to kilograms exactly', () => {
  close(stonePoundsToKg(11, 0), 69.85322498);
  close(stonePoundsToKg(0, 1), 0.45359237);
  close(stonePoundsToKg(12, 8), 79.83225712);
});

test('metric converts back to imperial for display', () => {
  assert.deepEqual(cmToFeetInches(175.26), { feet: 5, inches: 9 });
  assert.deepEqual(cmToFeetInches(182.6), { feet: 6, inches: 0 }); // 71.9 in rounds up to 6 ft 0 in
  assert.deepEqual(kgToStonePounds(69.85), { stone: 11, pounds: 0 });
  assert.deepEqual(kgToStonePounds(76.0), { stone: 12, pounds: 0 }); // 167.55 lb -> 11 st 13.55 lb rounds to 12 st 0 lb
});

test('round trip from imperial keeps the entered value after one-decimal storage', () => {
  const cm = roundTo(feetInchesToCm(5, 9), 1);
  assert.equal(cm, 175.3);
  assert.deepEqual(cmToFeetInches(cm), { feet: 5, inches: 9 });
  const kg = roundTo(stonePoundsToKg(12, 8), 1);
  assert.equal(kg, 79.8);
  assert.deepEqual(kgToStonePounds(kg), { stone: 12, pounds: 8 });
});

test('kcal to kJ uses 4.184', () => {
  close(kcalToKj(1000), 4184);
});

test('roundTo avoids floating point drift', () => {
  assert.equal(roundTo(1.005, 2), 1.01);
  assert.equal(roundTo(24.95, 1), 25);
});
