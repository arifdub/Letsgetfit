// Browser smoke tests for Phase 1, run against the static server with Playwright.
// Usage: node tests/e2e/smoke.mjs
// Uses the `playwright` package (devDependency); in CI run `npx playwright install --with-deps chromium` first.

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { startServer } from '../../scripts/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  FAIL ${name}\n       ${error.message.split('\n').join('\n       ')}`);
  }
}

const server = await startServer(0);
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();

// Mocked server API. Production has PHP; the local static server does not.
const UNITS = { energy: 'kcal', protein: 'g', carbohydrate: 'g', fat: 'g', fibre: 'g', iron: 'mg', calcium: 'mg', potassium: 'mg', vitaminD: 'µg', vitaminB12: 'µg' };
const API_FOODS = [
  {
    source: 'usda-fdc', sourceId: '171688', name: 'Apples, raw, with skin', brand: null, kind: 'generic', dataType: 'SR Legacy', preparation: 'raw', basis: '100g',
    per100g: { energy: 52, protein: 0.26, carbohydrate: 13.81, fat: 0.17, fibre: 2.4, iron: 0.12, calcium: 6, potassium: 107, vitaminD: 0, vitaminB12: 0 },
    nutrientUnits: UNITS, servingOptions: [],
  },
  {
    source: 'usda-fdc', sourceId: '2345678', name: 'Cloudy Apple Juice', brand: 'Example Orchards Ltd', kind: 'branded', dataType: 'Branded', preparation: 'unspecified', basis: '100ml',
    per100g: { energy: 46, protein: 0, carbohydrate: 11.2, fat: 0, fibre: null, iron: null, calcium: null, potassium: null, vitaminD: 1, vitaminB12: null },
    nutrientUnits: UNITS, servingOptions: [{ label: '1 glass', grams: 250 }],
  },
];

async function mockApi(page, { health = 'configured', search } = {}) {
  await page.route('**/api/health.php', (route) =>
    health === 'down'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"not_configured"}' })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, php: '8.3', foodSearch: health }) }),
  );
  await page.route('**/api/foods.php?*', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q');
    if (search) return search(route, q);
    const results = q.toLowerCase().includes('apple') ? API_FOODS : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results, attribution: 'USDA FoodData Central', cached: false }) });
  });
}

async function freshPage(options = {}, api = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...options });
  const page = await context.newPage();
  await mockApi(page, api);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(BASE);
  await page.waitForSelector('html[data-ready="true"]');
  return { page, context, errors };
}

async function fillMetric(page, { age = '30', height = '180', weight = '80', sex = 'male', activity = 'moderate', pregnancy = 'no' } = {}) {
  await page.fill('#ageYears', age);
  await page.fill('#heightCm', height);
  await page.fill('#weightKg', weight);
  if (sex) await page.check(`input[name="sex"][value="${sex}"]`);
  if (activity) await page.check(`input[name="activityLevel"][value="${activity}"]`);
  if (pregnancy) await page.check(`input[name="pregnancy"][value="${pregnancy}"]`);
  await page.click('#profile-form button[type="submit"]');
}

console.log(`Smoke tests against ${BASE}`);

