/* Web Push handlers (ADR 0031), imported by the generated service worker. Shows only the title, body and tag the
   dispatcher sends, and opens only same-origin paths. */
self.addEventListener('push', (event) => {
  let data;
  try {
    data = (event.data && event.data.json()) || {};
  } catch {
    data = {};
  }
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const title = text(data.title, 60) || 'Marsad';
  const url = typeof data.url === 'string' && /^\/(?!\/)/.test(data.url) ? data.url : '/';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: text(data.body, 140),
      tag: text(data.tag, 80) || undefined,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || '/';
  const target = new URL(path, self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          return w.focus().then((f) => (f && 'navigate' in f ? f.navigate(target.href) : f));
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
