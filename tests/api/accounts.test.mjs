// Integration tests for optional accounts and sync: real `php -S` + MariaDB/MySQL.
// Database settings come from LGF_TEST_DB_HOST, LGF_TEST_DB_USER, LGF_TEST_DB_PASSWORD
// (defaults 127.0.0.1 / lgf_test / lgf_test_pw). The user needs CREATE/DROP on lgf_test_* databases.
// Skipped when PHP or the database is not available.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const SETUP_TOKEN = 'test-setup-token-abcdefghijklmnop';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = {
  host: process.env.LGF_TEST_DB_HOST ?? '127.0.0.1',
  port: process.env.LGF_TEST_DB_PORT ?? '3306',
  user: process.env.LGF_TEST_DB_USER ?? 'lgf_test',
  password: process.env.LGF_TEST_DB_PASSWORD ?? 'lgf_test_pw',
};

function php(code, env = {}) {
  return spawnSync('php', ['-r', code], { encoding: 'utf8', env: { ...process.env, ...env } });
}
function sql(statement, dbName = '') {
  return php(
    `$p = new PDO('mysql:host=${DB.host};port=${DB.port}${dbName ? `;dbname=${dbName}` : ''}', getenv('U'), getenv('P'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]); $r = $p->query(getenv('Q')); echo json_encode($r ? $r->fetchAll(PDO::FETCH_ASSOC) : []);`,
    { U: DB.user, P: DB.password, Q: statement },
  );
}
const dbAvailable = spawnSync('php', ['-v']).status === 0 && sql('SELECT 1').status === 0;
const skip = dbAvailable ? false : 'PHP or the test database is not available';

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

function phpArray(obj) {
  const r = php('var_export(json_decode(getenv("J"), true));', { J: JSON.stringify(obj) });
  return r.stdout;
}

async function setup({ enabled = true, migrate: runMigrations = true, extra = {} } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'lgf-acc-'));
  const priv = path.join(base, 'letsgetfit-private');
  mkdirSync(path.join(priv, 'config'), { recursive: true });
  symlinkSync(path.join(REPO, 'server'), path.join(priv, 'app'));
  const dbName = `lgf_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  sql(`CREATE DATABASE ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  writeFileSync(
    path.join(priv, 'config', 'app.php'),
    `<?php return ${phpArray({
      accounts_enabled: enabled,
      app_url: url,
      db_dsn: `mysql:host=${DB.host};port=${DB.port};dbname=${dbName};charset=utf8mb4`,
      db_user: DB.user,
      db_password: DB.password,
      mail_transport: 'outbox',
      cookie_name: 'lgf_session',
      cookie_secure: false,
      hash_secret: 'test-secret-for-hashing',
      admin_email: 'boss@example.ie',
      setup_token: SETUP_TOKEN,
      ...extra,
    })};`,
  );
  const migrate = !runMigrations ? null : spawnSync('php', [path.join(priv, 'app', 'bin', 'migrate.php')], { encoding: 'utf8', env: { ...process.env, LETSGETFIT_PRIVATE_DIR: priv } });
  const proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', path.join(REPO, 'public')], {
    env: { ...process.env, LETSGETFIT_PRIVATE_DIR: priv, PHP_CLI_SERVER_WORKERS: '4' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i += 1) {
    try {
      await fetch(`${url}/api/health.php`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return {
    url,
    priv,
    dbName,
    migrate,
    outbox() {
      const dir = path.join(priv, 'storage', 'outbox');
      let files = [];
      try {
        files = readdirSync(dir).sort();
      } catch {
        /* none yet */
      }
      return files.map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
    },
    stop() {
      proc.kill();
      sql(`DROP DATABASE IF EXISTS ${dbName}`);
      rmSync(base, { recursive: true, force: true });
    },
  };
}

/** A browser-like client with its own cookie jar and CSRF token. */
class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
    this.csrf = '';
    this.lastSetCookie = [];
  }
  async call(action, { method = 'GET', body, query = '', headers = {}, csrf = true, endpoint = 'account' } = {}) {
    const h = { Accept: 'application/json', ...headers };
    if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method === 'POST') {
      h['Content-Type'] ??= 'application/json';
      if (csrf) h['X-CSRF-Token'] = this.csrf;
    }
    const res = await fetch(`${this.base}/api/${endpoint}.php?action=${action}${query}`, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    this.lastSetCookie = res.headers.getSetCookie();
    for (const c of this.lastSetCookie) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.csrfToken) this.csrf = json.csrfToken;
    return { status: res.status, body: json, headers: res.headers };
  }
  async me() {
    return this.call('me');
  }
  post(action, body, opts = {}) {
    return this.call(action, { method: 'POST', body, ...opts });
  }
  admin(action, body, opts = {}) {
    return this.call(action, { endpoint: 'admin', ...(body === undefined ? {} : { method: 'POST', body }), ...opts });
  }
}

