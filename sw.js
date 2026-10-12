// ==========================================
// SW.JS — the service worker. Its one job: show a notification the server pushed while the site was closed,
// and open the right page when it is tapped. It caches nothing.
// Registered from home.js when someone turns notifications on.
// ==========================================
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Only pages of this site may be opened from a notification
function pageUrl(link) {
  try {
    const url = new URL(link || 'home.html', self.registration.scope);
    return url.origin === self.location.origin ? url.href : new URL('home.html', self.registration.scope).href;
  } catch (e) {
    return new URL('home.html', self.registration.scope).href;
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* not ours: show the plain notice below */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Connect2Minds', {
    body: data.body || 'Something new is waiting for you.',
    tag: data.tag || undefined,     // a newer notice about the same thing replaces the older one
    renotify: Boolean(data.tag),
    data: { link: data.link || 'home.html' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = pageUrl(event.notification.data && event.notification.data.link);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const open = windows.find(client => client.url.startsWith(self.location.origin) && 'focus' in client);
    if (open) return open.navigate(target).then(client => (client || open).focus()).catch(() => self.clients.openWindow(target));
    return self.clients.openWindow(target);
  }));
});
