// Service worker بسيط: يخزّن ملفات التطبيق للعمل بدون إنترنت.
// غيّر رقم الإصدار عند أي تعديل على الملفات حتى يُحدَّث الكاش عند المستخدمين.
const CACHE = 'riyadh-guide-v1';
const ASSETS = ['./', './index.html', './places.js', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// شبكة أولًا ثم الكاش — حتى تظهر الأماكن الجديدة فورًا عند وجود إنترنت.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