await check('loads without errors and shows only working navigation', async () => {
  const { page, context, errors } = await freshPage();
  const nav = await page.locator('.primary-nav a').allTextContents();
  assert.deepEqual(nav.map((t) => t.trim()), ['Overview', 'Food', 'Workouts', 'Progress', 'Settings']);
  assert.equal(await page.locator('#profile-form').isVisible(), true);
  assert.equal(await page.getAttribute('html', 'lang'), 'en-IE');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('missing values show an error summary and inline errors', async () => {
  const { page, context } = await freshPage();
  await page.click('#profile-form button[type="submit"]');
  await page.waitForSelector('#profile-errors:not([hidden])');
  const items = await page.locator('#profile-errors li').count();
  assert.equal(items, 6);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'profile-errors');
  assert.equal(await page.getAttribute('#ageYears', 'aria-invalid'), 'true');
  await context.close();
});

await check('invalid values are rejected', async () => {
  const { page, context } = await freshPage();
  await fillMetric(page, { age: '30.5', height: '90', weight: 'abc' });
  await page.waitForSelector('#profile-errors:not([hidden])');
  assert.match(await page.textContent('#ageYears-error'), /whole number/);
  assert.match(await page.textContent('#height-error'), /between 120 and 230/);
  assert.match(await page.textContent('#weight-error'), /kilograms/);
  await context.close();
});

await check('calculates representative estimates (30 y, 180 cm, 80 kg, male, moderate)', async () => {
  const { page, context, errors } = await freshPage();
  await fillMetric(page);
  await page.waitForSelector('#stat-ree');
  assert.match(await page.textContent('#stat-ree .stat__value'), /1,780 kcal/);
  assert.match(await page.textContent('#stat-maintenance .stat__value'), /3,290 kcal/);
  assert.match(await page.textContent('#stat-bmi .stat__value'), /24\.7/);
  assert.match(await page.textContent('#stat-bmi .stat__sub'), /Healthy weight/);
  // 3290 kcal: protein 15 % = 123 g; fat 30 % = 110 g; fibre 25 g; carbohydrate (3290−493.5−987−50)/4 = 440 g
  assert.match(await page.textContent('tr[data-nutrient="protein"]'), /123 g/);
  assert.match(await page.textContent('tr[data-nutrient="fat"]'), /110 g/);
  assert.match(await page.textContent('tr[data-nutrient="carbohydrate"]'), /440 g/);
  assert.match(await page.textContent('tr[data-nutrient="fibre"]'), /25 g/);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('BMI boundary: 25.0 is shown as overweight', async () => {
  const { page, context } = await freshPage();
  await fillMetric(page, { height: '200', weight: '100', sex: 'female', activity: 'light' });
  await page.waitForSelector('#stat-bmi');
  assert.match(await page.textContent('#stat-bmi .stat__value'), /^25$/);
  assert.match(await page.textContent('#stat-bmi .stat__sub'), /Overweight/);
  await context.close();
});

await check('age and pregnancy eligibility messages replace the estimates', async () => {
  const { page, context } = await freshPage();
  await fillMetric(page, { age: '19' });
  await page.waitForSelector('#overview-results .notice');
  assert.match(await page.textContent('#overview-results'), /adults aged 20 and over/);
  assert.equal(await page.locator('#stat-ree').count(), 0);
  await page.click('text=Edit my details');
  await page.fill('#ageYears', '79');
  await page.click('#profile-form button[type="submit"]');
  await page.waitForSelector('#overview-results .notice');
  assert.match(await page.textContent('#overview-results'), /not shown above age 78/);
  await page.click('text=Edit my details');
  await page.fill('#ageYears', '35');
  await page.check('input[name="pregnancy"][value="yes"]');
  await page.click('#profile-form button[type="submit"]');
  await page.waitForSelector('#overview-results .notice');
  assert.match(await page.textContent('#overview-results'), /pregnancy or breastfeeding/);
  assert.equal(await page.locator('#stat-ree').count(), 0);
  await context.close();
});

await check('imperial input converts once and the profile persists after reload', async () => {
  const { page, context } = await freshPage();
  await page.check('input[name="units"][value="imperial"]');
  await page.fill('#ageYears', '40');
  await page.fill('#heightFt', '5');
  await page.fill('#heightIn', '9');
  await page.fill('#weightSt', '12');
  await page.fill('#weightLb', '8');
  await page.check('input[name="sex"][value="female"]');
  await page.check('input[name="activityLevel"][value="light"]');
  await page.check('input[name="pregnancy"][value="no"]');
  await page.click('#profile-form button[type="submit"]');
  await page.waitForSelector('#stat-ree');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('letsgetfit.data')));
  assert.equal(stored.profile.heightCm, 175.3);
  assert.equal(stored.profile.weightKg, 79.8);
  assert.equal(stored.preferences.units, 'imperial');
  // REE = 798 + 1095.625 − 200 − 161 = 1532.6 -> 1,530; × 1.55 = 2375.6 -> 2,380
  assert.match(await page.textContent('#stat-ree .stat__value'), /1,530 kcal/);
  assert.match(await page.textContent('#stat-maintenance .stat__value'), /2,380 kcal/);
  await page.reload();
  await page.waitForSelector('#stat-ree');
  assert.match(await page.textContent('.based-on'), /5 ft 9 in · 12 st 8 lb/);
  await context.close();
});

await check('workouts: add, estimate, edit, delete, and persist after reload', async () => {
  const { page, context, errors } = await freshPage();
  await fillMetric(page);
  await page.waitForSelector('#stat-ree');
  const before = await page.textContent('#stat-maintenance .stat__value');
  await page.click('.primary-nav a[data-route="workouts"]');
  await page.waitForSelector('#view-workouts:not([hidden])');
  assert.match(await page.textContent('#workout-list'), /No workouts yet/);
  await page.selectOption('#workout-activity', 'walk-moderate');
  await page.fill('#workout-duration', '30');
  await page.check('#workout-estimate');
  await page.click('#workout-submit');
  await page.waitForSelector('#workout-list .entry');
  // (3.5 − 1) × 80 kg × 0.5 h = 100 kcal
  assert.match(await page.textContent('#workout-list .entry'), /About 100 kcal active energy/);
  await page.reload();
  await page.click('.primary-nav a[data-route="workouts"]');
  await page.waitForSelector('#workout-list .entry');
  await page.click('#workout-list .entry button:has-text("Edit")');
  assert.equal(await page.textContent('#workout-submit'), 'Save changes');
  await page.fill('#workout-duration', '45');
  await page.click('#workout-submit');
  await page.waitForFunction(() => document.querySelector('#workout-list .entry')?.textContent.includes('45 min'));
  assert.match(await page.textContent('#workout-list .entry'), /About 150 kcal/);
  // Logged workouts are not added to maintenance.
  await page.click('.primary-nav a[data-route="overview"]');
  assert.equal(await page.textContent('#stat-maintenance .stat__value'), before);
  await page.click('.primary-nav a[data-route="workouts"]');
  await page.click('#workout-list .entry button:has-text("Delete")');
  await page.waitForSelector('#confirm-dialog[open]');
  await page.click('#confirm-ok');
  await page.waitForSelector('#workout-list .state--empty');
  await page.reload();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('letsgetfit.data')));
  assert.equal(stored.workouts.length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('workout validation rejects a future date and missing duration', async () => {
  const { page, context } = await freshPage();
  await page.goto(`${BASE}#workouts`);
  await page.waitForSelector('#view-workouts:not([hidden])');
  await page.fill('#workout-date', '2999-01-01');
  await page.click('#workout-submit');
  await page.waitForSelector('#workout-errors:not([hidden])');
  assert.match(await page.textContent('#workout-localDate-error'), /future/);
  assert.match(await page.textContent('#workout-durationMin-error'), /minutes/);
  assert.match(await page.textContent('#workout-activityId-error'), /activity/);
  await context.close();
});

await check('weight log: add, edit, delete, persist, and update calculator weight', async () => {
  const { page, context } = await freshPage();
  await fillMetric(page);
  await page.waitForSelector('#stat-ree');
  await page.click('.primary-nav a[data-route="progress"]');
  await page.fill('#log-weightKg', '79,4');
  await page.click('#weight-submit');
  await page.waitForSelector('#weight-list .entry');
  assert.match(await page.textContent('#weight-list .entry'), /79\.4 kg/);
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('letsgetfit.data')));
  assert.equal(stored.profile.weightKg, 79.4);
  await page.reload();
  await page.click('.primary-nav a[data-route="progress"]');
  await page.click('#weight-list .entry button:has-text("Edit")');
  await page.fill('#log-weightKg', '79.0');
  await page.click('#weight-submit');
  await page.waitForFunction(() => document.querySelector('#weight-list .entry')?.textContent.includes('79 kg'));
  await page.click('#weight-list .entry button:has-text("Delete")');
  await page.click('#confirm-ok');
  await page.waitForSelector('#weight-list .state--empty');
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('letsgetfit.data')));
  assert.equal(stored.weights.length, 0);
  await context.close();
});

