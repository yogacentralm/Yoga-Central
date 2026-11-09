// Generado por dev/build.js — no editar a mano.
const VERSION = 'ea51f92784';
const SHELL = 'shell-' + VERSION;
const RUNTIME = 'runtime-v1';
const IMAGES = 'images-v2'; // v1 pudo guardar fotos de Drive fallidas (respuestas opacas)
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './app/styles.css?v=ea51f92784', './app/app.js?v=ea51f92784',
  './app/icons/icon-192.png', './app/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => (k.startsWith('shell-') && k !== SHELL) || (k.startsWith('images-') && k !== IMAGES)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Responde al instante con lo guardado y actualiza en segundo plano.
function staleWhileRevalidate(req, cacheName, key) {
  return caches.open(cacheName).then(cache => cache.match(key || req).then(hit => {
    const net = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(key || req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
}

function cacheFirst(req, cacheName, maxEntries) {
  return caches.open(cacheName).then(cache => cache.match(req).then(hit => hit || fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone());
      if (maxEntries) cache.keys().then(keys => keys.slice(0, Math.max(0, keys.length - maxEntries)).forEach(k => cache.delete(k)));
    }
    return res;
  })));
}

// Fotos de Drive: se piden con CORS y sin la dirección de la página (Drive las rechaza con ella)
// y solo se guardan si llegaron bien, para no quedarse con una foto rota.
function driveImage(req) {
  return caches.open(IMAGES).then(cache => cache.match(req.url).then(hit => hit || fetch(req.url, {
    mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
  }).then(res => {
    if (res.ok) {
      cache.put(req.url, res.clone());
      cache.keys().then(keys => keys.slice(0, Math.max(0, keys.length - 80)).forEach(k => cache.delete(k)));
    }
    return res;
  }).catch(() => fetch(req))));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return; // la API usa POST y siempre va a la red
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (req.mode === 'navigate') e.respondWith(staleWhileRevalidate(req, SHELL, './index.html'));
    else e.respondWith(staleWhileRevalidate(req, SHELL));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req, RUNTIME));
    return;
  }
  if (url.hostname === 'lh3.googleusercontent.com' && req.destination === 'image') {
    e.respondWith(driveImage(req));
  }
});
