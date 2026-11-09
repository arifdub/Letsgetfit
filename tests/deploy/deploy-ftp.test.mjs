// Tests scripts/deploy-ftp.sh against a real local FTPS server (pyftpdlib).
// Needs: lftp, openssl, and a Python with pyftpdlib + pyOpenSSL (set LGF_TEST_PYTHON to choose it).
// Tests are skipped with a message when those tools are missing; CI installs them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import http from 'node:http';
import { cpSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'deploy-ftp.sh');
const PYTHON = process.env.LGF_TEST_PYTHON || 'python3';

const has = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }).status === 0;
const missingTools = [];
if (!has('lftp', ['--version'])) missingTools.push('lftp');
if (!has('openssl', ['version'])) missingTools.push('openssl');
if (!has(PYTHON, ['-c', 'import pyftpdlib, OpenSSL'])) missingTools.push('pyftpdlib/pyOpenSSL');
const skip = missingTools.length ? `missing ${missingTools.join(', ')}` : false;

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Serves the site folder over HTTP, like the live site, so the probe check can be tested.
async function startWeb(docroot) {
  const server = http.createServer(async (req, res) => {
    try {
      const body = await readFile(path.join(docroot, decodeURIComponent(req.url.split('?')[0])));
      res.writeHead(200);
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

async function startFtp({ tls = true, chroot = false } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'lgf-ftp-'));
  const root = path.join(base, 'home');
  // Eco Web Hosting layout: /domains/<domain>/public_html
  const docroot = path.join(root, 'domains', 'letsgetfit.site', 'public_html');
  mkdirSync(path.join(docroot, '.well-known', 'acme-challenge'), { recursive: true });
  writeFileSync(path.join(docroot, '.well-known', 'acme-challenge', 'token'), 'keep-me');
  writeFileSync(path.join(docroot, 'unrelated.txt'), 'host file');
  let cert = 'none';
  if (tls) {
    cert = path.join(base, 'cert.pem');
    const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', cert, '-out', cert], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  const port = await freePort();
  const proc = spawn(PYTHON, [path.join(REPO, 'tests', 'deploy', 'ftp_server.py'), chroot ? docroot : root, String(port), 'deployer', 'p@ss,w0rd "x"', cert], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('FTP server did not start')), 10000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes('READY')) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.on('exit', (code) => reject(new Error(`FTP server exited ${code}`)));
  });
  const fingerprint = tls
    ? spawnSync('openssl', ['x509', '-in', cert, '-noout', '-fingerprint', '-sha1'], { encoding: 'utf8' }).stdout.trim().split('=')[1]
    : null;
  const web = await startWeb(docroot);
  return {
    base,
    root,
    docroot,
    port,
    fingerprint,
    siteUrl: web.url,
    stop() {
      proc.kill();
      web.close();
      rmSync(base, { recursive: true, force: true });
    },
  };
}