const PASSWORD = 'correct horse battery staple';
const codeFrom = (mail) => /\b(\d{6})\b/.exec(mail.text)[1];
const lastMail = (s, email) => s.outbox().filter((m) => m.to === email).pop();

/** Join or log in with an email code, the way the app does. */
async function codeLogin(s, email, { consent = true, client } = {}) {
  const c = client ?? new Client(s.url);
  if (!c.csrf) await c.me();
  const r = await c.post('request-code', { email });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = await c.post('verify-code', { email, code: codeFrom(lastMail(s, email.trim().toLowerCase())), healthConsent: consent });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return c;
}

const rec = (collection, id, updatedAt, data, deleted = false) => ({ collection, id, updatedAt, deleted, data });

test('accounts are off by default and the health check says so', { skip }, async (t) => {
  const s = await setup({ enabled: false });
  t.after(() => s.stop());
  const r = await new Client(s.url).me();
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, false);
  // Nothing else is reachable while disabled.
  const c = new Client(s.url);
  assert.equal((await c.call('pull')).body.enabled, false);
  assert.equal((await c.post('request-code', { email: 'a@example.ie' })).body.enabled, false);
  assert.equal((await c.admin('status')).body.enabled, false);
  const health = await (await fetch(`${s.url}/api/health.php`)).json();
  assert.equal(health.accounts, 'disabled');
  assert.equal(health.pdoMysql, true);
});

test('migrations apply once and report status', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  assert.equal(s.migrate.status, 0, s.migrate.stderr);
  assert.match(s.migrate.stdout, /Applied: 001_accounts, 002_passwordless_admin/);
  const run = (args) => spawnSync('php', [path.join(s.priv, 'app', 'bin', 'migrate.php'), ...args], { encoding: 'utf8', env: { ...process.env, LETSGETFIT_PRIVATE_DIR: s.priv } });
  assert.match(run([]).stdout, /Nothing to do/);
  assert.match(run(['--status']).stdout, /Applied: 001_accounts, 002_passwordless_admin\nPending: none/);
  const tables = JSON.parse(sql('SHOW TABLES', s.dbName).stdout).map((r) => Object.values(r)[0]).sort();
  assert.deepEqual(tables, ['audit_log', 'login_codes', 'records', 'schema_migrations', 'settings', 'users']);
  // The migration CLI cannot be run from the web.
  assert.equal((await fetch(`${s.url}/../letsgetfit-private/app/bin/migrate.php`)).status, 404);
});

test('database setup from the admin page needs the setup token, then accounts work', { skip }, async (t) => {
  const s = await setup({ migrate: false });
  t.after(() => s.stop());
  const c = new Client(s.url);
  // Before setup, the app just sees accounts as unavailable.
  const me = await c.me();
  assert.deepEqual([me.status, me.body.enabled, me.body.setupRequired], [200, false, true]);
  const status = await c.admin('status');
  assert.equal(status.body.needsSetup, true);
  assert.deepEqual(status.body.pending, ['001_accounts', '002_passwordless_admin']);
  assert.equal(status.body.setupTokenConfigured, true);
  assert.equal((await c.admin('overview')).body.error, 'setup_required');
  const wrong = await c.admin('setup', { setupToken: 'x'.repeat(30) });
  assert.deepEqual([wrong.status, wrong.body.error], [403, 'bad_setup_token']);
  assert.equal((await c.admin('setup', { setupToken: SETUP_TOKEN }, { csrf: false })).body.error, 'csrf');
  const ok = await c.admin('setup', { setupToken: SETUP_TOKEN });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.applied, ['001_accounts', '002_passwordless_admin']);
  assert.equal((await c.admin('setup', { setupToken: SETUP_TOKEN })).body.applied.length, 0, 'runs once');
  assert.equal((await c.admin('status')).body.needsSetup, false);
  assert.equal((await c.me()).body.enabled, true);
  // Setup attempts are rate-limited.
  const other = new Client(s.url);
  await other.admin('status');
  let last;
  for (let i = 0; i < 6; i += 1) last = await other.admin('setup', { setupToken: 'nope' });
  assert.equal(last.status, 429);
});

