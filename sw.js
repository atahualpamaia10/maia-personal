/* ── maiaeconomias — service worker ──────────────────────
   Cacheia o app (shell) pra abrir offline e rápido.
   Chamadas ao Supabase (dados/login) nunca são cacheadas. */

const CACHE = 'maiaeconomias-v2';
const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
const LOCAL = [
  './', 'index.html', 'style.css',
  'config.js', 'store.js', 'app.js',
  'manifest.webmanifest', 'icon.svg',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(LOCAL);
    try { await c.add(SDK); } catch (_) {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;            // escrita (POST/PATCH) sempre rede
  if (url.hostname.endsWith('supabase.co')) return;  // dados e login sempre rede
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('index.html')))
  );
});
