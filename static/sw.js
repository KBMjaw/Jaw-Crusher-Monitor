/* Crusher Monitor service worker — offline app shell + push-ready handlers. */

const VERSION = 'cm-v1.2.1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/app.css',
  '/js/main.js',
  '/js/config.js',
  '/js/router.js',
  '/js/core/auth.js',
  '/js/core/control.js',
  '/js/core/format.js',
  '/js/core/settings.js',
  '/js/core/storage.js',
  '/js/core/store.js',
  '/js/services/dataService.js',
  '/js/services/mockService.js',
  '/js/services/mockData.js',
  '/js/services/apiService.js',
  '/js/services/reportService.js',
  '/js/pwa/install.js',
  '/js/pwa/notifications.js',
  '/js/pwa/update.js',
  '/js/ui/icons.js',
  '/js/ui/components.js',
  '/js/ui/charts.js',
  '/js/ui/shell.js',
  '/js/ui/scene.js',
  '/js/ui/widgets.js',
  '/assets/logo-mark.svg',
  '/assets/logo-mark.png',
  '/assets/logo-full.svg',
  '/js/views/login.js',
  '/js/views/dashboard.js',
  '/js/views/machine.js',
  '/js/views/camera.js',
  '/js/views/alerts.js',
  '/js/views/analytics.js',
  '/js/views/profile.js',
  '/js/views/help.js',
  '/js/views/auditLog.js',
  '/js/services/auditService.js',
  '/js/core/security.js',
  '/js/ui/pinDialog.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
];
// Large report libraries are cached on first use.
const LAZY = ['/vendor/jspdf.umd.min.js', '/vendor/jspdf.plugin.autotable.min.js', '/vendor/xlsx.mini.min.js'];

// A new version installs in the background and then WAITS. The page shows a
// "New version available — Reload" banner; only when the user taps Reload
// does the page send SKIP_WAITING. The first install activates immediately.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      // Pages from v1.0/v1.1 have no update banner, so for that one-time
      // transition activate like before (still no forced reload).
      .then(() => caches.keys())
      .then((keys) => { if (keys.some((k) => /^cm-v1\.[01]\./.test(k))) self.skipWaiting(); }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts, future API etc. go to network
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;

  // Each version is served from its own precached snapshot, so old and new
  // files are never mixed. New versions arrive only through a new sw.js
  // (bump VERSION on every release) and the user-approved update banner.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(VERSION)
        .then((c) => c.match('/index.html'))
        .then((cached) => cached || fetch(req)),
    );
    return;
  }

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      const res = await fetch(req);
      // Report libraries are cached on first use (same version cache).
      if (res.ok && LAZY.includes(url.pathname)) cache.put(req, res.clone());
      return res;
    }),
  );
});

/* ── Push notifications (ready for the backend; no push server yet) ── */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Crusher Monitor', body: event.data?.text() }; }
  const title = data.title || 'Crusher Monitor';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'crusher-monitor',
      data: { url: data.url || '/#/alerts' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/#/alerts';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) { win.focus(); win.navigate(target); return; }
      return self.clients.openWindow(target);
    }),
  );
});