test('a short setup token is refused', { skip }, async (t) => {
  const s = await setup({ migrate: false, extra: { setup_token: 'short' } });
  t.after(() => s.stop());
  const c = new Client(s.url);
  assert.equal((await c.admin('status')).body.setupTokenConfigured, false);
  const r = await c.admin('setup', { setupToken: 'short' });
  assert.equal(r.status, 403);
  assert.match(r.body.message, /ADMIN_SETUP_TOKEN/);
});

test('join with an email code: consent, secure cookie, single-use hashed codes', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const c = new Client(s.url);
  const me0 = await c.me();
  assert.equal(me0.body.enabled, true);
  assert.equal(me0.body.user, null);
  assert.equal(me0.body.signupsOpen, true);
  assert.match(me0.body.csrfToken, /^[0-9a-f]{64}$/);
  const cookie = c.lastSetCookie.join(';');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);

  const req = await c.post('request-code', { email: '  Aoife@Example.ie ' });
  assert.equal(req.status, 200);
  assert.match(req.body.message, /6-digit code/);
  const mail = lastMail(s, 'aoife@example.ie');
  assert.match(mail.subject, /Your LetsGetFit code: \d{6}/);
  assert.match(mail.text, /create your LetsGetFit account/);
  const code = codeFrom(mail);
  const stored = JSON.parse(sql('SELECT email_hash, code_hash FROM login_codes', s.dbName).stdout);
  assert.equal(stored.length, 1);
  assert.ok(/^[0-9a-f]{64}$/.test(stored[0].code_hash) && !JSON.stringify(stored).includes(code) && !JSON.stringify(stored).includes('aoife'), 'only hashes stored');

  // A new account needs consent first; the code is not used up by asking.
  const noConsent = await c.post('verify-code', { email: 'aoife@example.ie', code });
  assert.deepEqual([noConsent.status, noConsent.body.error], [409, 'consent_required']);
  assert.equal(JSON.parse(sql('SELECT COUNT(*) AS n FROM users', s.dbName).stdout)[0].n, 0, 'nothing stored without consent');
  const before = c.cookies.get('lgf_session');
  const ok = await c.post('verify-code', { email: 'AOIFE@example.ie', code: ` ${code.slice(0, 3)} ${code.slice(3)} `, healthConsent: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.created, true);
  assert.notEqual(c.cookies.get('lgf_session'), before, 'session ID changes on login');
  const me = await c.me();
  assert.deepEqual(
    { email: me.body.user.email, role: me.body.user.role, hasPassword: me.body.user.hasPassword, recent: me.body.user.canSetPasswordWithoutCurrent },
    { email: 'aoife@example.ie', role: 'user', hasPassword: false, recent: true },
  );
  assert.ok(!JSON.stringify(me.body).includes('hash'));
  const row = JSON.parse(sql('SELECT password_hash, health_consent_at, email_verified_at FROM users', s.dbName).stdout)[0];
  assert.equal(row.password_hash, null);
  assert.ok(row.health_consent_at && row.email_verified_at);
  // Single use.
  const fresh = new Client(s.url);
  await fresh.me();
  assert.equal((await fresh.post('verify-code', { email: 'aoife@example.ie', code })).body.error, 'invalid_code');
  // Logging in again later does not need consent again.
  const again = await codeLogin(s, 'aoife@example.ie', { consent: false });
  assert.equal((await again.me()).body.user.email, 'aoife@example.ie');
});

