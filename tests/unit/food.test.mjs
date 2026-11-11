import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NUTRIENT_KEYS,
  convertUnit,
  normaliseNutrients,
  scaleNutrients,
  sumNutrients,
  CANONICAL_UNITS,
} from '../../public/assets/js/lib/nutrients.js';
import {
  combineFoods,
  mealName,
  validateCustomFood,
  validateDiaryEntry,
  buildDiaryEntry,
  rescaleEntry,
  foodFromApi,
  findDuplicate,
  foodIdentity,
  detectPreparation,
  normaliseName,
} from '../../public/assets/js/lib/food.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

test('canonical units are explicit for every nutrient', () => {
  assert.deepEqual(CANONICAL_UNITS, {
    energy: 'kcal', protein: 'g', carbohydrate: 'g', fat: 'g', fibre: 'g',
    iron: 'mg', calcium: 'mg', potassium: 'mg', vitaminD: 'µg', vitaminB12: 'µg',
  });
});

test('unit conversion: mass and energy, incompatible units refused', () => {
  close(convertUnit(1, 'g', 'mg'), 1000);
  close(convertUnit(2500, 'µg', 'mg'), 2.5);
  close(convertUnit(3, 'mcg', 'µg'), 3);
  close(convertUnit(3, 'μg', 'µg'), 3); // Greek mu
  close(convertUnit(418.4, 'kJ', 'kcal'), 100);
  close(convertUnit(100, 'kcal', 'kj'), 418.4);
  assert.equal(convertUnit(1, 'g', 'kcal'), null);
  assert.equal(convertUnit(1, 'IU', 'µg'), null);
  assert.equal(convertUnit(null, 'g', 'mg'), null);
});

test('normaliseNutrients converts units and turns bad values into unknown (null)', () => {
  const n = normaliseNutrients(
    { energy: 1046, protein: '3.4', fat: -1, carbohydrate: 'abc', iron: 0.0012, vitaminD: 1.1, calcium: 99999, extra: 5 },
    { energy: 'kJ', protein: 'g', iron: 'g', vitaminD: 'µg', calcium: 'mg' },
  );
  close(n.energy, 1046 / 4.184);
  assert.equal(n.protein, 3.4);
  assert.equal(n.fat, null);
  assert.equal(n.carbohydrate, null);
  close(n.iron, 1.2);
  assert.equal(n.vitaminD, 1.1);
  assert.equal(n.calcium, null); // implausible
  assert.equal(n.fibre, null); // missing
  assert.ok(!('extra' in n));
});

test('scaling per 100 g to a serving keeps unknown as unknown', () => {
  const per100g = { ...normaliseNutrients({}), energy: 52, protein: 0.3, fibre: null };
  const s = scaleNutrients(per100g, 150);
  close(s.energy, 78);
  close(s.protein, 0.45);
  assert.equal(s.fibre, null);
  assert.equal(s.iron, null);
});

test('sum flags incomplete totals per nutrient', () => {
  const entries = [
    { nutrients: { ...scaleNutrients({ energy: 100, protein: 10, iron: 1 }, 100) } },
    { nutrients: { ...scaleNutrients({ energy: 200, protein: null, iron: null }, 50) } },
  ];
  const { totals, missing, count } = sumNutrients(entries);
  assert.equal(count, 2);
  close(totals.energy, 200);
  close(totals.protein, 10);
  assert.equal(missing.energy, 0);
  assert.equal(missing.protein, 1);
  assert.equal(missing.iron, 1);
  assert.equal(missing.calcium, 2);
  assert.deepEqual(sumNutrients([]).count, 0);
});

const customRaw = {
  name: '  Brown   soda bread ',
  brand: '',
  kind: 'generic',
  preparation: 'cooked',
  n_energy: '230',
  n_protein: '8,5',
  n_carbohydrate: '40',
  n_fat: '3',
  n_fibre: '',
  n_iron: '2.1',
  servingG: '40',
};

test('custom food: blank nutrients are unknown, commas accepted, units attached', () => {
  const r = validateCustomFood(customRaw);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.name, 'Brown soda bread');
  assert.equal(r.value.per100g.protein, 8.5);
  assert.equal(r.value.per100g.fibre, null);
  assert.equal(r.value.per100g.calcium, null);
  assert.deepEqual(r.value.nutrientUnits, CANONICAL_UNITS);
  assert.deepEqual(r.value.servingOptions, [{ label: '1 serving', grams: 40 }]);
  assert.equal(r.value.source, 'custom');
});

