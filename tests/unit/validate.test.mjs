import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProfile,
  checkEligibility,
  validateWorkout,
  validateWeightEntry,
  parseNumber,
  ELIGIBLE_AGE,
} from '../../public/assets/js/lib/validate.js';

const metric = {
  units: 'metric',
  ageYears: '30',
  heightCm: '180',
  weightKg: '80',
  sex: 'male',
  activityLevel: 'moderate',
  pregnancy: 'no',
};

test('parseNumber accepts dot and comma decimals and rejects junk', () => {
  assert.equal(parseNumber('72.5'), 72.5);
  assert.equal(parseNumber(' 72,5 '), 72.5);
  assert.ok(Number.isNaN(parseNumber('')));
  assert.ok(Number.isNaN(parseNumber('   ')));
  assert.ok(Number.isNaN(parseNumber('72kg')));
  assert.ok(Number.isNaN(parseNumber('1e3')));
  assert.ok(Number.isNaN(parseNumber(undefined)));
});

test('valid metric profile is accepted and stored in metric', () => {
  const r = validateProfile(metric);
  assert.equal(r.ok, true);
  assert.deepEqual(r.profile, {
    units: 'metric',
    ageYears: 30,
    heightCm: 180,
    weightKg: 80,
    sex: 'male',
    activityLevel: 'moderate',
    pregnantOrBreastfeeding: false,
  });
});

test('imperial profile is converted once to metric', () => {
  const r = validateProfile({
    ...metric,
    units: 'imperial',
    heightCm: '',
    weightKg: '',
    heightFt: '5',
    heightIn: '9',
    weightSt: '12',
    weightLb: '8',
  });
  assert.equal(r.ok, true);
  assert.equal(r.profile.heightCm, 175.3);
  assert.equal(r.profile.weightKg, 79.8);
  assert.equal(r.profile.units, 'imperial');
});

test('imperial inches and pounds may be left blank', () => {
  const r = validateProfile({ ...metric, units: 'imperial', heightFt: '6', heightIn: '', weightSt: '11', weightLb: '' });
  assert.equal(r.ok, true);
  assert.equal(r.profile.heightCm, 182.9);
  assert.equal(r.profile.weightKg, 69.9);
});

test('missing values produce a message for every field', () => {
  const r = validateProfile({});
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['activityLevel', 'ageYears', 'height', 'pregnancy', 'sex', 'weight']);
  assert.equal(r.profile, null);
});

test('out-of-range and malformed values are rejected', () => {
  const bad = (patch) => validateProfile({ ...metric, ...patch });
  assert.ok(bad({ ageYears: '30.5' }).errors.ageYears);
  assert.ok(bad({ ageYears: '0' }).errors.ageYears);
  assert.ok(bad({ ageYears: '121' }).errors.ageYears);
  assert.ok(bad({ heightCm: '119' }).errors.height);
  assert.ok(bad({ heightCm: '231' }).errors.height);
  assert.ok(bad({ heightCm: 'tall' }).errors.height);
  assert.ok(bad({ weightKg: '29' }).errors.weight);
  assert.ok(bad({ weightKg: '301' }).errors.weight);
  assert.ok(bad({ weightKg: '-70' }).errors.weight);
  assert.ok(bad({ sex: 'unknown' }).errors.sex);
  assert.ok(bad({ activityLevel: 'couch' }).errors.activityLevel);
  assert.ok(bad({ pregnancy: '' }).errors.pregnancy);
  assert.ok(bad({ units: 'imperial', heightFt: '5', heightIn: '12', weightSt: '11' }).errors.height);
  assert.ok(bad({ units: 'imperial', heightFt: '5.5', weightSt: '11' }).errors.height);
  assert.ok(bad({ units: 'imperial', heightFt: '5', weightSt: '11', weightLb: '14' }).errors.weight);
  // Limits are inclusive.
  assert.equal(bad({ heightCm: '120', weightKg: '30' }).ok, true);
  assert.equal(bad({ heightCm: '230', weightKg: '300' }).ok, true);
});

test('eligibility: adults 20–78 who are not pregnant or breastfeeding', () => {
  const p = (patch) => ({ ...validateProfile(metric).profile, ...patch });
  assert.deepEqual(ELIGIBLE_AGE, { min: 20, max: 78 });
  assert.equal(checkEligibility(p({ ageYears: 19 })).reason, 'under-age');
  assert.equal(checkEligibility(p({ ageYears: 20 })).eligible, true);
  assert.equal(checkEligibility(p({ ageYears: 78 })).eligible, true);
  assert.equal(checkEligibility(p({ ageYears: 79 })).reason, 'over-age');
  assert.equal(checkEligibility(p({ pregnantOrBreastfeeding: true })).reason, 'pregnancy');
  assert.equal(checkEligibility(null).reason, 'missing');
});

test('workout validation', () => {
  const today = '2026-11-09';
  const ok = validateWorkout({ localDate: '2026-11-09', activityId: 'walk-brisk', durationMin: '30', notes: '  lunch walk ' }, today);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { localDate: '2026-11-09', activityId: 'walk-brisk', durationMin: 30, notes: 'lunch walk', showEstimate: false });
  const bad = validateWorkout({ localDate: '2026-11-10', activityId: 'nope', durationMin: '0' }, today);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['activityId', 'durationMin', 'localDate']);
  assert.ok(validateWorkout({ localDate: '2026-02-30', activityId: 'yoga', durationMin: '20' }, today).errors.localDate);
  assert.ok(validateWorkout({ localDate: '2026-11-01', activityId: 'yoga', durationMin: '601' }, today).errors.durationMin);
  assert.ok(validateWorkout({ localDate: '2026-11-01', activityId: 'yoga', durationMin: '12.5' }, today).errors.durationMin);
});

test('weight entry validation converts imperial to kg', () => {
  const today = '2026-11-09';
  const m = validateWeightEntry({ localDate: '2026-11-08', weightKg: '81,4' }, 'metric', today);
  assert.equal(m.value.weightKg, 81.4);
  const i = validateWeightEntry({ localDate: '2026-11-08', weightSt: '12', weightLb: '8' }, 'imperial', today);
  assert.equal(i.value.weightKg, 79.8);
  assert.ok(validateWeightEntry({ localDate: '', weightKg: '80' }, 'metric', today).errors.localDate);
  assert.ok(validateWeightEntry({ localDate: '2026-11-08', weightKg: '' }, 'metric', today).errors.weight);
});
