// Integration tests for the AI meal scan: real `php -S` app with mock OpenAI and mock FDC servers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const skip = spawnSync('php', ['-r', 'exit(function_exists("imagejpeg") ? 0 : 1);']).status === 0 ? false : 'php with GD not installed';

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function phpServer(args, env) {
  const port = await freePort();
  const proc = spawn('php', ['-S', `127.0.0.1:${port}`, ...args], { env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4', ...env }, stdio: 'ignore' });
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

const phpArray = (obj) => spawnSync('php', ['-r', 'var_export(json_decode(getenv("J"), true));'], { encoding: 'utf8', env: { ...process.env, J: JSON.stringify(obj) } }).stdout;

function jpeg(w = 400, h = 300) {
  const r = spawnSync('php', ['-r', `$i = imagecreatetruecolor(${w}, ${h}); imagefill($i, 0, 0, imagecolorallocate($i, 220, 60, 40)); imagejpeg($i, null, 85);`]);
  return r.stdout;
}

async function setup(over = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'lgf-scan-'));
  const counts = { ai: path.join(base, 'ai-count'), fdc: path.join(base, 'fdc-count') };
  writeFileSync(counts.ai, '0');
  writeFileSync(counts.fdc, '0');
  const ai = await phpServer([path.join(REPO, 'tests', 'php', 'mock-openai.php')], { MOCK_OPENAI_COUNT_FILE: counts.ai });
  const fdc = await phpServer([path.join(REPO, 'tests', 'php', 'mock-fdc.php')], { MOCK_FDC_COUNT_FILE: counts.fdc });
  const priv = path.join(base, 'letsgetfit-private');
  mkdirSync(path.join(priv, 'config'), { recursive: true });
  symlinkSync(path.join(REPO, 'server'), path.join(priv, 'app'));
  writeFileSync(
    path.join(priv, 'config', 'app.php'),
    `<?php return ${phpArray({
      openai_api_key: 'sk-test', openai_base_url: `${ai.url}/v1`, openai_model: 'mock-ok', scan_timeout_seconds: 2,
      fdc_api_key: 'test-key', fdc_base_url: `${fdc.url}/v1`, hash_secret: 'scan-secret',
      scan_per_visitor_per_10min: 50, scan_per_visitor_per_day: 50, scan_daily_limit: 100,
      ...over,
    })};`,
  );
  const app = await phpServer(['-t', path.join(REPO, 'public')], { LETSGETFIT_PRIVATE_DIR: priv });
  const aiCalls = () => Number(readFileSync(counts.ai, 'utf8'));
  // The server start-up probe counts as one call on each mock.
  const aiStart = aiCalls();
  return {
    app,
    priv,
    aiCalls: () => aiCalls() - aiStart,
    stop() {
      app.stop();
      ai.stop();
      fdc.stop();
      rmSync(base, { recursive: true, force: true });
    },
  };
}

async function scan(url, { image = jpeg(), consent = true, requestId = randomUUID(), origin } = {}) {
  const form = new FormData();
  if (image) form.append('photo', new Blob([image], { type: 'image/jpeg' }), 'meal.jpg');
  const headers = { 'X-Request-Id': requestId };
  if (consent) headers['X-Scan-Consent'] = 'yes';
  if (origin) headers.Origin = origin;
  const res = await fetch(`${url}/api/scan.php`, { method: 'POST', body: form, headers });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

test('scan returns suggestions with food database candidates, never nutrients from the AI', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const health = await (await fetch(`${s.app.url}/api/health.php`)).json();
  assert.equal(health.aiScan, 'enabled');
  assert.equal(health.gd, true);
  const r = await scan(s.app.url);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.isFood, true);
  assert.equal(r.body.items.length, 2);
  const apple = r.body.items[0];
  assert.deepEqual([apple.name, apple.gramsLow, apple.gramsEstimate, apple.gramsHigh], ['Apple slices', 90, 120, 150]);
  assert.ok(apple.candidates.length >= 1 && apple.candidates.length <= 3);
  assert.equal(apple.candidates[0].source, 'usda-fdc');
  assert.ok(Number.isFinite(apple.candidates[0].per100g.energy), 'nutrients come from the database');
  assert.ok(!('energy' in apple) && !('calories' in apple), 'no AI nutrient numbers');
  assert.deepEqual(r.body.questions, ['Was there any honey or sugar added?']);
  assert.match(r.body.disclaimer, /cannot show allergens/);
  // Nothing about the photo is stored.
  assert.ok(!existsSync(path.join(s.priv, 'storage', 'uploads')));
  const stored = readdirSync(path.join(s.priv, 'storage'), { recursive: true }).map(String);
  assert.ok(!stored.some((f) => /\.(jpe?g|png|webp)$/i.test(f)), stored.join(','));
});