test('custom food validation errors', () => {
  const bad = (patch) => validateCustomFood({ ...customRaw, ...patch }).errors;
  assert.ok(bad({ name: 'a' }).name);
  assert.ok(bad({ kind: 'branded', brand: '' }).brand);
  assert.ok(bad({ n_energy: '-5' }).n_energy);
  assert.ok(bad({ n_energy: '5000' }).n_energy);
  assert.ok(bad({ n_fat: 'lots' }).n_fat);
  assert.ok(bad({ n_protein: '50', n_carbohydrate: '50', n_fat: '10' }).n_protein);
  assert.ok(bad({ servingG: '0' }).servingG);
  const empty = Object.fromEntries(NUTRIENT_KEYS.map((k) => [`n_${k}`, '']));
  assert.ok(bad(empty).n_energy, 'needs at least one value');
});

test('diary entry validation', () => {
  const today = '2026-11-09';
  assert.deepEqual(validateDiaryEntry({ localDate: today, meal: 'lunch', servingG: '125,5' }, today).value, { localDate: today, meal: 'lunch', servingG: 125.5 });
  const r = validateDiaryEntry({ localDate: '2026-11-10', meal: 'brunch', servingG: '0' }, today);
  assert.deepEqual(Object.keys(r.errors).sort(), ['localDate', 'meal', 'servingG']);
  assert.ok(validateDiaryEntry({ localDate: today, meal: 'lunch', servingG: '' }, today).errors.servingG);
  assert.ok(validateDiaryEntry({ localDate: today, meal: 'lunch', servingG: '5001' }, today).errors.servingG);
});

test('diary entry snapshot does not change when the library food changes', () => {
  const food = { id: 'f1', ...validateCustomFood(customRaw).value };
  const entry = buildDiaryEntry(food, { localDate: '2026-11-09', meal: 'breakfast', servingG: 80 });
  close(entry.nutrients.energy, 184);
  close(entry.nutrients.protein, 6.8);
  assert.equal(entry.nutrients.fibre, null);
  assert.equal(entry.source, 'custom');
  assert.deepEqual(entry.nutrientUnits, CANONICAL_UNITS);
  // Library changes later…
  food.per100g.energy = 999;
  assert.equal(entry.per100g.energy, 230);
  // …editing grams uses the entry's own snapshot.
  const edited = rescaleEntry(entry, 40);
  close(edited.nutrients.energy, 92);
});

test('full daily-total flow across meals', () => {
  const bread = { id: 'b', ...validateCustomFood(customRaw).value };
  const apple = { id: 'a', ...validateCustomFood({ name: 'Apple', kind: 'generic', preparation: 'raw', n_energy: '52', n_protein: '0.3', n_carbohydrate: '13.8', n_fat: '0.2', n_fibre: '2.4' }).value };
  const day = [
    buildDiaryEntry(bread, { localDate: '2026-11-09', meal: 'breakfast', servingG: 80 }),
    buildDiaryEntry(apple, { localDate: '2026-11-09', meal: 'snacks', servingG: 150 }),
  ];
  const { totals, missing } = sumNutrients(day);
  close(totals.energy, 184 + 78);
  close(totals.fibre, 3.6);
  assert.equal(missing.fibre, 1); // bread's fibre unknown -> incomplete
  assert.equal(missing.energy, 0);
});

test('API results are re-validated in the browser', () => {
  const good = foodFromApi({
    source: 'usda-fdc', sourceId: '171688', name: 'Apples, fuji, with skin, raw', kind: 'generic',
    per100g: { energy: 63, protein: 0.15, vitaminD: 0 }, nutrientUnits: CANONICAL_UNITS,
    servingOptions: [{ label: '1 medium', grams: 200 }, { label: 'bad', grams: -1 }],
  });
  assert.equal(good.preparation, 'raw');
  assert.equal(good.per100g.energy, 63);
  assert.equal(good.per100g.fibre, null);
  assert.deepEqual(good.servingOptions, [{ label: '1 medium', grams: 200 }]);
  assert.equal(foodFromApi({ source: 'evil', sourceId: '1', name: 'x' }), null);
  assert.equal(foodFromApi({ source: 'usda-fdc', sourceId: '../../etc', name: 'x' }), null);
  assert.equal(foodFromApi(null), null);
});

