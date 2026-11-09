// Tests scripts/deploy-ftp.sh against a real local FTPS server (pyftpdlib).
// Needs: lftp, openssl, and a Python with pyftpdlib + pyOpenSSL (set LGF_TEST_PYTHON to choose it).
// Tests are skipped with a message when those tools are missing; CI installs them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

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

async function startFtp({ tls = true } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'lgf-ftp-'));
  const root = path.join(base, 'home');
  const docroot = path.join(root, 'letsgetfit.site');
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
  const proc = spawn(PYTHON, [path.join(REPO, 'tests', 'deploy', 'ftp_server.py'), root, String(port), 'deployer', 'p@ss,w0rd "x"', cert], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  return {
    base,
    docroot,
    port,
    fingerprint,
    stop() {
      proc.kill();
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

const creds = (port, extra = {}) => ({
  FTP_SERVER: `ftp://127.0.0.1:${port}`,
  FTP_USERNAME: 'deployer',
  FTP_PASSWORD: 'p@ss,w0rd "x"',
  FTP_DIRECTORY: 'letsgetfit.site',
  FTP_VERIFY_CERT: 'false', // self-signed test certificate
  ...extra,
});

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
  const r = await deploy(creds(ftp.port));
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
  const again = await deploy(creds(ftp.port));
  assert.equal(again.status, 0, again.stderr);
});

test('stops before uploading when the marker file is missing', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  const r = await deploy(creds(ftp.port));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /marker file is missing/);
  assert.ok(!existsSync(path.join(ftp.docroot, 'index.html')));
  assert.ok(!existsSync(path.join(ftp.docroot, 'assets')));
});

test('stops when the directory does not exist', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  const r = await deploy(creds(ftp.port, { FTP_DIRECTORY: 'no-such-folder' }));
  assert.notEqual(r.status, 0);
});

test('dry run changes nothing', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  writeFileSync(path.join(ftp.docroot, '.letsgetfit-docroot'), '');
  const r = await deploy(creds(ftp.port, { DRY_RUN: 'true' }));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(path.join(ftp.docroot, 'index.html')));
  assert.ok(!existsSync(path.join(ftp.docroot, 'assets')));
});

test('refuses a server without TLS (plain FTP)', { skip }, async (t) => {
  const ftp = await startFtp({ tls: false });
  t.after(() => ftp.stop());
  writeFileSync(path.join(ftp.docroot, '.letsgetfit-docroot'), '');
  const r = await deploy(creds(ftp.port));
  assert.notEqual(r.status, 0);
  assert.ok(!existsSync(path.join(ftp.docroot, 'index.html')));
});

test('verifies the certificate by default (self-signed is rejected)', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  writeFileSync(path.join(ftp.docroot, '.letsgetfit-docroot'), '');
  const r = await deploy(creds(ftp.port, { FTP_VERIFY_CERT: '' }));
  assert.notEqual(r.status, 0);
  assert.ok(!existsSync(path.join(ftp.docroot, 'index.html')));
});

test('a pinned certificate fingerprint is trusted while verification stays on', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  writeFileSync(path.join(ftp.docroot, '.letsgetfit-docroot'), '');
  const r = await deploy(creds(ftp.port, { FTP_VERIFY_CERT: '', FTP_CERT_FINGERPRINT: ftp.fingerprint.toLowerCase() }));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(existsSync(path.join(ftp.docroot, 'index.html')));
});

test('a different pinned fingerprint is rejected', { skip }, async (t) => {
  const ftp = await startFtp();
  t.after(() => ftp.stop());
  writeFileSync(path.join(ftp.docroot, '.letsgetfit-docroot'), '');
  const wrong = ftp.fingerprint.startsWith('00') ? `11${ftp.fingerprint.slice(2)}` : `00${ftp.fingerprint.slice(2)}`;
  const r = await deploy(creds(ftp.port, { FTP_VERIFY_CERT: '', FTP_CERT_FINGERPRINT: wrong }));
  assert.notEqual(r.status, 0);
  assert.ok(!existsSync(path.join(ftp.docroot, 'index.html')));
});

test('a malformed fingerprint is refused before connecting', async () => {
  const r = await deploy({ FTP_SERVER: 'ftp.example.invalid', FTP_USERNAME: 'u', FTP_PASSWORD: 'p', FTP_DIRECTORY: 'site', FTP_CERT_FINGERPRINT: 'not-a-fingerprint' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SHA-1 fingerprint/);
});
