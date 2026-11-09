import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBmi, bmiCategory } from '../../public/assets/js/lib/bmi.js';

const close = (actual, expected, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

test('BMI = kg / m²', () => {
  close(calculateBmi(80, 180), 24.691358024691358);
  close(calculateBmi(65, 165), 23.875114784205696);
  close(calculateBmi(100, 200), 25);
});

test('CDC boundaries: lower bound is inclusive, upper bound is exclusive', () => {
  const cases = [
    [18.4, 'underweight'],
    [18.5, 'healthy'],
    [24.9, 'healthy'],
    [25.0, 'overweight'],
    [29.9, 'overweight'],
    [30.0, 'obesity-1'],
    [34.9, 'obesity-1'],
    [35.0, 'obesity-2'],
    [39.9, 'obesity-2'],
    [40.0, 'obesity-3'],
    [55.0, 'obesity-3'],
    [12.0, 'underweight'],
  ];
  for (const [bmi, id] of cases) assert.equal(bmiCategory(bmi, 30)?.id, id, `BMI ${bmi}`);
});

test('category follows the one-decimal value the user sees', () => {
  // 24.96 is shown as 25.0, so it is labelled overweight, matching the number on screen.
  assert.equal(bmiCategory(24.96, 40).id, 'overweight');
  assert.equal(bmiCategory(24.94, 40).id, 'healthy');
  assert.equal(bmiCategory(18.45, 40).id, 'healthy');
  assert.equal(bmiCategory(18.44, 40).id, 'underweight');
});

test('adult categories are not applied under age 20', () => {
  assert.equal(bmiCategory(22, 19), null);
  assert.equal(bmiCategory(22, 20).id, 'healthy');
  assert.equal(bmiCategory(22, undefined), null);
});

test('invalid inputs are rejected', () => {
  assert.throws(() => calculateBmi(0, 170), RangeError);
  assert.throws(() => calculateBmi(70, NaN), RangeError);
  assert.equal(bmiCategory(NaN, 30), null);
});