test('duplicates: same source ID, or same custom name/brand/preparation', () => {
  const foods = [
    { id: '1', source: 'usda-fdc', sourceId: '171688', name: 'Apples' },
    { id: '2', source: 'custom', name: 'Brown Soda Bread', brand: null, preparation: 'cooked' },
  ];
  assert.equal(findDuplicate(foods, { source: 'usda-fdc', sourceId: '171688', name: 'Different name' }).id, '1');
  assert.equal(findDuplicate(foods, { source: 'custom', name: 'brown soda-bread', preparation: 'cooked' }).id, '2');
  assert.equal(findDuplicate(foods, { source: 'custom', name: 'brown soda bread', preparation: 'raw' }), null);
  assert.equal(findDuplicate(foods, { source: 'custom', name: 'Brown Soda Bread', preparation: 'cooked' }, { ignoreId: '2' }), null);
  assert.notEqual(foodIdentity({ source: 'custom', name: 'Oats', brand: 'Flahavans' }), foodIdentity({ source: 'custom', name: 'Oats' }));
});

test('raw / cooked detection and name normalisation', () => {
  assert.equal(detectPreparation('Chicken breast, raw'), 'raw');
  assert.equal(detectPreparation('Rice, white, long-grain, cooked'), 'cooked');
  assert.equal(detectPreparation('Potatoes, boiled'), 'cooked');
  assert.equal(detectPreparation('Cheddar cheese'), 'unspecified');
  assert.equal(normaliseName('  Crème   Fraîche! '), 'creme fraiche');
});

test('AI estimate from the server becomes a clearly named own food with only the five estimated nutrients', () => {
  const food = foodFromApi({ source: 'ai-estimate', sourceId: 'ai-0123456789abcdef', name: 'Homemade granola', preparation: 'cooked', per100g: { energy: 450, protein: 10, carbohydrate: 62, fat: 17, fibre: 7, iron: 99 } });
  assert.deepEqual([food.source, food.sourceId, food.name, food.preparation, food.estimated], ['custom', null, 'Homemade granola (AI estimate)', 'cooked', true]);
  assert.deepEqual([food.per100g.energy, food.per100g.fibre, food.per100g.iron], [450, 7, null]);
  assert.equal(foodFromApi({ source: 'ai-estimate', name: 'x', per100g: { protein: 3 } }), null, 'no energy, no estimate');
  assert.equal(foodFromApi({ source: 'ai-estimate', name: 'x', per100g: { energy: 5000 } }), null, 'implausible energy');
  assert.equal(foodFromApi({ source: 'ai-estimate', name: '', per100g: { energy: 50 } }), null);
  assert.ok(foodFromApi({ source: 'ai-estimate', name: 'n'.repeat(200), per100g: { energy: 50 } }).name.length <= 80);
});

test('a meal saved as one food: per 100 g of the whole meal, one serving is the meal', () => {
  const apple = { per100g: { energy: 52, protein: 0.3, iron: 0.1 } };
  const granola = { per100g: { energy: 450, protein: 10, iron: null } };
  const meal = combineFoods('  Apple and granola  ', [{ food: apple, grams: 120 }, { food: granola, grams: 60 }]);
  assert.deepEqual([meal.source, meal.name, meal.servingOptions], ['custom', 'Apple and granola', [{ label: '1 meal', grams: 180 }]]);
  assert.equal(meal.per100g.energy, 184.67); // (62.4 + 270) / 180 × 100
  assert.equal(Math.round((meal.per100g.energy * 180) / 100), 332);
  assert.equal(meal.per100g.iron, 0.07, 'known from one part only');
  assert.equal(meal.per100g.calcium, null, 'unknown in every part stays unknown');
  assert.equal(combineFoods('x', [{ food: apple, grams: 100 }]), null, 'needs a name');
  assert.equal(combineFoods('Meal', []), null);
  assert.equal(combineFoods('Meal', [{ food: apple, grams: 6000 }]), null, 'over the serving limit');
  assert.equal(mealName(['Plain yogurt', 'Granola (AI estimate)', 'Blueberries']), 'Plain yogurt, Granola, Blueberries');
  assert.equal(mealName(['a', 'b', 'c', 'd', 'e']), 'a, b, c, d and more');
  assert.ok(mealName(['x'.repeat(70), 'y'.repeat(70)]).length <= 80);
});
