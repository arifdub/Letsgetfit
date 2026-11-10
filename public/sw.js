// LetsGetFit service worker: makes the app work offline and shows push notifications.
//
// Caching: network first, so people always get the latest version when online; the last good
// copy of each page, script, style and icon is kept for offline use. The API is never cached
// (food search, accounts and scans need the server, and their answers can be personal).

const CACHE = 'letsgetfit-v2';
const SHELL = ['./', './index.html', './assets/css/app.css', './assets/js/app.js', './favicon.svg', './manifest.webmanifest', './icons/icon-192.png', './privacy.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('letsgetfit-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // The server API (…/api/*.php) is never cached; the app's own scripts in assets/js/api/ are.
  if (url.origin !== self.location.origin || url.pathname.startsWith(new URL('api/', self.registration.scope).pathname)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
        if (cached) return cached;
        if (request.mode === 'navigate') return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
        return Response.error();
      }),
  );
});

// Push messages are JSON: { title, body, url, tag }. Text is shown as given, never as HTML.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 60) : 'LetsGetFit';
  const url = typeof data.url === 'string' && /^\.\/(#[a-z-]+)?$/.test(data.url) ? data.url : './';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body.slice(0, 200) : '',
      icon: './icons/icon-192.png',
      badge: './icons/badge-96.png',
      tag: typeof data.tag === 'string' ? data.tag.slice(0, 40) : 'letsgetfit',
      data: { url },
      lang: 'en-IE',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          client.navigate?.(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
