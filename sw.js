/* Invoice GoGo service worker – offline app shell. Bump VERSION on every release. */
const VERSION = 'igg-v3';
const SHELL = ['./', 'index.html', 'style.css', 'logic.js', 'pdf.js', 'vendor/jspdf.umd.min.js', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting())); // tolerate a missing optional file
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return; // never cache CDN / fonts / opaque or the private API
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(m => m || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
