import test from 'node:test';
import assert from 'node:assert/strict';
import { maintenanceExample, KCAL_PER_G, FOOD_PYRAMID } from '../../public/assets/js/lib/nutrition.js';
import { ACTIVITIES, estimateActiveKcal, roundActiveKcal, getActivity } from '../../public/assets/js/lib/activities.js';

const close = (actual, expected, tol = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

test('maintenance example adds back up to the energy estimate', () => {
  const kcal = 2500;
  const ex = maintenanceExample(kcal, 70);
  const total =
    ex.proteinG * KCAL_PER_G.protein +
    ex.carbohydrateG * KCAL_PER_G.carbohydrate +
    ex.fatG * KCAL_PER_G.fat +
    ex.fibreG * KCAL_PER_G.fibre;
  close(total, kcal);
});

test('maintenance example for 2500 kcal and 70 kg', () => {
  const ex = maintenanceExample(2500, 70);
  close(ex.proteinG, 93.75); // 15 % of 2500 / 4 (larger than 0.83 × 70 = 58.1 g)
  close(ex.fatG, 83.33333333); // 30 % of 2500 / 9
  assert.equal(ex.fibreG, 25);
  close(ex.carbohydrateG, 331.25); // (2500 − 375 − 750 − 50) / 4
  assert.ok(ex.carbohydrateWithinRange);
  close(ex.carbohydrateShare, 0.53);
});

test('protein uses 0.83 g/kg when that is higher than 15 % of energy', () => {
  const ex = maintenanceExample(1600, 140);
  close(ex.proteinG, 116.2);
  assert.ok(ex.proteinG > (1600 * 0.15) / 4);
});

test('carbohydrate stays within 45–60 % for typical adult maintenance values', () => {
  for (const kcal of [1500, 1800, 2200, 2800, 3500]) {
    for (const kg of [50, 70, 90]) {
      const ex = maintenanceExample(kcal, kg);
      assert.ok(ex.carbohydrateWithinRange, `${kcal} kcal, ${kg} kg -> ${ex.carbohydrateShare}`);
    }
  }
});

test('maintenance example rejects invalid input', () => {
  assert.throws(() => maintenanceExample(0, 70), RangeError);
  assert.throws(() => maintenanceExample(2000, NaN), RangeError);
});

test('food pyramid covers all six shelves', () => {
  assert.equal(FOOD_PYRAMID.length, 6);
});

test('MET estimate is net: (MET − 1) × kg × hours', () => {
  close(estimateActiveKcal({ met: 3.5, weightKg: 80, durationMin: 30 }), 100); // 2.5 × 80 × 0.5
  close(estimateActiveKcal({ met: 9.8, weightKg: 65, durationMin: 45 }), 429); // 8.8 × 65 × 0.75
  assert.equal(roundActiveKcal(428.9), 430);
  assert.equal(roundActiveKcal(null), null);
});

test('MET estimate is withheld when it cannot be made', () => {
  assert.equal(estimateActiveKcal({ met: null, weightKg: 80, durationMin: 30 }), null);
  assert.equal(estimateActiveKcal({ met: 1, weightKg: 80, durationMin: 30 }), null);
  assert.equal(estimateActiveKcal({ met: 5, weightKg: undefined, durationMin: 30 }), null);
  assert.equal(estimateActiveKcal({ met: 5, weightKg: 80, durationMin: 0 }), null);
});

test('activity table has unique IDs, Compendium codes and plausible METs', () => {
  const ids = new Set(ACTIVITIES.map((a) => a.id));
  assert.equal(ids.size, ACTIVITIES.length);
  for (const a of ACTIVITIES) {
    if (a.id === 'other') continue;
    assert.match(a.code, /^\d{5}$/, a.id);
    assert.ok(a.met > 1 && a.met < 20, a.id);
  }
  assert.equal(getActivity('other').met, null);
});

test('macro progress: percent of the guide amount, grams left, and grams over', async () => {
  const { macroProgress } = await import('../../public/assets/js/lib/nutrition.js');
  const p = macroProgress({ protein: 72, carbohydrate: 0, fat: 113.4, fibre: null }, { proteinG: 120.4, carbohydrateG: 300, fatG: 90, fibreG: 25 });
  assert.deepEqual(p.protein, { targetG: 120, fraction: 0.6, percent: 60, leftG: 48, overG: 0 });
  assert.deepEqual([p.carbohydrate.percent, p.carbohydrate.leftG], [0, 300]);
  assert.deepEqual([p.fat.percent, p.fat.leftG, p.fat.overG], [126, 0, 23]);
  assert.deepEqual([p.fibre.percent, p.fibre.leftG], [0, 25], 'nothing known counts as nothing logged');
  assert.deepEqual(macroProgress({ protein: 10 }, null), {});
  assert.ok(!('fat' in macroProgress({ fat: 10 }, { proteinG: 100, fatG: 0 })), 'no guide amount, no progress');
});
