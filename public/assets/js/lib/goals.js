// Weight goals: healthy weight range, and allowed daily energy for losing, maintaining or
// gaining weight, with safeguards. Pure functions; see docs/FORMULAS.md ("Goals").
//
// Method (estimates, not a prescription):
//   Healthy weight range for height = BMI 18.5 to 24.9 × height (m)²  (CDC adult categories)
//   Daily energy change = weekly rate (kg) × 7,700 kcal/kg ÷ 7
//     7,700 kcal per kg is the common approximation for the energy in body fat. It overestimates
//     long-term change because the body adapts (Hall KD et al., Lancet 2011), so the timeline is
//     shown as an estimate and the user is told to review progress after a few weeks.
//   Allowed energy = maintenance estimate − deficit (or + surplus), never below a floor:
//     1,200 kcal (female coefficient) or 1,500 kcal (male coefficient). Below these, guidance is to
//     follow a diet only with medical supervision.
// Safeguards:
//   - Only for the same eligible adults as the calculator (20–78, not pregnant or breastfeeding).
//   - No loss target below the healthy range; no loss goal at all if BMI is already under 18.5.
//   - No gain target above the healthy range.
//   - Loss rate at most 1 kg a week and at most 1% of current weight a week; gain at most 0.5 kg a week.

import { roundTo } from './units.js';
import { checkEligibility } from './validate.js';
import { mifflinStJeor, maintenanceEnergy } from './energy.js';
import { calculateBmi } from './bmi.js';
import { maintenanceExample } from './nutrition.js';
import { parseLocalDate, toLocalDateString } from './dates.js';

export const KCAL_PER_KG = 7700;
export const HEALTHY_BMI = Object.freeze({ min: 18.5, max: 24.9 });
export const ENERGY_FLOOR = Object.freeze({ female: 1200, male: 1500 });
export const MAX_SURPLUS = 500;
export const LOSS_RATES = Object.freeze([0.25, 0.5, 0.75, 1.0]);
export const GAIN_RATES = Object.freeze([0.25, 0.5]);
export const MAX_LOSS_SHARE_PER_WEEK = 0.01; // 1 % of body weight

export function healthyWeightRange(heightCm) {
  const m2 = (heightCm / 100) ** 2;
  return { minKg: roundTo(HEALTHY_BMI.min * m2, 1), maxKg: roundTo(HEALTHY_BMI.max * m2, 1) };
}

/**
 * Check a goal against the profile. Returns { ok, errors, value } where value is the
 * normalised goal { type, targetKg, ratePerWeekKg }.
 */
export function validateGoal(raw, profile) {
  const eligibility = checkEligibility(profile);
  if (!eligibility.eligible) return { ok: false, errors: { type: 'Goals are only available to adults the calculator is designed for.' }, value: null };
  const type = ['lose', 'maintain', 'gain'].includes(raw.type) ? raw.type : null;
  if (!type) return { ok: false, errors: { type: 'Choose a goal.' }, value: null };
  if (type === 'maintain') return { ok: true, errors: {}, value: { type, targetKg: null, ratePerWeekKg: 0 } };

  const errors = {};
  const range = healthyWeightRange(profile.heightCm);
  const bmi = roundTo(calculateBmi(profile.weightKg, profile.heightCm), 1);
  const target = Number(raw.targetKg);
  const rate = Number(raw.ratePerWeekKg);

  if (type === 'lose') {
    if (bmi < HEALTHY_BMI.min) {
      return { ok: false, errors: { type: 'Your BMI is below the healthy range, so LetsGetFit does not set weight-loss targets. Please talk to your GP.' }, value: null };
    }
    if (!Number.isFinite(target)) errors.targetKg = 'Enter your target weight.';
    else if (target >= profile.weightKg) errors.targetKg = 'For a weight-loss goal, the target must be below your current weight.';
    else if (target < range.minKg) errors.targetKg = `That is below the healthy range for your height. The lowest target LetsGetFit will set is ${range.minKg} kg.`;
    if (!LOSS_RATES.includes(rate)) errors.ratePerWeekKg = 'Choose a weekly rate.';
    else if (!allowedLossRates(profile.weightKg).includes(rate)) errors.ratePerWeekKg = 'Choose a slower rate: at most 1% of your body weight a week.';
  } else {
    if (!Number.isFinite(target)) errors.targetKg = 'Enter your target weight.';
    else if (target <= profile.weightKg) errors.targetKg = 'For a weight-gain goal, the target must be above your current weight.';
    else if (target > range.maxKg) errors.targetKg = `That is above the healthy range for your height. The highest target LetsGetFit will set is ${range.maxKg} kg.`;
    if (!GAIN_RATES.includes(rate)) errors.ratePerWeekKg = 'Choose a weekly rate.';
  }
  if (Object.keys(errors).length) return { ok: false, errors, value: null };
  return { ok: true, errors: {}, value: { type, targetKg: roundTo(target, 1), ratePerWeekKg: rate } };
}

