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
    hash_secret: 'e2e-secret-value',
  }),
}).stdout;
writeFileSync(path.join(priv, 'config', 'app.php'), `<?php return ${config};`);
const mig = spawnSync('php', [path.join(priv, 'app', 'bin', 'migrate.php')], { encoding: 'utf8', env: { ...process.env, LETSGETFIT_PRIVATE_DIR: priv } });
assert.equal(mig.status, 0, mig.stderr);
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
const linkFor = (email, kind) => {
  const mail = outbox().filter((m) => m.to === email && m.text.includes(`#account/${kind}`)).pop();
  return /(http\S+#account\/\S+)/.exec(mail.text)[1];
};
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
  await page.goto(`${BASE}#settings`);
  await page.waitForSelector('#account-card:not([hidden])');
}

async function login(page, email, password) {
  await openAccount(page);
  await page.fill('#acc-login-email', email);
  await page.fill('#acc-login-password', password);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#account-email');
}

const PASSWORD = 'correct horse battery staple';
const today = new Date().toLocaleDateString('en-CA');
console.log(`Account browser tests against ${BASE}`);

let device1;
await check('sign up, confirm by email link, log in; card only when enabled', async () => {
  device1 = await device();
  const { page } = device1;
  await addWeight(page, 80);
  await page.goto(`${BASE}#workouts`);
  await page.selectOption('#workout-activity', 'yoga');
  await page.fill('#workout-duration', '30');
  await page.click('#workout-submit');
  await page.waitForSelector('#workout-list .entry');
  await openAccount(page);
  await page.click('[data-account-tab="register"]');
  await page.fill('#acc-reg-email', 'ciara@example.ie');
  await page.fill('#acc-reg-password', PASSWORD);
  await page.click('#register-form button[type="submit"]');
  await page.waitForSelector('#acc-reg-consent-error:not([hidden])');
  assert.match(await page.textContent('#acc-reg-consent-error'), /consent box/);
  await page.check('#acc-reg-consent');
  await page.fill('#acc-reg-password', PASSWORD);
  await page.click('#register-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#register-form .form-status')?.textContent.includes('Check your email'));
  // Logging in before confirming offers a new link.
  await page.click('[data-account-tab="login"]');
  await page.fill('#acc-login-email', 'ciara@example.ie');
  await page.fill('#acc-login-password', PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#resend-verification');
  // Confirm via the emailed link; the token is removed from the address bar.
  await page.goto(linkFor('ciara@example.ie', 'verify'));
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('email address is confirmed'));
  assert.equal(new URL(page.url()).hash, '#settings');
  await login(page, 'ciara@example.ie', PASSWORD);
  assert.match(await page.textContent('#account-email'), /ciara@example\.ie/);
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

let device2;
await check('second device: duplicates are skipped, account data arrives', async () => {
  device2 = await device();
  const { page } = device2;
  await addWeight(page, 80); // same day and weight as device 1: a likely duplicate
  await addWeight(page, 81.5, (() => { const d = new Date(); d.setDate(d.getDate() - 3); return d.toLocaleDateString('en-CA'); })());
  await login(page, 'ciara@example.ie', PASSWORD);
  await page.click('#start-import');
  await page.waitForSelector('#import-preview');
  const text = await page.textContent('#import-preview');
  assert.match(text, /to your account:\s*Weight entries: 1/);
  assert.match(text, /to this device:\s*Workouts: 1/);
  assert.match(await page.textContent('#import-duplicates'), /^1 entry looks like a duplicate/);
  await page.click('#confirm-import');
  await page.waitForSelector('#sync-status');
  await page.goto(`${BASE}#workouts`);
  assert.match(await page.textContent('#workout-list'), /Yoga, hatha/);
  await page.goto(`${BASE}#progress`);
  assert.equal(await page.locator('#weight-list .entry').count(), 2, 'no duplicate weight');
});

await check('deletions and edits sync between devices', async () => {
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

await check('password reset by email link logs out other devices', async () => {
  const { page } = await device();
  await openAccount(page);
  await page.click('[data-account-tab="forgot"]');
  await page.fill('#acc-forgot-email', 'ciara@example.ie');
  await page.click('#forgot-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#forgot-form .form-status')?.textContent.includes('If that address has an account'));
  await page.goto(linkFor('ciara@example.ie', 'reset'));
  await page.waitForSelector('#reset-form');
  assert.equal(new URL(page.url()).hash, '#settings', 'token removed from the address bar');
  await page.fill('#acc-reset-password', 'short');
  await page.click('#reset-form button[type="submit"]');
  await page.waitForSelector('#acc-reset-password-error:not([hidden])');
  await page.fill('#acc-reset-password', 'a brand new long passphrase');
  await page.click('#reset-form button[type="submit"]');
  await page.waitForSelector('#login-form');
  // Device 1 was logged out by the reset.
  await device1.page.reload();
  await openAccount(device1.page);
  await device1.page.waitForSelector('#login-form');
  await login(device1.page, 'ciara@example.ie', 'a brand new long passphrase');
});

await check('wrong password message, then delete the account; device data stays', async () => {
  const { page } = device1;
  await page.click('#account-logout');
  await page.waitForSelector('#login-form');
  await page.fill('#acc-login-email', 'ciara@example.ie');
  await page.fill('#acc-login-password', 'not the password at all');
  await page.click('#login-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#login-form .form-status')?.textContent.includes('do not match'));
  await login(page, 'ciara@example.ie', 'a brand new long passphrase');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#account-export')]);
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(exported.account.email, 'ciara@example.ie');
  assert.equal(exported.data.weights.length, 2);
  await page.click('#account-card summary');
  await page.fill('#acc-delete-password', 'a brand new long passphrase');
  await page.click('#delete-account-form button[type="submit"]');
  await page.waitForSelector('#login-form');
  assert.equal(count('users'), 0);
  assert.equal(count('records'), 0);
  await page.goto(`${BASE}#progress`);
  assert.equal(await page.locator('#weight-list .entry').count(), 2, 'local data untouched');
  assert.deepEqual(device1.errors, []);
});

await browser.close();
server.kill();
sql(`DROP DATABASE IF EXISTS ${dbName}`);
rmSync(base, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} account browser checks passed`);
if (failed.length) process.exit(1);
