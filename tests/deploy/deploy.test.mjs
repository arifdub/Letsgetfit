// Tests for scripts/deploy.sh using temporary directories as a fake cPanel home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'deploy.sh');

function setup({ marker = true, deployPath, extraConfig = '' } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), 'lgf-home-'));
  const docroot = path.join(home, 'letsgetfit.site');
  mkdirSync(path.join(docroot, '.well-known', 'acme-challenge'), { recursive: true });
  writeFileSync(path.join(docroot, '.well-known', 'acme-challenge', 'token'), 'keep-me');
  writeFileSync(path.join(docroot, 'unrelated.txt'), 'host file');
  if (marker) writeFileSync(path.join(docroot, '.letsgetfit-docroot'), '');
  mkdirSync(path.join(home, '.config', 'letsgetfit'), { recursive: true });
  writeFileSync(
    path.join(home, '.config', 'letsgetfit', 'deploy.env'),
    `# comment\nDEPLOYPATH="${deployPath ?? docroot}"\n${extraConfig}`,
  );
  return { home, docroot };
}

function run(home, env = {}) {
  return spawnSync('bash', [SCRIPT], { cwd: REPO, env: { PATH: process.env.PATH, HOME: home, ...env }, encoding: 'utf8' });
}

test('deploys only public/ and preserves host-managed files', (t) => {
  const { home, docroot } = setup();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const r = run(home);
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['index.html', '404.html', 'favicon.svg', '.htaccess', 'assets/css/app.css', 'assets/js/app.js']) {
    assert.ok(existsSync(path.join(docroot, f)), `${f} should be deployed`);
  }
  for (const f of ['.git', 'scripts', 'tests', 'docs', 'config', 'package.json', 'README.md', '.cpanel.yml', 'public']) {
    assert.ok(!existsSync(path.join(docroot, f)), `${f} must not be deployed`);
  }
  assert.equal(readFileSync(path.join(docroot, '.well-known', 'acme-challenge', 'token'), 'utf8'), 'keep-me');
  assert.equal(readFileSync(path.join(docroot, 'unrelated.txt'), 'utf8'), 'host file');
  assert.match(readFileSync(path.join(home, '.local', 'state', 'letsgetfit', 'deploy.log'), 'utf8'), /commit=/);
});

test('second deploy backs up overwritten files outside the web root and prunes old backups', (t) => {
  const { home } = setup({ extraConfig: 'KEEP_BACKUPS=2\n' });
  t.after(() => rmSync(home, { recursive: true, force: true }));
  assert.equal(run(home).status, 0);
  const backups = path.join(home, 'letsgetfit-backups');
  // First deploy had nothing to overwrite.
  assert.ok(!existsSync(backups) || readdirSync(backups).length === 0);
  for (let i = 0; i < 3; i += 1) {
    // Ensure distinct timestamps.
    spawnSync('sleep', ['1.1']);
    assert.equal(run(home).status, 0);
  }
  const files = readdirSync(backups).filter((f) => f.startsWith('docroot-'));
  assert.equal(files.length, 2);
});

test('fails safely without a settings file', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'lgf-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const r = run(home);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /settings file not found/);
});

test('fails safely when the marker file is missing', (t) => {
  const { home, docroot } = setup({ marker: false });
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const r = run(home);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /marker file/);
  assert.ok(!existsSync(path.join(docroot, 'index.html')));
});

test('rejects unsafe or invalid destinations', (t) => {
  const cases = [
    ['relative/path', /absolute/],
    ['', /empty/],
    ['/does/not/exist/anywhere', /does not exist/],
    [REPO, /inside the repository|repository checkout is inside/],
    [path.join(REPO, 'public'), /inside the repository/],
    ['/', /refusing to deploy to \//],
  ];
  for (const [deployPath, pattern] of cases) {
    const { home } = setup({ deployPath });
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const r = run(home);
    assert.notEqual(r.status, 0, `should fail for "${deployPath}"`);
    assert.match(r.stderr, pattern, `"${deployPath}": ${r.stderr}`);
  }
});

test('refuses the home directory itself', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'lgf-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(path.join(home, '.letsgetfit-docroot'), '');
  mkdirSync(path.join(home, '.config', 'letsgetfit'), { recursive: true });
  writeFileSync(path.join(home, '.config', 'letsgetfit', 'deploy.env'), `DEPLOYPATH=${home}\n`);
  const r = run(home);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /home directory/);
});

test('rejects a backup directory inside the document root', (t) => {
  const { home, docroot } = setup({ extraConfig: '' });
  t.after(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(path.join(home, '.config', 'letsgetfit', 'deploy.env'), `DEPLOYPATH=${docroot}\nBACKUP_DIR=${docroot}/backups\n`);
  const r = run(home);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /outside the document root/);
});

test('settings file is read, never executed', (t) => {
  const { home, docroot } = setup();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const canary = path.join(home, 'executed');
  writeFileSync(path.join(home, '.config', 'letsgetfit', 'deploy.env'), `touch ${canary}\nDEPLOYPATH=${docroot}\n`);
  assert.equal(run(home).status, 0);
  assert.ok(!existsSync(canary));
});

test('.cpanel.yml runs the deploy script and nothing else', () => {
  const yml = readFileSync(path.join(REPO, '.cpanel.yml'), 'utf8');
  const tasks = yml.split('\n').filter((l) => /^\s+-\s/.test(l)).map((l) => l.trim());
  assert.deepEqual(tasks, ['- /bin/bash scripts/deploy.sh']);
  assert.match(yml, /^---\n/);
  assert.match(yml, /^deployment:\n {2}tasks:/m);
});