function deploy(env) {
  return new Promise((resolve) => {
    const p = spawn('bash', [SCRIPT], { cwd: REPO, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

// A lean copy of server/ without Composer packages keeps each upload fast in tests.
const LEAN_SERVER = mkdtempSync(path.join(tmpdir(), 'lgf-server-'));
cpSync(path.join(REPO, 'server'), LEAN_SERVER, { recursive: true, filter: (src) => !src.includes(`${path.sep}vendor`) });

// Pass the ftp handle (preferred) or a bare port.
const creds = (ftp, extra = {}) => ({
  FTP_SERVER: `ftp://127.0.0.1:${typeof ftp === 'number' ? ftp : ftp.port}`,
  FTP_USERNAME: 'deployer',
  FTP_PASSWORD: 'p@ss,w0rd "x"',
  FTP_DIRECTORY: 'domains/letsgetfit.site/public_html',
  FTP_VERIFY_CERT: 'false', // self-signed test certificate
  SITE_URL: typeof ftp === 'number' ? 'http://127.0.0.1:9/' : ftp.siteUrl,
  DEPLOY_DOMAIN: 'letsgetfit.site',
  DEPLOY_SERVER_SOURCE: LEAN_SERVER,
  ...extra,
});

const probeFilesLeft = (dir) => readdirSync(dir).filter((f) => f.startsWith('letsgetfit-probe-'));

test('fails clearly when settings are missing, without connecting', async () => {
  const r = await deploy({ FTP_SERVER: 'example.invalid' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /missing setting\(s\): FTP_USERNAME FTP_PASSWORD FTP_DIRECTORY/);
});

test('rejects unsafe settings', async () => {
  const base = { FTP_SERVER: 'ftp.example.invalid', FTP_USERNAME: 'u', FTP_PASSWORD: 'p', FTP_DIRECTORY: 'site' };
  assert.match((await deploy({ ...base, FTP_DIRECTORY: '../other' })).stderr, /must not contain \.\./);
  assert.match((await deploy({ ...base, FTP_SERVER: 'bad host; rm -rf /' })).stderr, /host name/);
  assert.match((await deploy({ ...base, FTP_VERIFY_CERT: 'maybe' })).stderr, /true or false/);
});

test('uploads only public/ over FTPS and preserves host files', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  writeFileSync(path.join(ftp.docroot, '.letsgetfit-docroot'), '');
  const r = await deploy(creds(ftp));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  for (const f of ['index.html', '404.html', '.htaccess', 'favicon.svg', 'robots.txt', 'assets/css/app.css', 'assets/js/app.js', 'assets/js/lib/energy.js']) {
    assert.ok(existsSync(path.join(ftp.docroot, f)), `${f} should be uploaded`);
  }
  for (const f of ['scripts', 'tests', 'docs', 'config', 'package.json', '.git', 'public', '.cpanel.yml']) {
    assert.ok(!existsSync(path.join(ftp.docroot, f)), `${f} must not be uploaded`);
  }
  assert.equal(readFileSync(path.join(ftp.docroot, 'index.html'), 'utf8'), readFileSync(path.join(REPO, 'public', 'index.html'), 'utf8'));
  assert.equal(readFileSync(path.join(ftp.docroot, '.well-known', 'acme-challenge', 'token'), 'utf8'), 'keep-me');
  assert.equal(readFileSync(path.join(ftp.docroot, 'unrelated.txt'), 'utf8'), 'host file');
  assert.ok(!r.stdout.includes('p@ss') && !r.stderr.includes('p@ss'), 'password must not be printed');

  // A second run (an update) also succeeds.
  const again = await deploy(creds(ftp));
  assert.equal(again.status, 0, again.stderr);
});

test('finds and proves the site folder when the marker is missing, then creates it', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  // FTP_DIR points at the home folder, as a first guess often does.
  const r = await deploy(creds(ftp, { FTP_DIRECTORY: '/' }));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /is the live document root/);
  assert.ok(existsSync(path.join(ftp.docroot, 'index.html')));
  assert.ok(existsSync(path.join(ftp.docroot, '.letsgetfit-docroot')), 'marker should be created');
  assert.ok(!existsSync(path.join(ftp.root, 'index.html')), 'nothing uploaded to the home folder');
  assert.deepEqual(probeFilesLeft(ftp.docroot), []);
  assert.deepEqual(probeFilesLeft(ftp.root), []);
  // The next run uses the marker straight away.
  const again = await deploy(creds(ftp));
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /found \.letsgetfit-docroot/);
});

test('uploads nothing when no folder is served by the site', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  const r = await deploy(creds(ftp, { SITE_URL: 'http://127.0.0.1:9/' }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /could not find the folder that serves/);
  assert.ok(!existsSync(path.join(ftp.docroot, 'index.html')));
  assert.ok(!existsSync(path.join(ftp.docroot, '.letsgetfit-docroot')));
  assert.deepEqual(probeFilesLeft(ftp.docroot), []);
  assert.deepEqual(probeFilesLeft(ftp.root), []);
});

test('stops when the directory does not exist', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  const r = await deploy(creds(ftp, { FTP_DIRECTORY: 'no-such-folder', SITE_URL: 'http://127.0.0.1:9/' }));
  assert.notEqual(r.status, 0);
});

test('dry run changes nothing', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  writeFileSync(path.join(ftp.docroot, '.letsgetfit-docroot'), '');
  const r = await deploy(creds(ftp, { DRY_RUN: 'true' }));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(path.join(ftp.docroot, 'index.html')));
  assert.ok(!existsSync(path.join(ftp.docroot, 'assets')));
});

test('refuses a server without TLS (plain FTP)', { skip }, async (t) => {
  const ftp = await startFtp({ tls: false });
  t.after(() => ftp.stop());
  writeFileSync(path.join(ftp.docroot, '.letsgetfit-docroot'), '');
  const r = await deploy(creds(ftp));
  assert.notEqual(r.status, 0);
  assert.ok(!existsSync(path.join(ftp.docroot, 'index.html')));
});

