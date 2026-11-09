// Integration tests for the PHP API: real `php -S` servers for the app and a mock FDC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const skip = spawnSync('php', ['-v']).status === 0 ? false : 'php not installed';

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function phpServer(args, env) {
  const port = await freePort();
  const proc = spawn('php', ['-S', `127.0.0.1:${port}`, ...args], { env: { ...process.env, ...env }, stdio: 'ignore' });
  for (let i = 0; i < 50; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return { url: `http://127.0.0.1:${port}`, stop: () => proc.kill() };
}

async function setup({ key = 'test-key', withPrivate = true } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'lgf-api-'));
  const countFile = path.join(base, 'count');
  writeFileSync(countFile, '0');
  const mock = await phpServer([path.join(REPO, 'tests', 'php', 'mock-fdc.php')], { MOCK_FDC_COUNT_FILE: countFile });
  const priv = path.join(base, 'letsgetfit-private');
  if (withPrivate) {
    mkdirSync(path.join(priv, 'config'), { recursive: true });
    symlinkSync(path.join(REPO, 'server'), path.join(priv, 'app'));
    writeFileSync(
      path.join(priv, 'config', 'app.php'),
      `<?php return ${JSON.stringify({ fdc_api_key: key, fdc_base_url: `${mock.url}/v1`, timeout_seconds: 2, connect_timeout_seconds: 2, hash_secret: 'x' })
        .replace(/^\{/, '[')
        .replace(/\}$/, ']')
        .replace(/":/g, '" =>')};`,
    );
  }
  const app = await phpServer(['-t', path.join(REPO, 'public')], { LETSGETFIT_PRIVATE_DIR: priv });
  return {
    app,
    priv,
    upstreamCalls: () => Number(readFileSync(countFile, 'utf8')),
    stop() {
      app.stop();
      mock.stop();
      rmSync(base, { recursive: true, force: true });
    },
  };
}

const get = async (url, init) => {
  const res = await fetch(url, init);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
};

test('health reports PHP version and configuration, without secrets', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const r = await get(`${s.app.url}/api/health.php`);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.match(r.body.php, /^\d+\.\d+$/);
  assert.equal(r.body.extensions.curl, true);
  assert.equal(r.body.foodSearch, 'configured');
  assert.equal(r.body.storageWritable, true);
  assert.ok(!JSON.stringify(r.body).includes('test-key'));
  assert.match(r.headers.get('content-type'), /application\/json/);
});

test('food search returns normalised results, then serves the cache', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const before = s.upstreamCalls(); // the server start-up probe also counts
  const r1 = await get(`${s.app.url}/api/foods.php?q=apple`);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.results.length, 4);
  assert.equal(r1.body.results[1].per100g.energy, 52);
  assert.equal(r1.body.results[2].basis, '100ml');
  assert.match(r1.body.attribution, /FoodData Central/);
  assert.equal(r1.body.cached, false);
  const r2 = await get(`${s.app.url}/api/foods.php?q=APPLE`);
  assert.equal(r2.body.cached, true);
  assert.equal(s.upstreamCalls() - before, 1, 'second search must come from the cache');
});

test('upstream timeout, error and rate limit become clear JSON errors', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const started = Date.now();
  const slow = await get(`${s.app.url}/api/foods.php?q=slow`);
  assert.equal(slow.status, 504);
  assert.equal(slow.body.error, 'timeout');
  assert.ok(Date.now() - started < 3900, 'the server timeout (2 s) must cut the request short');
  const err = await get(`${s.app.url}/api/foods.php?q=error`);
  assert.equal(err.status, 502);
  assert.equal(err.body.error, 'upstream_unavailable');
  const busy = await get(`${s.app.url}/api/foods.php?q=busy`);
  assert.equal(busy.status, 503);
  assert.equal(busy.body.error, 'upstream_busy');
  for (const r of [slow, err, busy]) assert.match(r.body.message, /manually/);
});

test('invalid key is reported as not configured', { skip }, async (t) => {
  const s = await setup({ key: 'wrong-key' });
  t.after(() => s.stop());
  const r = await get(`${s.app.url}/api/foods.php?q=apple`);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'not_configured');
});

test('bad requests: short query, wrong method, internal include file', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  assert.equal((await get(`${s.app.url}/api/foods.php?q=a`)).status, 400);
  const post = await get(`${s.app.url}/api/foods.php?q=apple`, { method: 'POST' });
  assert.equal(post.status, 405);
  const inc = await fetch(`${s.app.url}/api/bootstrap.inc.php`);
  assert.equal(inc.status, 404);
});

test('without the private folder the API says it is not configured', { skip }, async (t) => {
  const s = await setup({ withPrivate: false });
  t.after(() => s.stop());
  const r = await get(`${s.app.url}/api/foods.php?q=apple`);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'not_configured');
});