await check('cancelling a delete keeps the entry', async () => {
  const { page, context } = await freshPage();
  await page.goto(`${BASE}#progress`);
  await page.fill('#log-weightKg', '70');
  await page.click('#weight-submit');
  await page.waitForSelector('#weight-list .entry');
  await page.click('#weight-list .entry button:has-text("Delete")');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#confirm-dialog', { state: 'hidden' });
  assert.equal(await page.locator('#weight-list .entry').count(), 1);
  await context.close();
});

await check('settings: unit switch and clear all data', async () => {
  const { page, context } = await freshPage();
  await fillMetric(page);
  await page.waitForSelector('#stat-ree');
  await page.click('.primary-nav a[data-route="settings"]');
  await page.check('input[name="settings-units"][value="imperial"]');
  await page.click('.primary-nav a[data-route="overview"]');
  assert.match(await page.textContent('.based-on'), /5 ft 11 in · 12 st 8 lb/);
  await page.click('.primary-nav a[data-route="settings"]');
  assert.match(await page.textContent('#data-counts'), /Saved/);
  await page.click('#clear-data');
  await page.click('#confirm-ok');
  await page.waitForFunction(() => document.querySelector('#data-counts')?.textContent.includes('Not entered'));
  // The overview form is emptied straight away, without a reload.
  await page.click('.primary-nav a[data-route="overview"]');
  await page.waitForSelector('#profile-form', { state: 'visible' });
  assert.equal(await page.inputValue('#ageYears'), '');
  assert.equal(await page.evaluate(() => localStorage.getItem('letsgetfit.data')), null);
  await page.goto(`${BASE}#overview`);
  await page.reload();
  assert.equal(await page.locator('#profile-form').isVisible(), true);
  assert.equal(await page.inputValue('#ageYears'), '');
  await context.close();
});