test('codes: wrong guesses are limited, a new code replaces the old, unknown emails look the same', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  await codeLogin(s, 'cian@example.ie');
  const c = new Client(s.url);
  await c.me();
  const known = await c.post('request-code', { email: 'cian@example.ie' });
  const unknown = await c.post('request-code', { email: 'nobody@example.ie' });
  assert.equal(known.status, unknown.status);
  assert.equal(known.body.message.replace('cian', 'X'), unknown.body.message.replace('nobody', 'X'));
  const code = codeFrom(lastMail(s, 'cian@example.ie'));
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i += 1) {
    const r = await c.post('verify-code', { email: 'cian@example.ie', code: wrong });
    assert.deepEqual([r.status, r.body.error], [401, 'invalid_code']);
  }
  assert.equal((await c.post('verify-code', { email: 'cian@example.ie', code })).body.error, 'invalid_code', 'locked after 5 wrong guesses');
  await c.post('request-code', { email: 'cian@example.ie' });
  const second = codeFrom(lastMail(s, 'cian@example.ie'));
  assert.equal((await c.post('verify-code', { email: 'cian@example.ie', code: second })).status, 200);
  assert.equal((await c.post('request-code', { email: 'not-an-email' })).body.error, 'invalid_email');
  // Expired codes do not work.
  const d = new Client(s.url);
  await d.me();
  await d.post('request-code', { email: 'cian@example.ie' });
  sql('UPDATE login_codes SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE', s.dbName);
  assert.equal((await d.post('verify-code', { email: 'cian@example.ie', code: codeFrom(lastMail(s, 'cian@example.ie')) })).body.error, 'invalid_code');
  // At most 5 emails an hour to one address.
  const e = new Client(s.url);
  await e.me();
  const sentBefore = s.outbox().filter((m) => m.to === 'flood@example.ie').length;
  for (let i = 0; i < 7; i += 1) assert.equal((await e.post('request-code', { email: 'flood@example.ie' })).status, 200);
  assert.equal(s.outbox().filter((m) => m.to === 'flood@example.ie').length - sentBefore, 5);
});

test('CSRF token, JSON content type and same origin are required for changes', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const c = new Client(s.url);
  await c.me();
  const body = { email: 'x@example.ie' };
  assert.equal((await c.post('request-code', body, { csrf: false })).body.error, 'csrf');
  assert.equal((await c.post('request-code', body, { headers: { 'X-CSRF-Token': 'f'.repeat(64) }, csrf: false })).body.error, 'csrf');
  assert.equal((await c.post('request-code', JSON.stringify(body), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal((await c.post('request-code', body, { headers: { Origin: 'https://evil.example' } })).body.error, 'bad_origin');
  assert.equal((await c.post('request-code', body, { headers: { Origin: s.url } })).status, 200);
  assert.equal(s.outbox().length, 1);
});

test('optional password: set after a code login, log in with it, change it, remove it', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const phone = await codeLogin(s, 'orla@example.ie');
  const laptop = await codeLogin(s, 'orla@example.ie');
  assert.equal((await phone.post('set-password', { password: 'short' })).body.error, 'weak_password');
  const set = await phone.post('set-password', { password: PASSWORD });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal((await phone.me()).body.user.hasPassword, true, 'this device stays logged in');
  assert.equal((await laptop.me()).body.user, null, 'other devices are logged out');
  assert.ok(s.outbox().some((m) => m.to === 'orla@example.ie' && /password .* was just set or changed/.test(m.text)), 'security email sent');
  const hash = JSON.parse(sql('SELECT password_hash FROM users', s.dbName).stdout)[0].password_hash;
  assert.match(hash, /^\$argon2id\$|^\$2y\$/);

  // Password login (generic errors).
  const c = new Client(s.url);
  await c.me();
  const wrong = await c.post('login', { email: 'orla@example.ie', password: 'wrong password here' });
  const unknown = await c.post('login', { email: 'nobody@example.ie', password: 'wrong password here' });
  assert.deepEqual([wrong.status, unknown.status], [401, 401]);
  assert.equal(wrong.body.message, unknown.body.message);
  assert.equal((await c.post('login', { email: 'ORLA@example.ie', password: PASSWORD })).status, 200);
  const me = await c.me();
  assert.equal(me.body.user.canSetPasswordWithoutCurrent, false);
  // After a password login, changing it needs the current one.
  assert.equal((await c.post('set-password', { password: 'a brand new long passphrase', currentPassword: 'wrong' })).body.error, 'invalid_credentials');
  assert.equal((await c.post('set-password', { password: 'a brand new long passphrase', currentPassword: PASSWORD })).status, 200);
  assert.equal((await c.post('login', { email: 'orla@example.ie', password: 'a brand new long passphrase' })).status, 200);
  // Forgotten password: log in with a code, then set a new one without the old.
  const forgot = await codeLogin(s, 'orla@example.ie');
  assert.equal((await forgot.post('set-password', { password: 'third long passphrase here' })).status, 200);
  // Remove it: back to codes only.
  assert.equal((await forgot.post('set-password', { remove: true })).status, 200);
  assert.equal((await forgot.me()).body.user.hasPassword, false);
  assert.equal((await new Client(s.url).me().then(() => 0)), 0);
  const d = new Client(s.url);
  await d.me();
  assert.equal((await d.post('login', { email: 'orla@example.ie', password: 'third long passphrase here' })).status, 401);
  // An account without a password, logged in a while ago, must log in again to add one.
  sql("UPDATE users SET password_hash = NULL", s.dbName);
  const old = await codeLogin(s, 'old@example.ie');
  const sessDir = path.join(s.priv, 'storage', 'sessions');
  for (const f of readdirSync(sessDir)) {
    const file = path.join(sessDir, f);
    writeFileSync(file, readFileSync(file, 'utf8').replace(/auth_at\|i:\d+/, 'auth_at|i:1000'));
  }
  assert.equal((await old.post('set-password', { password: PASSWORD })).body.error, 'reauth_required');
});

test('password login attempts are rate-limited', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const c = new Client(s.url);
  await c.me();
  let last;
  for (let i = 0; i < 9; i += 1) last = await c.post('login', { email: 'cian@example.ie', password: 'wrong password here' });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
});

