const CACHE = 'allmess-inventur-v2';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // App-Shell: Netzwerk zuerst, damit ein Update sofort ankommt, sobald
  // online — Cache dient nur als Absicherung, falls mal keine Verbindung
  // besteht. Damit die App nie an einer veralteten Version hängen bleibt.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, clone));
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Externe Ressourcen (z. B. Export-Bibliothek): stale-while-revalidate,
  // damit sie nach dem ersten Online-Kontakt auch offline verfügbar ist.
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request);
      const fetchPromise = fetch(e.request).then(resp => {
        cache.put(e.request, resp.clone());
        return resp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
