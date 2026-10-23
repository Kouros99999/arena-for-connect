/*
 * Arena service worker: makes the pages installable and keeps the shell available when the network is not.
 *
 * - The API (/api/...) is never cached; the pages show their own "API error" line when it is unreachable.
 * - HTML and config.js are network-first with a cache fallback, so an update is picked up on the next open.
 * - Everything else in the shell (engine, icons, manifest) is served from cache and refreshed in the background.
 * Bump VERSION when the shell changes so old caches are dropped.
 */
'use strict';
const VERSION = 'arena-shell-v2';
const SHELL = ['./supervisor-console.html', './agent-panel.html', './report.html', './wallboard.html', './arena-engine.js', './arena-auth.js', './arena-i18n.js', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.includes('/api/') || url.pathname.includes('/kiosk/') || url.pathname.includes('/data/')) return;
  const networkFirst = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('config.js');
  if (networkFirst) {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return r; }).catch(() => caches.match(req).then((r) => r || caches.match('./supervisor-console.html'))));
    return;
  }
  e.respondWith(caches.match(req).then((cached) => {
    const refresh = fetch(req).then((r) => { if (r.ok) caches.open(VERSION).then((c) => c.put(req, r.clone())); return r; }).catch(() => cached);
    return cached || refresh;
  }));
});