test('two users can never read or change each other’s records', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const a = await codeLogin(s, 'a@example.ie');
  const b = await codeLogin(s, 'b@example.ie');
  const shared = '11111111-1111-4111-8111-111111111111';
  assert.equal((await a.post('push', { records: [rec('weights', shared, '2026-11-01T08:00:00.000Z', { id: shared, localDate: '2026-11-01', weightKg: 80 }), rec('profile', 'profile', '2026-11-01T08:00:00.000Z', { ageYears: 30 })] })).body.accepted, 2);
  // B pushes a record with the same ID: it lands in B's own space.
  assert.equal((await b.post('push', { records: [rec('weights', shared, '2026-11-02T08:00:00.000Z', { id: shared, localDate: '2026-11-02', weightKg: 60 })] })).body.accepted, 1);
  const pullA = await a.call('pull');
  const pullB = await b.call('pull');
  assert.equal(pullA.body.records.find((r) => r.id === shared).data.weightKg, 80);
  assert.equal(pullB.body.records.length, 1);
  assert.equal(pullB.body.records[0].data.weightKg, 60);
  assert.ok(!JSON.stringify(pullB.body).includes('ageYears'), 'B never sees A’s profile');
  // B deletes "its" record: A's is untouched.
  await b.post('push', { records: [rec('weights', shared, '2026-11-03T08:00:00.000Z', null, true)] });
  assert.equal((await a.call('pull')).body.records.find((r) => r.id === shared).deleted, false);
  // Exports are per user.
  const exA = await a.call('export');
  assert.equal(exA.body.account.email, 'a@example.ie');
  assert.equal(exA.body.data.weights[0].weightKg, 80);
  const exB = await b.call('export');
  assert.deepEqual(exB.body.data.weights, []);
  assert.equal(exB.body.data.profile, null);
  // Nobody logged in: nothing.
  const anon = new Client(s.url);
  assert.equal((await anon.call('pull')).status, 401);
  assert.equal((await anon.call('export')).status, 401);
  await anon.me();
  assert.equal((await anon.post('push', { records: [] })).status, 401);
  // A client-supplied user ID is ignored.
  await b.post('push', { userId: 'whatever', records: [rec('weights', 'x1', '2026-11-04T08:00:00.000Z', { weightKg: 1 })], user_id: 'a' });
  assert.equal((await a.call('pull')).body.records.some((r) => r.id === 'x1'), false);
});