await check('keyboard: skip link, visible focus and nav by keyboard', async () => {
  const { page, context } = await freshPage({ viewport: { width: 1280, height: 900 } });
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.notEqual(outline, 'none');
  await page.keyboard.press('Tab'); // brand
  await page.keyboard.press('Tab'); // Overview
  await page.keyboard.press('Tab'); // Food
  await page.keyboard.press('Tab'); // Workouts
  assert.equal(await page.evaluate(() => document.activeElement.dataset.route), 'workouts');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#view-workouts:not([hidden])');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'workouts-title');
  // A form can be completed with the keyboard only.
  await page.goto(`${BASE}#overview`);
  await page.focus('#ageYears');
  await page.keyboard.type('45');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'heightCm');
  await context.close();
});

await check('mobile layout has no horizontal scroll and a bottom nav', async () => {
  for (const name of ['iPhone SE', 'Pixel 7']) {
    const { page, context } = await freshPage({ ...devices[name] });
    await fillMetric(page);
    await page.waitForSelector('#stat-ree');
    for (const route of ['overview', 'food', 'workouts', 'progress', 'settings']) {
      await page.goto(`${BASE}#${route}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `${name} ${route} overflows by ${overflow}px`);
    }
    const nav = await page.locator('.primary-nav').boundingBox();
    const vh = page.viewportSize().height;
    assert.ok(nav.y + nav.height >= vh - 1, `${name}: nav should sit at the bottom`);
    await context.close();
  }
});

await check('reduced motion disables animation', async () => {
  const { page, context } = await freshPage({ reducedMotion: 'reduce' });
  await page.goto(`${BASE}#progress`);
  await page.fill('#log-weightKg', '70');
  await page.click('#weight-submit');
  await page.waitForSelector('.toast');
  const duration = await page.evaluate(() => getComputedStyle(document.querySelector('.toast')).animationDuration);
  assert.ok(parseFloat(duration) < 0.001, `animation ${duration}`);
  await context.close();
});

await check('corrupted storage recovers with a notice', async () => {
  const { page, context } = await freshPage();
  await page.evaluate(() => localStorage.setItem('letsgetfit.data', '{broken'));
  await page.reload();
  await page.waitForSelector('#app-notice:not([hidden])');
  assert.match(await page.textContent('#app-notice'), /could not be read/);
  await context.close();
});


// ---------------- Phase 2: food diary ----------------

async function openFood(page) {
  await page.click('.primary-nav a[data-route="food"]');
  await page.waitForSelector('#view-food:not([hidden])');
}

async function searchAndChoose(page, meal, query, sourceId) {
  await page.click(`[data-add-meal="${meal}"]`);
  await page.waitForSelector('#food-panel:not([hidden])');
  await page.fill('#food-search-q', query);
  await page.click('.search-form button[type="submit"]');
  await page.waitForSelector(`.food-option[data-source-id="${sourceId}"]`);
  await page.click(`.food-option[data-source-id="${sourceId}"]`);
  await page.waitForSelector('#amount-form');
}

async function createCustomFood(page, meal, fields) {
  await page.click(`[data-add-meal="${meal}"]`);
  await page.waitForSelector('#food-panel:not([hidden])');
  await page.click('[data-tab="new"]');
  await page.waitForSelector('#custom-food-form');
  for (const [name, value] of Object.entries(fields)) {
    if (name === 'kind' || name === 'preparation') await page.selectOption(`#cf-${name}`, value);
    else await page.fill(`#cf-${name}`, value);
  }
  await page.click('#custom-food-form button[type="submit"]');
}

await check('food: empty day, search, add with grams, totals and persistence', async () => {
  const { page, context, errors } = await freshPage();
  await openFood(page);
  assert.match(await page.textContent('#food-totals'), /Nothing logged for this day/);
  await searchAndChoose(page, 'breakfast', 'apple', '171688');
  assert.match(await page.textContent('.chosen-food'), /USDA FoodData Central \(ID 171688\)/);
  assert.match(await page.textContent('.chosen-food'), /Raw/);
  await page.fill('#amount-g', '150');
  assert.match(await page.textContent('#amount-preview'), /78 kcal/);
  await page.click('#amount-save');
  await page.waitForSelector('[data-meal="breakfast"] .entry');
  assert.match(await page.textContent('[data-meal="breakfast"] .entry'), /150 g · 78 kcal/);
  assert.match(await page.textContent('#day-energy'), /^78 kcal$/);
  assert.equal(await page.locator('#totals-incomplete').count(), 0, 'all nutrients known');
  assert.match(await page.textContent('tr[data-nutrient="potassium"]'), /161 mg/);
  // Stored with source, ID, per-100 g values, units, grams and a nutrient snapshot.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('letsgetfit.data')));
  assert.equal(stored.schemaVersion, 2);
  const entry = stored.diary[0];
  assert.equal(entry.source, 'usda-fdc');
  assert.equal(entry.sourceId, '171688');
  assert.equal(entry.servingG, 150);
  assert.equal(entry.per100g.energy, 52);
  assert.equal(entry.nutrientUnits.vitaminD, 'µg');
  assert.equal(entry.nutrients.energy, 78);
  assert.equal(stored.foods.length, 1);
  await page.reload();
  await openFood(page);
  assert.match(await page.textContent('#day-energy'), /78 kcal/);
  // Previous day is empty.
  await page.click('#food-prev');
  assert.match(await page.textContent('#food-totals'), /Nothing logged/);
  assert.equal(await page.isDisabled('#food-next'), false);
  await page.click('#food-today');
  assert.match(await page.textContent('#day-energy'), /78 kcal/);
  assert.equal(await page.isDisabled('#food-next'), true, 'cannot go into the future');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('food: custom food with unknown values flags incomplete totals', async () => {
  const { page, context } = await freshPage();
  await openFood(page);
  await createCustomFood(page, 'lunch', { name: 'Brown soda bread', preparation: 'cooked', n_energy: '230', n_protein: '8,5', n_carbohydrate: '40', n_fat: '3', servingG: '40' });
  await page.waitForSelector('#amount-form');
  assert.equal(await page.inputValue('#amount-g'), '40', 'usual serving pre-filled');
  await page.click('#amount-save');
  await page.waitForSelector('[data-meal="lunch"] .entry');
  assert.match(await page.textContent('[data-meal="lunch"] .entry'), /40 g · 92 kcal/);
  assert.match(await page.textContent('[data-meal="lunch"] .entry'), /4 of 10 nutrients known/);
  await page.waitForSelector('#totals-incomplete');
  assert.match(await page.textContent('tr[data-nutrient="fibre"]'), /Unknown/);
  assert.match(await page.textContent('tr[data-nutrient="fibre"]'), /No data/);
  // Add an apple (complete data): fibre becomes "at least", flagged incomplete.
  await searchAndChoose(page, 'snacks', 'apple', '171688');
  await page.fill('#amount-g', '100');
  await page.click('#amount-save');
  await page.waitForSelector('[data-meal="snacks"] .entry');
  assert.match(await page.textContent('tr[data-nutrient="fibre"]'), /at least 2\.4 g/);
  assert.match(await page.textContent('tr[data-nutrient="fibre"]'), /1 of 2 unknown/);
  assert.match(await page.textContent('#day-energy'), /^144 kcal$/);
  await context.close();
});

await check('food: duplicate custom food is offered for reuse', async () => {
  const { page, context } = await freshPage();
  await openFood(page);
  await createCustomFood(page, 'breakfast', { name: 'Porridge oats', n_energy: '375' });
  await page.waitForSelector('#amount-form');
  await page.click('#amount-save');
  await page.waitForSelector('[data-meal="breakfast"] .entry');
  await createCustomFood(page, 'breakfast', { name: 'porridge  OATS', n_energy: '370' });
  await page.waitForSelector('#duplicate-notice:not([hidden])');
  assert.match(await page.textContent('#duplicate-notice'), /You already have “Porridge oats”/);
  await page.click('#duplicate-notice button:has-text("Use the saved food")');
  await page.waitForSelector('#amount-form');
  await page.click('#amount-save');
  await page.waitForFunction(() => document.querySelectorAll('[data-meal="breakfast"] .entry').length === 2);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('letsgetfit.data')));
  assert.equal(stored.foods.length, 1, 'no duplicate food saved');
  await context.close();
});

await check('food: edit grams and meal from the snapshot, then delete', async () => {
  const { page, context } = await freshPage();
  await openFood(page);
  await searchAndChoose(page, 'dinner', 'apple', '171688');
  await page.fill('#amount-g', '200');
  await page.click('#amount-save');
  await page.waitForSelector('[data-meal="dinner"] .entry');
  // Change the library food afterwards: the diary entry must not change.
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('letsgetfit.data'));
    d.foods[0].per100g.energy = 999;
    localStorage.setItem('letsgetfit.data', JSON.stringify(d));
  });
  await page.reload();
  await openFood(page);
  assert.match(await page.textContent('#day-energy'), /^104 kcal$/);
  await page.click('[data-meal="dinner"] .entry button:has-text("Edit")');
  await page.waitForSelector('#amount-form');
  assert.equal(await page.inputValue('#amount-g'), '200');
  await page.fill('#amount-g', '50');
  await page.selectOption('#amount-meal', 'snacks');
  await page.click('#amount-save');
  await page.waitForSelector('[data-meal="snacks"] .entry');
  assert.equal(await page.locator('[data-meal="dinner"] .entry').count(), 0);
  assert.match(await page.textContent('#day-energy'), /^26 kcal$/, 'recalculated from the 52 kcal snapshot, not 999');
  await page.click('[data-meal="snacks"] .entry button:has-text("Delete")');
  await page.click('#confirm-ok');
  await page.waitForSelector('#food-totals .state--empty');
  await context.close();
});

