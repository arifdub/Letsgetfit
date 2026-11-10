// Browser tests for optional accounts and sync against a real backend (php -S + MariaDB/MySQL).
// Usage: node tests/e2e/accounts.mjs   (skips when PHP or the test database is unavailable)
// Database settings: LGF_TEST_DB_HOST / _PORT / _USER / _PASSWORD (defaults 127.0.0.1 / 3306 / lgf_test / lgf_test_pw).

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SETUP_TOKEN = 'e2e-setup-token-abcdefghijklmnop';
const DB = {
  host: process.env.LGF_TEST_DB_HOST ?? '127.0.0.1',
  port: process.env.LGF_TEST_DB_PORT ?? '3306',
  user: process.env.LGF_TEST_DB_USER ?? 'lgf_test',
  password: process.env.LGF_TEST_DB_PASSWORD ?? 'lgf_test_pw',
};
const php = (code, env = {}) => spawnSync('php', ['-r', code], { encoding: 'utf8', env: { ...process.env, ...env } });
const sql = (q, db = '') =>
  php(`$p = new PDO('mysql:host=${DB.host};port=${DB.port}${db ? `;dbname=${db}` : ''}', getenv('U'), getenv('P'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]); $r = $p->query(getenv('Q')); echo json_encode($r ? $r->fetchAll(PDO::FETCH_ASSOC) : []);`, { U: DB.user, P: DB.password, Q: q });

if (spawnSync('php', ['-v']).status !== 0 || sql('SELECT 1').status !== 0) {
  console.log('Account browser tests skipped: PHP or the test database is not available.');
  process.exit(0);
}

const port = await new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const BASE = `http://127.0.0.1:${port}/`;
const base = mkdtempSync(path.join(tmpdir(), 'lgf-e2e-acc-'));
const priv = path.join(base, 'letsgetfit-private');
mkdirSync(path.join(priv, 'config'), { recursive: true });
symlinkSync(path.join(REPO, 'server'), path.join(priv, 'app'));
const dbName = `lgf_test_e2e_${process.pid}`;
sql(`CREATE DATABASE ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
const config = php('var_export(json_decode(getenv("J"), true));', {
  J: JSON.stringify({
    accounts_enabled: true,
    app_url: BASE.replace(/\/$/, ''),
    db_dsn: `mysql:host=${DB.host};port=${DB.port};dbname=${dbName};charset=utf8mb4`,
    db_user: DB.user,
    db_password: DB.password,
    mail_transport: 'outbox',
    cookie_name: 'lgf_session',
    cookie_secure: false,
    hash_secret: 'e2e-secret-value-0123456789',
    admin_email: 'boss@example.ie',
    setup_token: SETUP_TOKEN,
  }),
}).stdout;
writeFileSync(path.join(priv, 'config', 'app.php'), `<?php return ${config};`);
const server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', path.join(REPO, 'public')], { env: { ...process.env, LETSGETFIT_PRIVATE_DIR: priv, PHP_CLI_SERVER_WORKERS: '4' }, stdio: 'ignore' });
for (let i = 0; i < 50; i += 1) {
  try {
    await fetch(BASE);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}

const outbox = () => {
  try {
    return readdirSync(path.join(priv, 'storage', 'outbox')).sort().map((f) => JSON.parse(readFileSync(path.join(priv, 'storage', 'outbox', f), 'utf8')));
  } catch {
    return [];
  }
};
const codeFor = (email) => /\b(\d{6})\b/.exec(outbox().filter((m) => m.to === email).pop().text)[1];
const count = (table) => JSON.parse(sql(`SELECT COUNT(*) AS n FROM ${table}`, dbName).stdout)[0].n;

const browser = await chromium.launch();
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok  ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  FAIL ${name}\n       ${error.message.split('\n').join('\n       ')}`);
  }
}

async function device() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.waitForSelector('html[data-ready="true"]');
  return { context, page, errors };
}

async function addWeight(page, kg, date) {
  await page.goto(`${BASE}#progress`);
  if (date) await page.fill('#weight-date', date);
  await page.fill('#log-weightKg', String(kg));
  await page.click('#weight-submit');
  await page.waitForFunction((n) => document.querySelectorAll('#weight-list .entry').length >= n, 1);
}

async function openAccount(page) {
  await page.goto(`${BASE}#account`);
  await page.waitForSelector('#account-card');
}

/** Join or log in with an email code. Returns once logged in. */
async function codeLogin(page, email, { newAccount = false } = {}) {
  await openAccount(page);
  await page.fill('#acc-email', email);
  await page.click('#code-email-form button[type="submit"]');
  await page.waitForSelector('#acc-code');
  await page.fill('#acc-code', codeFor(email));
  await page.click('#code-verify-form button[type="submit"]');
  if (newAccount) {
    await page.waitForSelector('#acc-consent');
    await page.click('#code-verify-form button[type="submit"]');
    await page.waitForSelector('#acc-consent-error:not([hidden])');
    await page.check('#acc-consent');
    await page.click('#code-verify-form button[type="submit"]');
  }
  await page.waitForSelector('#account-email');
}