test('sync: last write wins, tombstones, validation, cursor paging', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const c = await codeLogin(s, 'sync@example.ie');
  const id = '22222222-2222-4222-8222-222222222222';
  assert.equal((await c.post('push', { records: [rec('workouts', id, '2026-11-05T10:00:00.000Z', { durationMin: 30 })] })).body.accepted, 1);
  const older = await c.post('push', { records: [rec('workouts', id, '2026-11-05T09:00:00.000Z', { durationMin: 10 })] });
  assert.deepEqual([older.body.accepted, older.body.unchanged], [0, 1]);
  const first = await c.call('pull');
  assert.equal(first.body.records[0].data.durationMin, 30);
  assert.equal(first.body.records[0].updatedAt, '2026-11-05T10:00:00.000Z');
  const cursor = first.body.cursor;
  assert.equal((await c.call('pull', { query: `&since=${encodeURIComponent(cursor)}` })).body.records.length, 0);
  await c.post('push', { records: [rec('workouts', id, '2026-11-05T11:00:00.000Z', null, true)] });
  const after = await c.call('pull', { query: `&since=${encodeURIComponent(cursor)}` });
  assert.deepEqual(after.body.records.map((r) => [r.id, r.deleted, r.data]), [[id, true, null]]);
  assert.deepEqual((await c.call('export')).body.data.workouts, []);
  // Validation.
  const bad = await c.post('push', {
    records: [
      rec('passwords', 'a', '2026-11-05T10:00:00Z', {}),
      rec('weights', '../etc', '2026-11-05T10:00:00Z', {}),
      rec('profile', 'not-profile', '2026-11-05T10:00:00Z', {}),
      rec('weights', 'ok-1', 'yesterday-ish', {}),
      rec('weights', 'ok-2', '2099-01-01T00:00:00Z', {}),
      rec('weights', 'ok-3', '2026-11-05T10:00:00Z', null),
      rec('weights', 'big', '2026-11-05T10:00:00Z', { blob: 'x'.repeat(70000) }),
      rec('weights', 'fine', '2026-11-05T10:00:00Z', { weightKg: 70 }),
    ],
  });
  assert.deepEqual(bad.body.rejected.map((r) => r.reason), ['unknown_collection', 'invalid_id', 'invalid_id', 'invalid_updated_at', 'invalid_updated_at', 'missing_data', 'too_large']);
  assert.equal(bad.body.accepted, 1);
  const tooMany = await c.post('push', { records: Array.from({ length: 501 }, (_, i) => rec('weights', `r${i}`, '2026-11-05T10:00:00Z', {})) });
  assert.equal(tooMany.status, 413);
  assert.equal((await c.call('pull', { query: '&since=garbage' })).status, 400);
  // Many records written in the same millisecond page correctly.
  const many = Array.from({ length: 300 }, (_, i) => rec('diary', `d${String(i).padStart(3, '0')}`, '2026-11-06T10:00:00.000Z', { i }));
  await c.post('push', { records: many });
  const all = await c.call('pull');
  assert.equal(all.body.records.filter((r) => r.collection === 'diary').length, 300);
});

test('log out, log out everywhere, and account deletion', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const phone = await codeLogin(s, 'del@example.ie');
  const laptop = await codeLogin(s, 'del@example.ie');
  assert.equal((await laptop.post('logout-everywhere', {})).status, 200);
  assert.equal((await phone.me()).body.user, null);
  assert.equal((await laptop.me()).body.user, null);

  const c = await codeLogin(s, 'del@example.ie');
  await c.post('push', { records: [rec('weights', 'w1', '2026-11-01T08:00:00Z', { weightKg: 70 })] });
  assert.equal((await c.post('delete', {})).body.error, 'confirm_required');
  await c.post('set-password', { password: PASSWORD });
  assert.equal((await c.post('delete', { confirm: 'DELETE', password: 'wrong password here' })).status, 401);
  const del = await c.post('delete', { confirm: 'DELETE', password: PASSWORD });
  assert.equal(del.status, 200);
  assert.equal((await c.me()).body.user, null);
  for (const table of ['users', 'records', 'login_codes']) {
    assert.equal(JSON.parse(sql(`SELECT COUNT(*) AS n FROM ${table}`, s.dbName).stdout)[0].n, 0, table);
  }
  // Without a password, a recent code login is enough.
  const d = await codeLogin(s, 'again@example.ie');
  assert.equal((await d.post('delete', { confirm: 'DELETE' })).status, 200);
  const e = await codeLogin(s, 'bye@example.ie');
  assert.equal((await e.post('logout', {})).status, 200);
  assert.equal((await e.me()).body.user, null);
  assert.equal((await e.call('pull')).status, 401);
});