await check('food: branded per-100 ml product and serving buttons', async () => {
  const { page, context } = await freshPage();
  await openFood(page);
  await searchAndChoose(page, 'snacks', 'apple juice', '2345678');
  assert.match(await page.textContent('.chosen-food'), /per 100 ml/);
  assert.match(await page.textContent('.chosen-food'), /Branded/);
  assert.equal(await page.inputValue('#amount-g'), '250');
  await page.click('#amount-save');
  await page.waitForSelector('[data-meal="snacks"] .entry');
  assert.match(await page.textContent('[data-meal="snacks"] .entry'), /250 ml · 115 kcal/);
  await context.close();
});

await check('food: search failure explains and offers manual entry', async () => {
  const { page, context } = await freshPage({}, {
    search: (route) => route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ error: 'timeout', message: 'The food database took too long to answer. Try again, or add the food manually.' }) }),
  });
  await openFood(page);
  await page.click('[data-add-meal="lunch"]');
  await page.fill('#food-search-q', 'colcannon');
  await page.click('.search-form button[type="submit"]');
  await page.waitForSelector('#search-error');
  assert.match(await page.textContent('#search-error'), /took too long/);
  await page.click('#search-error button:has-text("Add a food yourself")');
  await page.waitForSelector('#custom-food-form');
  assert.equal(await page.inputValue('#cf-name'), 'colcannon');
  await context.close();
});