test('consent, request ID and origin are required', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  assert.equal((await scan(s.app.url, { consent: false })).body.error, 'consent_required');
  assert.equal((await scan(s.app.url, { requestId: 'x' })).body.error, 'bad_request');
  assert.equal((await scan(s.app.url, { origin: 'https://evil.example' })).body.error, 'bad_origin');
  assert.equal((await fetch(`${s.app.url}/api/scan.php`)).status, 405);
  assert.equal(s.aiCalls(), 0, 'no AI call without consent');
});

test('a repeated submission returns the first result without a new AI call', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  const requestId = randomUUID();
  const [a, b] = await Promise.all([scan(s.app.url, { requestId }), scan(s.app.url, { requestId })]);
  const statuses = [a.status, b.status].sort();
  // Either both succeed (one from cache) or one is told the scan is in progress.
  assert.ok(JSON.stringify(statuses) === '[200,200]' || JSON.stringify(statuses) === '[200,409]', statuses.join());
  const c = await scan(s.app.url, { requestId });
  assert.equal(c.status, 200);
  assert.equal(c.body.repeat, true);
  assert.equal(s.aiCalls(), 1);
});

test('bad uploads are rejected before any AI call', { skip }, async (t) => {
  const s = await setup();
  t.after(() => s.stop());
  assert.equal((await scan(s.app.url, { image: null })).body.error, 'no_image');
  assert.equal((await scan(s.app.url, { image: Buffer.from('<?php system("id");') })).body.error, 'unsupported_type');
  assert.equal((await scan(s.app.url, { image: jpeg(20, 20) })).body.error, 'bad_image');
  assert.equal(s.aiCalls(), 0);
});

test('per-visitor and site-wide limits', { skip }, async (t) => {
  const s = await setup({ scan_per_visitor_per_10min: 2 });
  t.after(() => s.stop());
  assert.equal((await scan(s.app.url)).status, 200);
  assert.equal((await scan(s.app.url)).status, 200);
  const third = await scan(s.app.url);
  assert.equal(third.status, 429);
  assert.match(third.body.message, /manually/);
  const s2 = await setup({ scan_daily_limit: 1 });
  t.after(() => s2.stop());
  assert.equal((await scan(s2.app.url)).status, 200);
  assert.equal((await scan(s2.app.url)).body.error, 'daily_limit');
  assert.equal(s2.aiCalls(), 1);
});

test('provider timeout, refusal, error and non-food photos', { skip }, async (t) => {
  for (const [model, status, code] of [['mock-slow', 504, 'timeout'], ['mock-refuse', 422, 'refused'], ['mock-500', 502, 'provider_unavailable']]) {
    const s = await setup({ openai_model: model });
    t.after(() => s.stop());
    const r = await scan(s.app.url);
    assert.equal(r.status, status, model);
    assert.equal(r.body.error, code);
    assert.match(r.body.message, /manually/);
  }
  const nf = await setup({ openai_model: 'mock-notfood' });
  t.after(() => nf.stop());
  const r = await scan(nf.app.url);
  assert.equal(r.status, 200);
  assert.equal(r.body.isFood, false);
  assert.deepEqual(r.body.items, []);
});

test('scan is off without a key, and a wrong key is reported as not configured', { skip }, async (t) => {
  const off = await setup({ openai_api_key: '' });
  t.after(() => off.stop());
  assert.equal((await (await fetch(`${off.app.url}/api/health.php`)).json()).aiScan, 'disabled');
  assert.equal((await scan(off.app.url)).body.error, 'not_configured');
  const wrong = await setup({ openai_api_key: 'sk-wrong' });
  t.after(() => wrong.stop());
  const r = await scan(wrong.app.url);
  assert.equal(r.body.error, 'not_configured');
  assert.ok(!JSON.stringify(r.body).includes('sk-'), 'no key in responses');
});