test('signups can be closed: existing users still log in, new emails get no account', { skip }, async (t) => {
  const s = await setup({ extra: { signups_open: false } });
  t.after(() => s.stop());
  sql("INSERT INTO users (id, email, role, email_verified_at, health_consent_at, created_at, updated_at) VALUES ('33333333-3333-4333-8333-333333333333', 'old@example.ie', 'user', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())", s.dbName);
  await codeLogin(s, 'old@example.ie');
  const c = new Client(s.url);
  assert.equal((await c.me()).body.signupsOpen, false);
  assert.equal((await c.post('request-code', { email: 'new@example.ie' })).status, 200);
  assert.match(lastMail(s, 'new@example.ie').text, /paused/);
  assert.ok(!/\d{6}/.test(lastMail(s, 'new@example.ie').text), 'no code sent');
  // The admin email can always join, so the site cannot lock its owner out.
  await codeLogin(s, 'boss@example.ie');
});

test('admin: the ADMIN_EMAIL account becomes admin; others are refused', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const user = await codeLogin(s, 'aoife@example.ie');
  await user.post('push', { records: [rec('weights', 'w1', '2026-11-01T08:00:00Z', { weightKg: 70 })] });
  assert.equal((await user.admin('overview')).status, 403);
  assert.equal((await user.admin('users')).status, 403);
  assert.equal((await user.admin('settings', { values: { signups_open: false } })).status, 403);
  assert.equal((await new Client(s.url).admin('overview')).status, 403);

  const admin = await codeLogin(s, 'Boss@Example.ie');
  assert.equal((await admin.me()).body.user.role, 'admin');
  const ov = await admin.admin('overview');
  assert.equal(ov.status, 200, JSON.stringify(ov.body));
  assert.deepEqual([ov.body.users.total, ov.body.users.admins, ov.body.records], [2, 1, 1]);
  assert.match(ov.body.features.mail, /outbox/);
  // The user list never includes health data.
  const list = await admin.admin('users', undefined, { query: '&q=aoife' });
  assert.equal(list.body.users.length, 1);
  const u = list.body.users[0];
  assert.deepEqual([u.email, u.role, u.recordCount, u.disabled], ['aoife@example.ie', 'user', 1, false]);
  assert.ok(!JSON.stringify(list.body).includes('weightKg'));
  assert.equal((await admin.admin('users', undefined, { query: '&q=%25' })).body.users.length, 0, 'LIKE wildcards are escaped');

  // Disable: logged out at once, cannot get a code, cannot log in. Enable restores.
  assert.equal((await admin.admin('user', { id: u.id, op: 'disable' })).status, 200);
  assert.equal((await user.me()).body.user, null);
  const before = s.outbox().length;
  await user.post('request-code', { email: 'aoife@example.ie' });
  assert.equal(s.outbox().length, before, 'no code for a disabled account');
  assert.equal((await admin.admin('user', { id: u.id, op: 'enable' })).status, 200);
  await codeLogin(s, 'aoife@example.ie', { client: user });
  // Make admin and back.
  assert.equal((await admin.admin('user', { id: u.id, op: 'make-admin' })).status, 200);
  assert.equal((await user.admin('overview')).status, 200);
  assert.equal((await admin.admin('user', { id: u.id, op: 'remove-admin' })).status, 200);
  assert.equal((await user.admin('overview')).status, 403, 'role is checked on every request');
  // Guards.
  const self = (await admin.admin('users', undefined, { query: '&q=boss' })).body.users[0];
  assert.equal((await admin.admin('user', { id: self.id, op: 'disable' })).body.error, 'self');
  assert.equal((await admin.admin('user', { id: self.id, op: 'remove-admin' })).body.error, 'self');
  assert.equal((await admin.admin('user', { id: u.id, op: 'explode' })).status, 400);
  assert.equal((await admin.admin('user', { id: u.id, op: 'delete', confirm: 'wrong' })).body.error, 'confirm_required');
  assert.equal((await admin.admin('user', { id: u.id, op: 'delete', confirm: 'aoife@example.ie' })).status, 200);
  assert.equal(JSON.parse(sql('SELECT COUNT(*) AS n FROM records', s.dbName).stdout)[0].n, 0);
  // Audit trail, without personal data.
  const audit = await admin.admin('audit');
  const actions = audit.body.entries.map((e) => e.action);
  for (const a of ['user.disable', 'user.enable', 'user.make-admin', 'user.remove-admin', 'user.delete']) assert.ok(actions.includes(a), a);
  const rows = sql('SELECT action, detail FROM audit_log', s.dbName).stdout;
  assert.ok(!rows.includes('aoife'), 'no emails in the audit table');
  // Test email goes to the admin.
  const te = await admin.admin('test-email', {});
  assert.equal(te.status, 200);
  assert.equal(lastMail(s, 'boss@example.ie').subject, 'LetsGetFit test email');
});

