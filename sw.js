/* StormShield CRM — background helper for lock-screen alerts.
   Shows the alert the server pushes (notes on your jobs, @mentions, packet opened / signed)
   and opens the right job when you tap it. No offline caching: the CRM always loads fresh. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'StormShield CRM', {
      body: d.body || '',
      tag: d.tag || undefined,
      data: { url: d.url || './' },
      icon: 'favicon-192.png',
      badge: 'favicon-192.png',
    });
    try { if (typeof d.badge === 'number' && self.navigator.setAppBadge) await self.navigator.setAppBadge(d.badge); } catch (err) {}
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.indexOf(self.registration.scope) === 0) {
        try { await w.focus(); } catch (err) {}
        w.postMessage({ type: 'ss-open', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