await check('food: no results and a broken response are handled', async () => {
  const { page, context } = await freshPage({}, {
    search: (route, q) => (q === 'garbage' ? route.fulfill({ status: 200, contentType: 'text/html', body: '<html>oops</html>' }) : route.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[]}' })),
  });
  await openFood(page);
  await page.click('[data-add-meal="lunch"]');
  await page.fill('#food-search-q', 'zzzz');
  await page.click('.search-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#search-status')?.textContent.includes('No foods found'));
  await page.fill('#food-search-q', 'garbage');
  await page.click('.search-form button[type="submit"]');
  await page.waitForSelector('#search-error');
  assert.match(await page.textContent('#search-error'), /not available/);
  await context.close();
});

await check('food: when search is unavailable, manual entry still works', async () => {
  const { page, context } = await freshPage({}, { health: 'down' });
  await openFood(page);
  await page.click('[data-add-meal="breakfast"]');
  await page.waitForSelector('#food-panel:not([hidden])');
  // Opens on My foods; the Search tab explains.
  await page.click('[data-tab="search"]');
  await page.waitForSelector('#search-unavailable');
  await page.click('[data-tab="new"]');
  await page.fill('#cf-name', 'Boiled egg');
  await page.selectOption('#cf-preparation', 'cooked');
  await page.fill('#cf-n_energy', '155');
  await page.fill('#cf-n_protein', '13');
  await page.click('#custom-food-form button[type="submit"]');
  await page.waitForSelector('#amount-form');
  await page.fill('#amount-g', '50');
  await page.click('#amount-save');
  await page.waitForSelector('[data-meal="breakfast"] .entry');
  assert.match(await page.textContent('[data-meal="breakfast"] .entry'), /78 kcal/);
  await context.close();
});