test('admin settings: API keys are encrypted, masked, and applied straight away', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const admin = await codeLogin(s, 'boss@example.ie');
  const view = await admin.admin('settings');
  assert.equal(view.status, 200);
  assert.equal(view.body.secretsStorable, true);
  assert.equal(view.body.fields.openai_api_key.source, 'none');
  assert.equal(view.body.fields.signups_open.value, true);
  assert.equal((await fetch(`${s.url}/api/health.php`).then((r) => r.json())).aiScan, 'disabled');

  const key = 'sk-test-abcdefghijklmnopqrstuvwxyz1234';
  const bad = await admin.admin('settings', { values: { openai_api_key: 'not a key!', scan_daily_limit: 0, nonsense: 1 } });
  assert.equal(bad.status, 422);
  assert.deepEqual(Object.keys(bad.body.fields).sort(), ['nonsense', 'openai_api_key', 'scan_daily_limit']);
  const ok = await admin.admin('settings', { values: { openai_api_key: key, scan_daily_limit: 50, signups_open: false, privacy_contact_email: 'privacy@example.ie' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const after = await admin.admin('settings');
  assert.deepEqual(after.body.fields.openai_api_key.stored, { set: true, hint: '…1234' });
  assert.equal(after.body.fields.openai_api_key.source, 'admin');
  assert.equal(after.body.fields.scan_daily_limit.value, 50);
  assert.ok(!JSON.stringify(after.body).includes(key), 'the key is never sent back');
  const raw = sql("SELECT value, is_secret FROM settings WHERE name = 'openai_api_key'", s.dbName).stdout;
  assert.ok(!raw.includes(key) && raw.includes('v1:'), 'encrypted in the database');
  // Applied: health sees the scan key; the account page sees closed sign-ups and the contact.
  assert.equal((await fetch(`${s.url}/api/health.php`).then((r) => r.json())).aiScan, 'enabled');
  const me = await new Client(s.url).me();
  assert.deepEqual([me.body.signupsOpen, me.body.privacyContact], [false, 'privacy@example.ie']);
  // Pausing scanning switches it off without removing the key.
  await admin.admin('settings', { values: { scan_enabled: false } });
  assert.equal((await fetch(`${s.url}/api/health.php`).then((r) => r.json())).aiScan, 'disabled');
  // Clearing a value falls back to the private settings file.
  await admin.admin('settings', { values: { openai_api_key: '', scan_enabled: true } });
  assert.equal((await admin.admin('settings')).body.fields.openai_api_key.source, 'none');
  const changes = JSON.parse(sql("SELECT detail FROM audit_log WHERE action = 'settings.changed'", s.dbName).stdout).map((r) => r.detail);
  assert.ok(changes.includes('openai_api_key'));
  assert.ok(!sql('SELECT * FROM audit_log', s.dbName).stdout.includes('sk-test'), 'values are never audited');
});

test('cleanup removes expired codes and prints no personal data', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  await codeLogin(s, 'keep@example.ie');
  const c = new Client(s.url);
  await c.me();
  await c.post('request-code', { email: 'stale@example.ie' });
  sql('UPDATE login_codes SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 HOUR', s.dbName);
  const r = spawnSync('php', [path.join(s.priv, 'app', 'bin', 'cleanup.php')], { encoding: 'utf8', env: { ...process.env, LETSGETFIT_PRIVATE_DIR: s.priv } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Removed 1 expired login codes/);
  assert.equal(JSON.parse(sql('SELECT COUNT(*) AS n FROM login_codes', s.dbName).stdout)[0].n, 0);
  assert.ok(!r.stdout.includes('@'), 'no personal data printed');
});
