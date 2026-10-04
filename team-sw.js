/* Service worker for the RAFD ambassadors admin app (/team#/admin).
   Its only job: show the push the `team-push` Edge Function sends when a
   representative adds a client, and open the dashboard when it is tapped. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'سفراء رفد', {
    body: d.body || '',
    icon: '/team-icon-192.png',
    badge: '/team-icon-192.png',
    tag: d.tag || 'team-lead',
    renotify: true,
    data: { url: d.url || '/team#/admin' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/team#/admin';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.includes('/team')) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
