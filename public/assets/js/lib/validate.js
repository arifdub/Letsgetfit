// Input validation and canonical conversion. Raw form values (strings) go in; validated,
// metric values come out. No DOM access here so it can be unit-tested in Node.

import { feetInchesToCm, stonePoundsToKg, roundTo } from './units.js';
import { getActivityLevel, SEX_COEFFICIENTS } from './energy.js';
import { getActivity, MAX_DURATION_MIN } from './activities.js';
import { isValidLocalDate, toLocalDateString } from './dates.js';

export const LIMITS = Object.freeze({
  ageYears: { min: 1, max: 120 },
  heightCm: { min: 120, max: 230 },
  weightKg: { min: 30, max: 300 },
});

// The baseline calculator is limited to the overlap of the populations behind its methods:
// CDC adult BMI categories (20 years and older) and the Mifflin–St Jeor study (19–78 years).
export const ELIGIBLE_AGE = Object.freeze({ min: 20, max: 78 });

/** Parse a user-typed number. Accepts "72.5" and "72,5". Returns NaN for blank or invalid input. */
export function parseNumber(raw) {
  if (typeof raw === 'number') return raw;
  if (typeof raw !== 'string') return NaN;
  const text = raw.trim().replace(',', '.');
  if (text === '' || !/^-?\d+(\.\d+)?$/.test(text)) return NaN;
  return Number(text);
}

function inRange(value, { min, max }) {
  return Number.isFinite(value) && value >= min && value <= max;
}

/** Converts height fields to cm. Returns { value } or { error }. */
export function readHeightCm(raw, units) {
  if (units === 'imperial') {
    const feet = parseNumber(raw.heightFt);
    const inchesRaw = raw.heightIn ?? '';
    const inches = String(inchesRaw).trim() === '' ? 0 : parseNumber(inchesRaw);
    if (!Number.isFinite(feet)) return { error: 'Enter your height in feet.' };
    if (!Number.isInteger(feet) || feet < 0) return { error: 'Feet must be a whole number.' };
    if (!Number.isFinite(inches) || inches < 0 || inches >= 12) return { error: 'Inches must be between 0 and 11.9.' };
    const cm = roundTo(feetInchesToCm(feet, inches), 1);
    if (!inRange(cm, LIMITS.heightCm)) return { error: 'Enter a height between 3 ft 11 in and 7 ft 6 in.' };
    return { value: cm };
  }
  const cm = parseNumber(raw.heightCm);
  if (!Number.isFinite(cm)) return { error: 'Enter your height in centimetres.' };
  if (!inRange(cm, LIMITS.heightCm)) return { error: `Enter a height between ${LIMITS.heightCm.min} and ${LIMITS.heightCm.max} cm.` };
  return { value: roundTo(cm, 1) };
}

/** Converts weight fields to kg. Returns { value } or { error }. */
export function readWeightKg(raw, units) {
  if (units === 'imperial') {
    const stone = parseNumber(raw.weightSt);
    const poundsRaw = raw.weightLb ?? '';
    const pounds = String(poundsRaw).trim() === '' ? 0 : parseNumber(poundsRaw);
    if (!Number.isFinite(stone)) return { error: 'Enter your weight in stone.' };
    if (!Number.isInteger(stone) || stone < 0) return { error: 'Stone must be a whole number.' };
    if (!Number.isFinite(pounds) || pounds < 0 || pounds >= 14) return { error: 'Pounds must be between 0 and 13.9.' };
    const kg = roundTo(stonePoundsToKg(stone, pounds), 1);
    if (!inRange(kg, LIMITS.weightKg)) return { error: 'Enter a weight between 4 st 10 lb and 47 st 3 lb.' };
    return { value: kg };
  }
  const kg = parseNumber(raw.weightKg);
  if (!Number.isFinite(kg)) return { error: 'Enter your weight in kilograms.' };
  if (!inRange(kg, LIMITS.weightKg)) return { error: `Enter a weight between ${LIMITS.weightKg.min} and ${LIMITS.weightKg.max} kg.` };
  return { value: roundTo(kg, 1) };
}

