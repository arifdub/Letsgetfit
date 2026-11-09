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

async function setup({ enabled = true } = {}) {
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
    })};`,
  );
  const migrate = spawnSync('php', [path.join(priv, 'app', 'bin', 'migrate.php')], { encoding: 'utf8', env: { ...process.env, LETSGETFIT_PRIVATE_DIR: priv } });
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
  async call(action, { method = 'GET', body, query = '', headers = {}, csrf = true } = {}) {
    const h = { Accept: 'application/json', ...headers };
    if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method === 'POST') {
      h['Content-Type'] ??= 'application/json';
      if (csrf) h['X-CSRF-Token'] = this.csrf;
    }
    const res = await fetch(`${this.base}/api/account.php?action=${action}${query}`, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
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
}

const PASSWORD = 'correct horse battery staple';
const tokenFrom = (mail) => /token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];

async function verifiedUser(s, email, password = PASSWORD) {
  const c = new Client(s.url);
  await c.me();
  const r = await c.post('register', { email, password, healthConsent: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const mail = s.outbox().filter((m) => m.to === email).pop();
  assert.equal((await c.post('verify', { token: tokenFrom(mail) })).status, 200);
  const login = await c.post('login', { email, password });
  assert.equal(login.status, 200, JSON.stringify(login.body));
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
  assert.equal((await c.post('register', { email: 'a@example.ie', password: 'correct horse battery staple', healthConsent: true })).body.enabled, false);
  const health = await (await fetch(`${s.url}/api/health.php`)).json();
  assert.equal(health.accounts, 'disabled');
  assert.equal(health.pdoMysql, true);
});

test('migrations apply once and report status', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  assert.equal(s.migrate.status, 0, s.migrate.stderr);
  assert.match(s.migrate.stdout, /Applied: 001_accounts/);
  const run = (args) => spawnSync('php', [path.join(s.priv, 'app', 'bin', 'migrate.php'), ...args], { encoding: 'utf8', env: { ...process.env, LETSGETFIT_PRIVATE_DIR: s.priv } });
  assert.match(run([]).stdout, /Nothing to do/);
  assert.match(run(['--status']).stdout, /Applied: 001_accounts\nPending: none/);
  const tables = JSON.parse(sql('SHOW TABLES', s.dbName).stdout).map((r) => Object.values(r)[0]).sort();
  assert.deepEqual(tables, ['auth_tokens', 'records', 'schema_migrations', 'users']);
  // The migration CLI cannot be run from the web.
  assert.equal((await fetch(`${s.url}/../letsgetfit-private/app/bin/migrate.php`)).status, 404);
});

test('register, confirm email, log in; secure cookie flags; no secrets in responses', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const c = new Client(s.url);
  const me0 = await c.me();
  assert.equal(me0.body.enabled, true);
  assert.equal(me0.body.user, null);
  assert.match(me0.body.csrfToken, /^[0-9a-f]{64}$/);
  const cookie = c.lastSetCookie.join(';');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);

  const reg = await c.post('register', { email: '  Aoife@Example.ie ', password: PASSWORD, healthConsent: true });
  assert.equal(reg.status, 200);
  assert.match(reg.body.message, /Check your email/);
  const [mail] = s.outbox();
  assert.equal(mail.to, 'aoife@example.ie');
  assert.match(mail.text, new RegExp(`${s.url}/#account/verify\\?token=`));

  const early = await c.post('login', { email: 'aoife@example.ie', password: PASSWORD });
  assert.equal(early.status, 403);
  assert.equal(early.body.error, 'email_not_verified');

  assert.equal((await c.post('verify', { token: tokenFrom(mail) })).status, 200);
  assert.equal((await c.post('verify', { token: tokenFrom(mail) })).status, 400, 'single use');

  const before = c.cookies.get('lgf_session');
  const login = await c.post('login', { email: 'AOIFE@example.ie', password: PASSWORD });
  assert.equal(login.status, 200);
  assert.notEqual(c.cookies.get('lgf_session'), before, 'session ID changes on login');
  const me = await c.me();
  assert.deepEqual({ email: me.body.user.email, verified: me.body.user.verified }, { email: 'aoife@example.ie', verified: true });

  const row = JSON.parse(sql("SELECT password_hash, health_consent_at FROM users", s.dbName).stdout)[0];
  assert.match(row.password_hash, /^\$argon2id\$|^\$2y\$/);
  assert.ok(row.health_consent_at);
  const tokens = JSON.parse(sql('SELECT token_hash FROM auth_tokens', s.dbName).stdout);
  assert.ok(tokens.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash)), 'only token hashes are stored');
  assert.ok(!JSON.stringify(me.body).includes('hash'));
});