test('verifies the certificate by default (self-signed is rejected)', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  writeFileSync(path.join(ftp.docroot, '.letsgetfit-docroot'), '');
  const r = await deploy(creds(ftp, { FTP_VERIFY_CERT: '' }));
  assert.notEqual(r.status, 0);
  assert.ok(!existsSync(path.join(ftp.docroot, 'index.html')));
});

test('a pinned certificate fingerprint is trusted while verification stays on', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  writeFileSync(path.join(ftp.docroot, '.letsgetfit-docroot'), '');
  const r = await deploy(creds(ftp, { FTP_VERIFY_CERT: '', FTP_CERT_FINGERPRINT: ftp.fingerprint.toLowerCase() }));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(existsSync(path.join(ftp.docroot, 'index.html')));
});

test('a different pinned fingerprint is rejected', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  writeFileSync(path.join(ftp.docroot, '.letsgetfit-docroot'), '');
  const wrong = ftp.fingerprint.startsWith('00') ? `11${ftp.fingerprint.slice(2)}` : `00${ftp.fingerprint.slice(2)}`;
  const r = await deploy(creds(ftp, { FTP_VERIFY_CERT: '', FTP_CERT_FINGERPRINT: wrong }));
  assert.notEqual(r.status, 0);
  assert.ok(!existsSync(path.join(ftp.docroot, 'index.html')));
});

test('a malformed fingerprint is refused before connecting', async () => {
  const r = await deploy({ FTP_SERVER: 'ftp.example.invalid', FTP_USERNAME: 'u', FTP_PASSWORD: 'p', FTP_DIRECTORY: 'site', FTP_CERT_FINGERPRINT: 'not-a-fingerprint' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SHA-1 fingerprint/);
});

test('server code and settings go next to the document root, never inside it', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  writeFileSync(path.join(ftp.docroot, '.letsgetfit-docroot'), '');
  const priv = path.join(path.dirname(ftp.docroot), 'letsgetfit-private');
  const r = await deploy(creds(ftp, { FDC_API_KEY: 'abcd1234EFGH5678', APP_HASH_SECRET: 'hash-secret-for-tests' }));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(existsSync(path.join(priv, 'app', 'bootstrap.php')));
  assert.ok(existsSync(path.join(priv, 'app', 'src', 'FoodDataCentral.php')));
  const cfg = readFileSync(path.join(priv, 'config', 'app.php'), 'utf8');
  assert.match(cfg, /'fdc_api_key' => 'abcd1234EFGH5678'/);
  assert.match(cfg, /'hash_secret' => 'hash-secret-for-tests'/);
  assert.equal(spawnSync('php', ['-l', path.join(priv, 'config', 'app.php')]).status, 0, 'generated config is valid PHP');
  assert.ok(!existsSync(path.join(ftp.docroot, 'letsgetfit-private')));
  assert.ok(!existsSync(path.join(ftp.docroot, 'src')));
  assert.ok(existsSync(path.join(ftp.docroot, 'api', 'foods.php')), 'thin entry point is public');
  assert.ok(!r.stdout.includes('abcd1234EFGH5678') && !r.stderr.includes('abcd1234EFGH5678'), 'key never printed');

  // Without the secret, the existing settings are kept.
  const again = await deploy(creds(ftp));
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /kept the existing server settings/);
  assert.match(readFileSync(path.join(priv, 'config', 'app.php'), 'utf8'), /abcd1234EFGH5678/);
});

test('first deploy without a key writes demo settings and warns', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  writeFileSync(path.join(ftp.docroot, '.letsgetfit-docroot'), '');
  const r = await deploy(creds(ftp));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DEMO_KEY/);
  const cfg = readFileSync(path.join(path.dirname(ftp.docroot), 'letsgetfit-private', 'config', 'app.php'), 'utf8');
  assert.match(cfg, /'fdc_api_key' => ''/);
});