/**
 * Validate the onboarding form.
 * @returns {{ ok: boolean, errors: Record<string,string>, profile: object|null }}
 */
export function validateProfile(raw) {
  const errors = {};
  const units = raw.units === 'imperial' ? 'imperial' : 'metric';

  const age = parseNumber(raw.ageYears);
  if (!Number.isFinite(age)) errors.ageYears = 'Enter your age in years.';
  else if (!Number.isInteger(age)) errors.ageYears = 'Enter your age as a whole number of years.';
  else if (!inRange(age, LIMITS.ageYears)) errors.ageYears = `Enter an age between ${LIMITS.ageYears.min} and ${LIMITS.ageYears.max}.`;

  const height = readHeightCm(raw, units);
  if (height.error) errors.height = height.error;

  const weight = readWeightKg(raw, units);
  if (weight.error) errors.weight = weight.error;

  if (!Object.hasOwn(SEX_COEFFICIENTS, raw.sex)) errors.sex = 'Choose the equation coefficient to use.';
  if (!getActivityLevel(raw.activityLevel)) errors.activityLevel = 'Choose the activity level closest to a usual week.';
  if (raw.pregnancy !== 'yes' && raw.pregnancy !== 'no') errors.pregnancy = 'Answer yes or no.';

  if (Object.keys(errors).length > 0) return { ok: false, errors, profile: null };

  return {
    ok: true,
    errors: {},
    profile: {
      units,
      ageYears: age,
      heightCm: height.value,
      weightKg: weight.value,
      sex: raw.sex,
      activityLevel: raw.activityLevel,
      pregnantOrBreastfeeding: raw.pregnancy === 'yes',
    },
  };
}

/**
 * Decide whether the baseline calculator applies.
 * @returns {{ eligible: boolean, reason: string|null }}
 */
export function checkEligibility(profile) {
  if (!profile) return { eligible: false, reason: 'missing' };
  if (profile.pregnantOrBreastfeeding) return { eligible: false, reason: 'pregnancy' };
  if (profile.ageYears < ELIGIBLE_AGE.min) return { eligible: false, reason: 'under-age' };
  if (profile.ageYears > ELIGIBLE_AGE.max) return { eligible: false, reason: 'over-age' };
  return { eligible: true, reason: null };
}

function validateLocalDate(value, today) {
  if (!isValidLocalDate(value)) return 'Enter a valid date.';
  if (value > today) return 'The date cannot be in the future.';
  if (value < '1900-01-01') return 'Enter a date after 1900.';
  return null;
}

export function validateWorkout(raw, today = toLocalDateString()) {
  const errors = {};
  const dateError = validateLocalDate(raw.localDate, today);
  if (dateError) errors.localDate = dateError;
  const activity = getActivity(raw.activityId);
  if (!activity) errors.activityId = 'Choose an activity type.';
  const duration = parseNumber(raw.durationMin);
  if (!Number.isFinite(duration)) errors.durationMin = 'Enter the duration in minutes.';
  else if (!Number.isInteger(duration) || duration < 1 || duration > MAX_DURATION_MIN)
    errors.durationMin = `Enter a whole number of minutes from 1 to ${MAX_DURATION_MIN}.`;
  const notes = typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 200) : '';
  if (Object.keys(errors).length > 0) return { ok: false, errors, value: null };
  return {
    ok: true,
    errors: {},
    value: { localDate: raw.localDate, activityId: activity.id, durationMin: duration, notes, showEstimate: Boolean(raw.showEstimate) },
  };
}

export function validateWeightEntry(raw, units, today = toLocalDateString()) {
  const errors = {};
  const dateError = validateLocalDate(raw.localDate, today);
  if (dateError) errors.localDate = dateError;
  const weight = readWeightKg(raw, units === 'imperial' ? 'imperial' : 'metric');
  if (weight.error) errors.weight = weight.error;
  const notes = typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 200) : '';
  if (Object.keys(errors).length > 0) return { ok: false, errors, value: null };
  return { ok: true, errors: {}, value: { localDate: raw.localDate, weightKg: weight.value, notes } };
}