test('CSRF token, JSON content type and same origin are required for changes', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const c = new Client(s.url);
  await c.me();
  const body = { email: 'x@example.ie', password: PASSWORD, healthConsent: true };
  assert.equal((await c.post('register', body, { csrf: false })).body.error, 'csrf');
  assert.equal((await c.post('register', body, { headers: { 'X-CSRF-Token': 'f'.repeat(64) }, csrf: false })).body.error, 'csrf');
  assert.equal((await c.post('register', JSON.stringify(body), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal((await c.post('register', body, { headers: { Origin: 'https://evil.example' } })).body.error, 'bad_origin');
  assert.equal((await c.post('register', body, { headers: { Origin: s.url } })).status, 200);
  assert.equal(s.outbox().length, 1);
});

test('registration does not reveal existing accounts; validation messages', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  await verifiedUser(s, 'niamh@example.ie');
  const c = new Client(s.url);
  await c.me();
  const again = await c.post('register', { email: 'niamh@example.ie', password: 'another long passphrase', healthConsent: true });
  assert.equal(again.status, 200);
  assert.match(again.body.message, /Check your email/);
  assert.ok(s.outbox().some((m) => m.to === 'niamh@example.ie' && /you already have one/.test(m.text)), 'existing-account email sent');
  assert.equal(JSON.parse(sql('SELECT COUNT(*) AS n FROM users', s.dbName).stdout)[0].n, 1);
  assert.equal((await c.post('register', { email: 'not-an-email', password: PASSWORD, healthConsent: true })).body.error, 'invalid_email');
  assert.equal((await c.post('register', { email: 'a@example.ie', password: 'short', healthConsent: true })).body.error, 'weak_password');
  assert.equal((await c.post('register', { email: 'a@example.ie', password: 'aaaaaaaaaaaaaa', healthConsent: true })).body.error, 'weak_password');
  assert.equal((await c.post('register', { email: 'a@example.ie', password: PASSWORD })).body.error, 'consent_required');
});

test('login errors are generic and rate-limited', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  await verifiedUser(s, 'cian@example.ie');
  const c = new Client(s.url);
  await c.me();
  const wrong = await c.post('login', { email: 'cian@example.ie', password: 'wrong password here' });
  const unknown = await c.post('login', { email: 'nobody@example.ie', password: 'wrong password here' });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.message, unknown.body.message);
  let last;
  for (let i = 0; i < 8; i += 1) last = await c.post('login', { email: 'cian@example.ie', password: 'wrong password here' });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
});

test('two users can never read or change each other’s records', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const a = await verifiedUser(s, 'a@example.ie');
  const b = await verifiedUser(s, 'b@example.ie');
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
  const c = await verifiedUser(s, 'sync@example.ie');
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

test('password reset: generic request, single-use token, logs out every device', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const phone = await verifiedUser(s, 'orla@example.ie');
  const laptop = new Client(s.url);
  await laptop.me();
  await laptop.post('login', { email: 'orla@example.ie', password: PASSWORD });
  assert.ok((await laptop.me()).body.user);

  const req = await laptop.post('request-reset', { email: 'orla@example.ie' });
  const reqUnknown = await laptop.post('request-reset', { email: 'nobody@example.ie' });
  assert.equal(req.body.message, reqUnknown.body.message);
  const mail = s.outbox().filter((m) => m.subject.includes('Reset')).pop();
  assert.match(mail.text, /#account\/reset\?token=/);
  const token = tokenFrom(mail);
  assert.equal((await laptop.post('reset', { token, password: 'short' })).body.error, 'weak_password');
  const ok = await laptop.post('reset', { token, password: 'a brand new long passphrase' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await laptop.post('reset', { token, password: 'yet another long passphrase' })).body.error, 'invalid_token');
  assert.equal((await phone.me()).body.user, null, 'other sessions are logged out');
  assert.equal((await phone.call('pull')).status, 401);
  assert.equal((await laptop.post('login', { email: 'orla@example.ie', password: PASSWORD })).status, 401);
  assert.equal((await laptop.post('login', { email: 'orla@example.ie', password: 'a brand new long passphrase' })).status, 200);
});

test('account deletion needs the password and removes everything; logout works', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const c = await verifiedUser(s, 'del@example.ie');
  await c.post('push', { records: [rec('weights', 'w1', '2026-11-01T08:00:00Z', { weightKg: 70 })] });
  assert.equal((await c.post('delete', { password: 'wrong password here' })).status, 401);
  const del = await c.post('delete', { password: PASSWORD });
  assert.equal(del.status, 200);
  assert.equal((await c.me()).body.user, null);
  for (const table of ['users', 'records', 'auth_tokens']) {
    assert.equal(JSON.parse(sql(`SELECT COUNT(*) AS n FROM ${table}`, s.dbName).stdout)[0].n, 0, table);
  }
  const d = await verifiedUser(s, 'again@example.ie');
  assert.equal((await d.post('logout', {})).status, 200);
  assert.equal((await d.me()).body.user, null);
  assert.equal((await d.call('pull')).status, 401);
});

test('cleanup removes unconfirmed sign-ups after 7 days and expired tokens', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  await verifiedUser(s, 'keep@example.ie');
  const c = new Client(s.url);
  await c.me();
  await c.post('register', { email: 'stale@example.ie', password: PASSWORD, healthConsent: true });
  sql("UPDATE users SET created_at = UTC_TIMESTAMP() - INTERVAL 8 DAY WHERE email = 'stale@example.ie'", s.dbName);
  const r = spawnSync('php', [path.join(s.priv, 'app', 'bin', 'cleanup.php')], { encoding: 'utf8', env: { ...process.env, LETSGETFIT_PRIVATE_DIR: s.priv } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 unconfirmed sign-ups/);
  assert.deepEqual(JSON.parse(sql('SELECT email FROM users', s.dbName).stdout).map((u) => u.email), ['keep@example.ie']);
  assert.ok(!r.stdout.includes('@'), 'no personal data printed');
});