/** Loss rates offered for a given weight (capped at 1 % of body weight a week). */
export function allowedLossRates(weightKg) {
  return LOSS_RATES.filter((r) => r <= Math.max(LOSS_RATES[0], weightKg * MAX_LOSS_SHARE_PER_WEEK + 1e-9));
}

function addDays(localDate, days) {
  const d = parseLocalDate(localDate);
  d.setDate(d.getDate() + Math.round(days));
  return toLocalDateString(d);
}

/**
 * The daily plan for a validated goal.
 * @returns {{ maintenanceKcal, allowedKcal, dailyChangeKcal, floorKcal, floorApplied, effectiveRateKg,
 *   weeksToTarget, targetDate, healthy, bmi, targetBmi, macros }}
 */
export function planGoal(profile, goal, today = toLocalDateString()) {
  const ree = mifflinStJeor({ weightKg: profile.weightKg, heightCm: profile.heightCm, ageYears: profile.ageYears, sex: profile.sex });
  const maintenanceKcal = maintenanceEnergy(ree, profile.activityLevel);
  const floorKcal = ENERGY_FLOOR[profile.sex];
  const healthy = healthyWeightRange(profile.heightCm);
  const bmi = calculateBmi(profile.weightKg, profile.heightCm);

  let dailyChangeKcal = 0;
  let allowedKcal = maintenanceKcal;
  let floorApplied = false;
  let effectiveRateKg = 0;
  if (goal.type === 'lose') {
    const cap = Math.min(goal.ratePerWeekKg, profile.weightKg * MAX_LOSS_SHARE_PER_WEEK, 1);
    let deficit = (cap * KCAL_PER_KG) / 7;
    if (maintenanceKcal - deficit < floorKcal) {
      deficit = Math.max(0, maintenanceKcal - floorKcal);
      floorApplied = true;
    }
    dailyChangeKcal = -deficit;
    allowedKcal = maintenanceKcal - deficit;
    effectiveRateKg = (deficit * 7) / KCAL_PER_KG;
  } else if (goal.type === 'gain') {
    const surplus = Math.min((goal.ratePerWeekKg * KCAL_PER_KG) / 7, MAX_SURPLUS);
    dailyChangeKcal = surplus;
    allowedKcal = maintenanceKcal + surplus;
    effectiveRateKg = (surplus * 7) / KCAL_PER_KG;
  }

  let weeksToTarget = null;
  let targetDate = null;
  if (goal.type !== 'maintain' && effectiveRateKg > 0) {
    weeksToTarget = Math.abs(profile.weightKg - goal.targetKg) / effectiveRateKg;
    targetDate = addDays(today, weeksToTarget * 7);
  }

  const shownKcal = Math.round(allowedKcal / 10) * 10;
  return {
    maintenanceKcal,
    allowedKcal: shownKcal,
    dailyChangeKcal,
    floorKcal,
    floorApplied,
    effectiveRateKg,
    weeksToTarget,
    targetDate,
    healthy,
    bmi,
    targetBmi: goal.targetKg ? goal.targetKg / (profile.heightCm / 100) ** 2 : null,
    macros: maintenanceExample(shownKcal, profile.weightKg),
  };
}
