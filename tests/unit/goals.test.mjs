import test from 'node:test';
import assert from 'node:assert/strict';
import { healthyWeightRange, validateGoal, planGoal, allowedLossRates, ENERGY_FLOOR, KCAL_PER_KG } from '../../public/assets/js/lib/goals.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);
// 30 y, 180 cm, 80 kg, male, moderately active: REE 1780, maintenance 3293
const man = { ageYears: 30, heightCm: 180, weightKg: 80, sex: 'male', activityLevel: 'moderate', pregnantOrBreastfeeding: false };
// 30 y, 165 cm, 65 kg, female, mostly seated: REE 1370.25, maintenance 1918.35
const woman = { ageYears: 30, heightCm: 165, weightKg: 65, sex: 'female', activityLevel: 'mostly-seated', pregnantOrBreastfeeding: false };

test('healthy weight range is BMI 18.5–24.9 for the height', () => {
  assert.deepEqual(healthyWeightRange(180), { minKg: 59.9, maxKg: 80.7 });
  assert.deepEqual(healthyWeightRange(165), { minKg: 50.4, maxKg: 67.8 });
});

test('loss plan: deficit from 7,700 kcal/kg, timeline and macros', () => {
  const v = validateGoal({ type: 'lose', targetKg: '75', ratePerWeekKg: '0.5' }, man);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const p = planGoal(man, v.value, '2026-11-10');
  close(p.maintenanceKcal, 3293);
  close(p.dailyChangeKcal, -550); // 0.5 × 7700 / 7
  assert.equal(p.allowedKcal, 2740); // 2743 -> nearest 10
  assert.equal(p.floorApplied, false);
  close(p.weeksToTarget, 10);
  assert.equal(p.targetDate, '2027-01-19');
  assert.ok(p.macros.proteinG > 0 && p.macros.carbohydrateWithinRange);
});

test('the energy floor is never crossed; the rate is reduced instead', () => {
  const v = validateGoal({ type: 'lose', targetKg: '60', ratePerWeekKg: '0.75' }, woman);
  assert.equal(v.ok, false, 'over 1 % of 65 kg a week is not offered');
  const ok = validateGoal({ type: 'lose', targetKg: '60', ratePerWeekKg: '0.5' }, woman).value;
  const p = planGoal(woman, ok, '2026-11-10');
  // 1918.35 − 550 = 1368 is above 1200, so no floor needed.
  assert.equal(p.floorApplied, false);
  const small = { ...woman, weightKg: 58, heightCm: 160, ageYears: 70 }; // maintenance ≈ 1554
  const p2 = planGoal(small, { type: 'lose', targetKg: 55, ratePerWeekKg: 0.5 }, '2026-11-10');
  assert.equal(p2.floorApplied, true);
  assert.equal(p2.allowedKcal, ENERGY_FLOOR.female);
  assert.ok(p2.effectiveRateKg < 0.5);
  close(p2.effectiveRateKg, ((p2.maintenanceKcal - 1200) * 7) / KCAL_PER_KG);
});

test('loss rates are capped at 1 % of body weight a week and 1 kg', () => {
  assert.deepEqual(allowedLossRates(65), [0.25, 0.5]);
  assert.deepEqual(allowedLossRates(80), [0.25, 0.5, 0.75]);
  assert.deepEqual(allowedLossRates(140), [0.25, 0.5, 0.75, 1]);
  assert.deepEqual(allowedLossRates(20), [0.25], 'smallest option always offered');
});

test('loss targets cannot go below the healthy range; no loss goal when underweight', () => {
  const below = validateGoal({ type: 'lose', targetKg: '58', ratePerWeekKg: '0.5' }, man);
  assert.match(below.errors.targetKg, /lowest target LetsGetFit will set is 59\.9 kg/);
  const under = validateGoal({ type: 'lose', targetKg: '50', ratePerWeekKg: '0.25' }, { ...woman, weightKg: 49 });
  assert.match(under.errors.type, /below the healthy range/);
  assert.match(validateGoal({ type: 'lose', targetKg: '85', ratePerWeekKg: '0.5' }, man).errors.targetKg, /below your current weight/);
});

test('gain goals: up to the top of the healthy range, surplus capped at 500 kcal', () => {
  const thin = { ...woman, weightKg: 48 }; // BMI 17.6
  const v = validateGoal({ type: 'gain', targetKg: '54', ratePerWeekKg: '0.5' }, thin);
  assert.equal(v.ok, true);
  const p = planGoal(thin, v.value, '2026-11-10');
  assert.equal(p.dailyChangeKcal, 500);
  close(p.effectiveRateKg, (500 * 7) / KCAL_PER_KG);
  assert.match(validateGoal({ type: 'gain', targetKg: '70', ratePerWeekKg: '0.25' }, thin).errors.targetKg, /highest target LetsGetFit will set is 67\.8 kg/);
  assert.match(validateGoal({ type: 'gain', targetKg: '40', ratePerWeekKg: '0.25' }, thin).errors.targetKg, /above your current weight/);
});

test('maintain needs no target; ineligible profiles get no goals', () => {
  const m = validateGoal({ type: 'maintain' }, man);
  assert.equal(m.ok, true);
  const p = planGoal(man, m.value, '2026-11-10');
  assert.equal(p.allowedKcal, 3290);
  assert.equal(p.targetDate, null);
  assert.equal(validateGoal({ type: 'lose', targetKg: '75', ratePerWeekKg: '0.5' }, { ...man, ageYears: 19 }).ok, false);
  assert.equal(validateGoal({ type: 'lose', targetKg: '75', ratePerWeekKg: '0.5' }, { ...man, pregnantOrBreastfeeding: true }).ok, false);
  assert.equal(validateGoal({ type: 'bulk' }, man).ok, false);
});
