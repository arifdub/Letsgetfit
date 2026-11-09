import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mifflinStJeor,
  maintenanceEnergy,
  roundEnergyForDisplay,
  ACTIVITY_LEVELS,
  SEX_COEFFICIENTS,
} from '../../public/assets/js/lib/energy.js';

const close = (actual, expected, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

// Hand-worked reference cases for REE = 10W + 6.25H − 5A + s.
test('Mifflin–St Jeor, male coefficient: 30 y, 80 kg, 180 cm = 1780 kcal/day', () => {
  // 800 + 1125 − 150 + 5
  close(mifflinStJeor({ weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male' }), 1780);
});

test('Mifflin–St Jeor, female coefficient: 30 y, 65 kg, 165 cm = 1370.25 kcal/day', () => {
  // 650 + 1031.25 − 150 − 161
  close(mifflinStJeor({ weightKg: 65, heightCm: 165, ageYears: 30, sex: 'female' }), 1370.25);
});

test('Mifflin–St Jeor, female coefficient: 55 y, 92.4 kg, 158.5 cm', () => {
  // 924 + 990.625 − 275 − 161 = 1478.625
  close(mifflinStJeor({ weightKg: 92.4, heightCm: 158.5, ageYears: 55, sex: 'female' }), 1478.625);
});

test('the sex coefficients differ by 166 kcal/day', () => {
  assert.equal(SEX_COEFFICIENTS.male - SEX_COEFFICIENTS.female, 166);
});

test('each kg, cm and year changes the estimate by the published coefficient', () => {
  const base = { weightKg: 70, heightCm: 170, ageYears: 40, sex: 'female' };
  const r = mifflinStJeor(base);
  close(mifflinStJeor({ ...base, weightKg: 71 }) - r, 10);
  close(mifflinStJeor({ ...base, heightCm: 171 }) - r, 6.25);
  close(mifflinStJeor({ ...base, ageYears: 41 }) - r, -5);
});

test('invalid inputs are rejected rather than producing a number', () => {
  assert.throws(() => mifflinStJeor({ weightKg: 70, heightCm: 170, ageYears: 40, sex: 'other' }), RangeError);
  assert.throws(() => mifflinStJeor({ weightKg: NaN, heightCm: 170, ageYears: 40, sex: 'male' }), RangeError);
  assert.throws(() => mifflinStJeor({ weightKg: 70, heightCm: 0, ageYears: 40, sex: 'male' }), RangeError);
  assert.throws(() => mifflinStJeor({ weightKg: 70, heightCm: 170, ageYears: undefined, sex: 'male' }), RangeError);
});

test('activity levels sit inside the FAO/WHO/UNU 2004 PAL ranges (1.40–2.40)', () => {
  assert.deepEqual(
    ACTIVITY_LEVELS.map((l) => l.pal),
    [1.4, 1.55, 1.85, 2.2],
  );
  for (const level of ACTIVITY_LEVELS) {
    assert.ok(level.pal >= 1.4 && level.pal <= 2.4, level.id);
    assert.ok(level.description.length > 20, `${level.id} needs an explanation`);
  }
});

test('maintenance = REE × PAL', () => {
  close(maintenanceEnergy(1780, 'moderate'), 3293);
  close(maintenanceEnergy(1370.25, 'light'), 2123.8875);
  close(maintenanceEnergy(1000, 'mostly-seated'), 1400);
  close(maintenanceEnergy(1000, 'vigorous'), 2200);
  assert.throws(() => maintenanceEnergy(1000, 'extreme'), RangeError);
});

test('display rounding goes to the nearest 10 kcal', () => {
  assert.equal(roundEnergyForDisplay(3293), 3290);
  assert.equal(roundEnergyForDisplay(2123.8875), 2120);
  assert.equal(roundEnergyForDisplay(1375), 1380);
});