const PASSWORD = 'correct horse battery staple';
console.log(`Account browser tests against ${BASE}`);

await check('before setup: no account tab; admin page sets up the database with the token', async () => {
  const { page, errors } = await device();
  assert.equal(await page.isVisible('#nav-account'), false, 'no Account tab until the database is ready');
  await page.goto(`${BASE}#admin`);
  await page.waitForSelector('#admin-setup-form');
  await page.fill('#admin-setup-token', 'wrong-token-wrong-token-wrong');
  await page.click('#admin-setup-form button[type="submit"]');
  await page.waitForSelector('#admin-setup-token-error:not([hidden])');
  await page.fill('#admin-setup-token', SETUP_TOKEN);
  await page.click('#admin-setup-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#admin-panel')?.textContent.includes('Log in as an admin'));
  assert.ok(await page.isVisible('#nav-account'), 'Account tab appears');
  assert.ok(count('users') === 0);
  assert.deepEqual(errors, []);
  await page.context().close();
});

let device1;
let device2;
await check('join with an email code and consent; nothing uploaded before opting in', async () => {
  device1 = await device();
  const { page } = device1;
  await addWeight(page, 80);
  await page.goto(`${BASE}#workouts`);
  await page.selectOption('#workout-activity', 'yoga');
  await page.fill('#workout-duration', '30');
  await page.click('#workout-submit');
  await page.waitForSelector('#workout-list .entry');
  await page.goto(`${BASE}#settings`);
  assert.ok(await page.isVisible('#settings-account'));
  await openAccount(page);
  // A wrong code gives an inline error.
  await page.fill('#acc-email', 'ciara@example.ie');
  await page.click('#code-email-form button[type="submit"]');
  await page.waitForSelector('#acc-code');
  assert.match(await page.textContent('#code-verify-form .form-status'), /6-digit code/);
  const real = codeFor('ciara@example.ie');
  await page.fill('#acc-code', real === '000000' ? '111111' : '000000');
  await page.click('#code-verify-form button[type="submit"]');
  await page.waitForSelector('#acc-code-error:not([hidden])');
  await page.click('#code-start-over');
  await codeLogin(page, 'ciara@example.ie', { newAccount: true });
  assert.match(await page.textContent('#account-email'), /ciara@example\.ie.*Member.*Email code/s);
  assert.equal(await page.isVisible('#open-admin'), false);
  assert.equal(count('records'), 0, 'nothing uploaded before the user opts in');
});

await check('opt-in copy shows a preview, then uploads this device’s data', async () => {
  const { page } = device1;
  await page.click('#start-import');
  await page.waitForSelector('#import-preview');
  const text = await page.textContent('#import-preview');
  assert.match(text, /Copied from this device to your account:.*Workouts: 1.*Weight entries: 1/s);
  assert.match(text, /Copied from your account to this device:\s*Nothing/);
  await page.click('#confirm-import');
  await page.waitForSelector('#sync-status');
  assert.ok(count('records') >= 2);
});

await check('add a password, then log in with it on a second device; duplicates skipped', async () => {
  const { page } = device1;
  await page.fill('#acc-new-password', 'short');
  await page.click('#set-password-form button[type="submit"]');
  await page.waitForSelector('#acc-new-password-error:not([hidden])');
  await page.fill('#acc-new-password', PASSWORD);
  await page.click('#set-password-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#acc-login-method')?.textContent.includes('Password or email code'));

  device2 = await device();
  const p2 = device2.page;
  await addWeight(p2, 80); // same day and weight as device 1: a likely duplicate
  await addWeight(p2, 81.5, (() => { const d = new Date(); d.setDate(d.getDate() - 3); return d.toLocaleDateString('en-CA'); })());
  await openAccount(p2);
  await p2.click('#use-password');
  await p2.fill('#acc-login-email', 'ciara@example.ie');
  await p2.fill('#acc-login-password', 'not the password at all');
  await p2.click('#login-form button[type="submit"]');
  await p2.waitForFunction(() => document.querySelector('#login-form .form-status')?.textContent.includes('do not match'));
  await p2.fill('#acc-login-password', PASSWORD);
  await p2.click('#login-form button[type="submit"]');
  await p2.waitForSelector('#account-email');
  await p2.click('#start-import');
  await p2.waitForSelector('#import-preview');
  const text = await p2.textContent('#import-preview');
  assert.match(text, /to your account:\s*Weight entries: 1/);
  assert.match(text, /to this device:\s*Workouts: 1/);
  assert.match(await p2.textContent('#import-duplicates'), /^1 entry looks like a duplicate/);
  await p2.click('#confirm-import');
  await p2.waitForSelector('#sync-status');
  await p2.goto(`${BASE}#workouts`);
  assert.match(await p2.textContent('#workout-list'), /Yoga, hatha/);
  await p2.goto(`${BASE}#progress`);
  assert.equal(await p2.locator('#weight-list .entry').count(), 2, 'no duplicate weight');
});

