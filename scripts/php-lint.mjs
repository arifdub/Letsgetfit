// Runs `php -l` on every PHP file in the repository (server/, public/api/, config/, tests/php/).
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['server', 'public/api', 'config', 'tests/php', 'scripts'];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'vendor') walk(full);
    }
    else if (name.endsWith('.php')) files.push(full);
  }
};
for (const d of dirs) walk(path.join(ROOT, d));
let failed = 0;
for (const f of files) {
  const r = spawnSync('php', ['-l', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed += 1;
    console.error(r.stdout || r.stderr);
  }
}
console.log(`PHP lint: ${files.length - failed}/${files.length} files OK`);
process.exit(failed ? 1 : 0);