await check('food: custom food validation and keyboard use', async () => {
  const { page, context } = await freshPage();
  await openFood(page);
  await page.focus('[data-add-meal="breakfast"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#food-panel:not([hidden])');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'food-panel-title');
  await page.click('[data-tab="new"]');
  await page.fill('#cf-name', 'X');
  await page.fill('#cf-n_fat', 'lots');
  await page.click('#custom-food-form button[type="submit"]');
  await page.waitForSelector('#custom-food-form .error-summary:not([hidden])');
  assert.match(await page.textContent('#cf-name-error'), /at least 2 characters/);
  assert.match(await page.textContent('#cf-n_fat-error'), /as a number/);
  await page.click('#food-panel-close');
  await page.waitForSelector('#food-panel', { state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement.dataset.addMeal), 'breakfast', 'focus returns to the button');
  await context.close();
});

await check('food: Phase 1 data is kept after the upgrade', async () => {
  const { page, context } = await freshPage();
  await page.evaluate(() => {
    localStorage.setItem('letsgetfit.data', JSON.stringify({
      schemaVersion: 1,
      preferences: { units: 'metric' },
      profile: { id: 'p', ageYears: 30, heightCm: 180, weightKg: 80, sex: 'male', activityLevel: 'moderate', pregnantOrBreastfeeding: false },
      workouts: [{ id: 'w', localDate: '2026-11-01', activityId: 'yoga', activityLabel: 'Yoga, hatha', durationMin: 30, createdAt: '2026-11-01T10:00:00.000Z' }],
      weights: [{ id: 'k', localDate: '2026-11-02', weightKg: 80, createdAt: '2026-11-02T07:00:00.000Z' }],
    }));
  });
  await page.reload();
  await page.waitForSelector('#stat-ree');
  assert.match(await page.textContent('#stat-maintenance .stat__value'), /3,290 kcal/);
  await page.click('.primary-nav a[data-route="workouts"]');
  assert.match(await page.textContent('#workout-list'), /Yoga, hatha/);
  await page.click('.primary-nav a[data-route="progress"]');
  assert.match(await page.textContent('#weight-list'), /80 kg/);
  await openFood(page);
  await searchAndChoose(page, 'lunch', 'apple', '171688');
  await page.click('#amount-save');
  await page.waitForSelector('[data-meal="lunch"] .entry');
  assert.match(await page.textContent('#day-totals'), /maintenance estimate is about 3,290 kcal/);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('letsgetfit.data')));
  assert.equal(stored.schemaVersion, 2);
  assert.equal(stored.workouts.length, 1);
  assert.equal(stored.weights.length, 1);
  await context.close();
});

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
if (failed.length) process.exit(1);