await check('deletions sync between devices', async () => {
  const { page } = device2;
  await page.goto(`${BASE}#workouts`);
  await page.click('#workout-list .entry button:has-text("Delete")');
  await page.click('#confirm-ok');
  await page.waitForSelector('#workout-list .state--empty');
  await openAccount(page);
  await page.click('#sync-now');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.startsWith('Synced.'));
  const p1 = device1.page;
  await openAccount(p1);
  await p1.click('#sync-now');
  await p1.waitForFunction(() => document.querySelector('#toast')?.textContent.startsWith('Synced.'));
  await p1.goto(`${BASE}#workouts`);
  await p1.waitForSelector('#workout-list .state--empty');
  await p1.goto(`${BASE}#progress`);
  assert.equal(await p1.locator('#weight-list .entry').count(), 2, 'device 2’s extra weight arrived');
});

await check('admin: ADMIN_EMAIL logs in by code, saves an API key, disables a member', async () => {
  const { page, errors } = await device();
  await codeLogin(page, 'boss@example.ie', { newAccount: true });
  assert.match(await page.textContent('#account-email'), /Admin/);
  await page.click('#open-admin');
  await page.waitForSelector('#admin-stats');
  assert.match(await page.textContent('#admin-stats'), /Members\s*2/);
  await page.fill('#admin-set-openai_api_key', 'sk-test-e2e-abcdefghijklmnop9876');
  await page.uncheck('#admin-set-signups_open');
  await page.click('#admin-settings-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#admin-settings-form')?.textContent.includes('ends …9876'));
  assert.equal(await page.inputValue('#admin-set-openai_api_key'), '', 'the key is never shown again');
  assert.equal(await page.isChecked('#admin-set-signups_open'), false);
  const health = await (await fetch(`${BASE}api/health.php`)).json();
  assert.equal(health.aiScan, 'enabled');
  // Members list and disabling an account logs that member out.
  await page.waitForSelector('[data-user-email="ciara@example.ie"]');
  await page.click('[data-user-email="ciara@example.ie"] [data-user-op="disable"]');
  await page.click('#confirm-ok');
  await page.waitForSelector('[data-user-email="ciara@example.ie"] [data-user-op="enable"]');
  await device1.page.reload();
  await openAccount(device1.page);
  await device1.page.waitForSelector('#code-email-form');
  await page.click('[data-user-email="ciara@example.ie"] [data-user-op="enable"]');
  await page.waitForSelector('[data-user-email="ciara@example.ie"] [data-user-op="disable"]');
  // Test email.
  await page.click('#admin-test-email');
  await page.waitForFunction(() => document.querySelector('#admin-panel')?.textContent.includes('test mode'));
  await page.click('#admin-audit-title ~ details summary');
  await page.waitForFunction(() => document.querySelector('#admin-audit-list')?.textContent.includes('user.disable'));
  // A member cannot open the admin panel.
  await device2.page.goto(`${BASE}#admin`);
  await device2.page.waitForFunction(() => document.querySelector('#admin-panel')?.textContent.includes('not an admin'));
  assert.deepEqual(errors, []);
  await page.context().close();
});

await check('log in by code again, download, then delete the account; device data stays', async () => {
  const { page } = device1;
  await codeLogin(page, 'ciara@example.ie');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#account-export')]);
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(exported.account.email, 'ciara@example.ie');
  assert.equal(exported.data.weights.length, 2);
  await page.click('#delete-account-form >> xpath=.. >> summary');
  await page.fill('#acc-delete-password', PASSWORD);
  await page.click('#delete-account-form button[type="submit"]');
  await page.click('#confirm-ok');
  await page.waitForSelector('#code-email-form');
  assert.equal(count('users'), 1, 'only the admin is left');
  await page.goto(`${BASE}#progress`);
  assert.equal(await page.locator('#weight-list .entry').count(), 2, 'local data untouched');
  assert.deepEqual(device1.errors, []);
  assert.deepEqual(device2.errors, []);
});

await browser.close();
server.kill();
sql(`DROP DATABASE IF EXISTS ${dbName}`);
rmSync(base, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} account browser checks passed`);
if (failed.length) process.exit(1);
