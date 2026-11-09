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

async function freshPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...options });
  const page = await context.newPage();
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
  assert.deepEqual(nav.map((t) => t.trim()), ['Overview', 'Workouts', 'Progress', 'Settings']);
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
    for (const route of ['overview', 'workouts', 'progress', 'settings']) {
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

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
if (failed.length) process.exit(1);
