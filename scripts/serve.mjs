// Minimal static file server for local development and tests. Serves ./public only.
// Usage: node scripts/serve.mjs [port]   (default 8080)

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

async function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const target = path.normalize(path.join(ROOT, decoded));
  if (!target.startsWith(ROOT)) return null;
  // Mirror .htaccess: never serve dotfiles.
  if (path.relative(ROOT, target).split(path.sep).some((part) => part.startsWith('.'))) return null;
  try {
    const s = await stat(target);
    if (s.isDirectory()) return resolveFile(path.posix.join(urlPath, 'index.html'));
    return target;
  } catch {
    return null;
  }
}

export function startServer(port = 8080, host = '127.0.0.1') {
  const server = http.createServer(async (req, res) => {
    const file = await resolveFile(req.url ?? '/');
    if (!file) {
      res.writeHead(404, { 'Content-Type': TYPES['.html'] });
      res.end(await readFile(path.join(ROOT, '404.html')));
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    res.end(await readFile(file));
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 8080);
  const server = await startServer(port);
  const { port: actual } = server.address();
  console.log(`LetsGetFit is running at http://127.0.0.1:${actual}/`);
}
