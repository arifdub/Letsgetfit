// Body mass index and the CDC adult screening categories.
//
// BMI = weight (kg) / height (m)²
// Categories: US Centers for Disease Control and Prevention, "Adult BMI Categories",
//   for adults aged 20 and older, regardless of sex:
//   Underweight        < 18.5
//   Healthy weight     18.5 to < 25
//   Overweight         25 to < 30
//   Obesity            ≥ 30, subdivided into
//     Class 1          30 to < 35
//     Class 2          35 to < 40
//     Class 3          ≥ 40 (severe obesity)
// BMI is a screening measure. It does not measure body fat, fitness or overall health.
//
// The category is assigned from the BMI rounded to one decimal place, which is the value
// shown to the user, so the label always matches the number on screen.

import { roundTo } from './units.js';

export const BMI_MIN_AGE = 20;

export const BMI_CATEGORIES = Object.freeze([
  { id: 'underweight', label: 'Underweight', min: -Infinity, max: 18.5 },
  { id: 'healthy', label: 'Healthy weight', min: 18.5, max: 25 },
  { id: 'overweight', label: 'Overweight', min: 25, max: 30 },
  { id: 'obesity-1', label: 'Obesity, class 1', min: 30, max: 35 },
  { id: 'obesity-2', label: 'Obesity, class 2', min: 35, max: 40 },
  { id: 'obesity-3', label: 'Obesity, class 3', min: 40, max: Infinity },
]);

export function calculateBmi(weightKg, heightCm) {
  if (!Number.isFinite(weightKg) || weightKg <= 0) throw new RangeError('weightKg must be positive');
  if (!Number.isFinite(heightCm) || heightCm <= 0) throw new RangeError('heightCm must be positive');
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** Returns the CDC category for a displayed (one-decimal) BMI value, or null below age 20. */
export function bmiCategory(bmi, ageYears) {
  if (!Number.isFinite(bmi)) return null;
  if (!Number.isFinite(ageYears) || ageYears < BMI_MIN_AGE) return null;
  const shown = roundTo(bmi, 1);
  return BMI_CATEGORIES.find((c) => shown >= c.min && shown < c.max) ?? null;
}
