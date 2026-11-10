// Checks that public/ is a complete, safe static release:
//  - only deployable file types, no secrets, configs, logs or dependencies
//  - every local href/src in HTML files exists
//  - every relative JS import resolves (recursively from app.js)
//  - no inline scripts, inline event handlers or style attributes (they would break the CSP)
// Usage: node scripts/check-static.mjs

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const ALLOWED_EXT = new Set(['.html', '.css', '.js', '.svg', '.png', '.ico', '.webp', '.webmanifest', '.txt']);
const ALLOWED_DOTFILES = new Set(['.htaccess']);
const problems = [];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const files = await walk(ROOT);
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const parts = rel.split(path.sep);
  const base = parts.at(-1);
  if (parts.some((p) => p === 'node_modules' || p === '.git' || p === '.well-known' || p === 'config')) problems.push(`not deployable: ${rel}`);
  if (base.startsWith('.') && !ALLOWED_DOTFILES.has(base)) problems.push(`dotfile not allowed: ${rel}`);
  const isApiPhp = parts.length === 2 && parts[0] === 'api' && base.endsWith('.php');
  if (!base.startsWith('.') && !ALLOWED_EXT.has(path.extname(base)) && !isApiPhp) problems.push(`file type not allowed: ${rel}`);
}

// PHP in the web root must stay thin: entry points that load code from the private folder.
for (const file of files.filter((f) => f.endsWith('.php'))) {
  const rel = path.relative(ROOT, file);
  const code = await readFile(file, 'utf8');
  const maxLines = rel.endsWith('.inc.php') ? 100 : 60;
  if (code.split('\n').length > maxLines) problems.push(`${rel}: PHP entry points must stay small; put logic in server/`);
  if (/(api[_-]?key|password|secret)\s*[=:>]+\s*['"][^'"]{6,}/i.test(code)) problems.push(`${rel}: looks like it contains a secret`);
  if (!/^<\?php\s+declare\(strict_types=1\);/.test(code)) problems.push(`${rel}: must start with declare(strict_types=1)`);
}

const htmlFiles = files.filter((f) => f.endsWith('.html'));
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const rel = path.relative(ROOT, file);
  if (!/<html[^>]*\blang="en-IE"/.test(html)) problems.push(`${rel}: <html lang="en-IE"> missing`);
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) problems.push(`${rel}: inline <script> found`);
  if (/\son[a-z]+\s*=/i.test(html)) problems.push(`${rel}: inline event handler found`);
  if (/\sstyle\s*=/i.test(html)) problems.push(`${rel}: style attribute found`);
  for (const [, url] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|#|data:)/.test(url)) continue;
    const target = url.startsWith('/') ? path.join(ROOT, url) : path.join(path.dirname(file), url);
    if (!existsSync(target.split(/[?#]/)[0])) problems.push(`${rel}: missing ${url}`);
  }
}

const seen = new Set();
async function checkImports(file) {
  if (seen.has(file)) return;
  seen.add(file);
  if (!existsSync(file)) {
    problems.push(`missing module: ${path.relative(ROOT, file)}`);
    return;
  }
  const code = await readFile(file, 'utf8');
  for (const [, spec] of code.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g)) {
    if (!spec.startsWith('.')) {
      problems.push(`${path.relative(ROOT, file)}: bare import "${spec}" will not work without a build step`);
      continue;
    }
    await checkImports(path.resolve(path.dirname(file), spec));
  }
}
await checkImports(path.join(ROOT, 'assets', 'js', 'app.js'));
// The service worker is its own entry point: no imports (a classic worker), and its cached files must exist.
const swFile = path.join(ROOT, 'sw.js');
if (existsSync(swFile)) {
  seen.add(swFile);
  const sw = await readFile(swFile, 'utf8');
  if (/^\s*import\s/m.test(sw)) problems.push('sw.js: must not use import (registered as a classic worker)');
  for (const [, list] of sw.matchAll(/const SHELL = \[([^\]]*)\]/g)) {
    for (const [, url] of list.matchAll(/'([^']+)'/g)) {
      if (url !== './' && !existsSync(path.join(ROOT, url))) problems.push(`sw.js: cached file missing: ${url}`);
    }
  }
}
// The web app manifest: valid JSON, and every icon it names exists.
const manifestFile = path.join(ROOT, 'manifest.webmanifest');
if (existsSync(manifestFile)) {
  try {
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    const icons = [...(manifest.icons ?? []), ...(manifest.shortcuts ?? []).flatMap((s) => s.icons ?? [])];
    if (!manifest.icons?.some((i) => i.sizes === '512x512') || !manifest.icons?.some((i) => i.sizes === '192x192')) problems.push('manifest.webmanifest: needs 192x192 and 512x512 icons');
    for (const icon of icons) if (!existsSync(path.join(ROOT, icon.src))) problems.push(`manifest.webmanifest: missing icon ${icon.src}`);
  } catch {
    problems.push('manifest.webmanifest: not valid JSON');
  }
}
for (const js of files.filter((f) => f.endsWith('.js'))) {
  if (!seen.has(js)) problems.push(`unused module (not reachable from app.js): ${path.relative(ROOT, js)}`);
}

if (problems.length) {
  console.error(`Static check failed:\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`Static check passed: ${files.length} files, ${seen.size} JS modules, ${htmlFiles.length} HTML pages.`);