test('rejects an API key that could break the settings file', async () => {
  // Fails at validation; uses an unreachable server so nothing is uploaded anyway.
  const r = await deploy({ FTP_SERVER: '127.0.0.1:9', FTP_USERNAME: 'u', FTP_PASSWORD: 'p', FTP_DIRECTORY: 'x', FDC_API_KEY: "abc'; system('x'); //" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /FDC_API_KEY must be letters and numbers only/);
  assert.doesNotMatch(r.stdout, /logged in/);
  const r2 = await deploy({ FTP_SERVER: '127.0.0.1:9', FTP_USERNAME: 'u', FTP_PASSWORD: 'p', FTP_DIRECTORY: 'x', APP_HASH_SECRET: "short'" });
  assert.match(r2.stderr, /APP_HASH_SECRET/);
});

test('an FTP account locked to the document root skips the server code safely', { skip }, async (t) => {
  const ftp = await startFtp({ chroot: true });
  t.after(() => ftp.stop());
  writeFileSync(path.join(ftp.docroot, '.letsgetfit-docroot'), '');
  const r = await deploy(creds(ftp, { FTP_DIRECTORY: '/', FDC_API_KEY: 'abcd1234EFGH5678' }));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /cannot reach the folder above the document root/);
  assert.ok(existsSync(path.join(ftp.docroot, 'index.html')));
  assert.ok(!existsSync(path.join(ftp.docroot, 'letsgetfit-private')), 'nothing private inside the web root');
});

test('accounts settings: written safely when switched on with every secret', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  writeFileSync(path.join(ftp.docroot, '.letsgetfit-docroot'), '');
  const tricky = `pa'ss\\"word$(x)`;
  const r = await deploy(creds(ftp, {
    ACCOUNTS_ENABLED: 'true', DB_NAME: 'cpuser_lgf', DB_USER: 'cpuser_lgf', DB_PASSWORD: tricky,
    SMTP_HOST: 'mail.letsgetfit.site', SMTP_USER: 'no-reply@letsgetfit.site', SMTP_PASSWORD: tricky, MAIL_FROM: 'no-reply@letsgetfit.site',
    SITE_URL: ftp.siteUrl,
  }));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /accounts will be switched on/);
  const file = readFileSync(path.join(path.dirname(ftp.docroot), 'letsgetfit-private', 'config', 'app.php'), 'utf8');
  const cfg = JSON.parse(spawnSync('php', ['-r', 'echo json_encode(eval(substr(stream_get_contents(STDIN), 5)));'], { input: file, encoding: 'utf8' }).stdout);
  assert.equal(cfg.accounts_enabled, true);
  assert.equal(cfg.db_password, tricky);
  assert.ok(!r.stdout.includes(tricky) && !r.stderr.includes(tricky), 'secrets never printed');
});

test('accounts settings are built with var_export and pass php -l', () => {
  const tricky = `pa'ss\\"word$(x)`;
  const env = {
    PATH: process.env.PATH, ACCOUNTS_ENABLED: 'true', DB_NAME: 'cpuser_lgf', DB_USER: 'cpuser_lgf', DB_PASSWORD: tricky,
    SMTP_HOST: 'mail.letsgetfit.site', SMTP_USER: 'u', SMTP_PASSWORD: tricky, MAIL_FROM: 'no-reply@letsgetfit.site', FDC_API_KEY: 'abcd1234EFGH',
  };
  const out = spawnSync('php', [path.join(REPO, 'scripts', 'write-config.php')], { encoding: 'utf8', env });
  assert.equal(out.status, 0, out.stderr);
  const lint = spawnSync('php', ['-l'], { input: out.stdout, encoding: 'utf8' });
  assert.equal(lint.status, 0);
  const loaded = spawnSync('php', ['-r', 'echo json_encode(eval(substr(stream_get_contents(STDIN), 5)));'], { input: out.stdout, encoding: 'utf8' });
  const cfg = JSON.parse(loaded.stdout);
  assert.equal(cfg.accounts_enabled, true);
  assert.equal(cfg.db_password, tricky);
  assert.equal(cfg.smtp_password, tricky);
  assert.equal(cfg.db_dsn, 'mysql:host=localhost;port=3306;dbname=cpuser_lgf;charset=utf8mb4');
  assert.equal(cfg.mail_transport, 'smtp');
  assert.equal(cfg.cookie_secure, true);
  assert.equal(cfg.app_url, 'https://letsgetfit.site');
  // Off by default.
  const off = spawnSync('php', [path.join(REPO, 'scripts', 'write-config.php')], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.match(off.stdout, /'accounts_enabled' => false/);
  assert.doesNotMatch(off.stdout, /db_password/);
});

test('switching accounts on with missing secrets stops before connecting', async () => {
  const r = await deploy({ FTP_SERVER: '127.0.0.1:9', FTP_USERNAME: 'u', FTP_PASSWORD: 'p', FTP_DIRECTORY: 'x', ACCOUNTS_ENABLED: 'true', DB_NAME: 'x' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /missing: DB_USER DB_PASSWORD SMTP_HOST SMTP_USER SMTP_PASSWORD MAIL_FROM/);
  assert.doesNotMatch(r.stdout, /logged in/);
});
