// Genera el sitio rápido e instalable para GitHub Pages a partir de src/.
//
//   node dev/build.js                      → escribe en la raíz del repositorio (lo que publica Pages)
//   node dev/build.js --out dev/.site --api http://localhost:8787/__api   (lo usa el simulador)
//
// Mismo diseño y código que la versión de Apps Script; cambia el transporte: la página
// llama a la API JSON (doPost) con fetch, el service worker la guarda en el celular y
// funciona con poca o ninguna señal, y el manifiesto permite instalarla como app.

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// URL de la aplicación web publicada (Implementar → Gestionar implementaciones).
const DEFAULT_API = 'https://script.google.com/macros/s/AKfycbxAhzC4IYx1tq9GcATo1CWdTlhL7lHalcmgR0O2h1NqqioJNHMUPdQTb3x3fyw7qNoWmQ/exec';
const SITE_URL = 'https://yogacentralm.github.io/Yoga-Central/';

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function args() {
  const a = process.argv.slice(2);
  const get = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  return { out: path.resolve(ROOT, get('--out') || '.'), api: get('--api') || DEFAULT_API };
}

function build(opts) {
  const out = opts.out;
  const read = n => fs.readFileSync(path.join(SRC, n), 'utf8');
  const css = read('Styles.html').replace(/^\s*<style>\s*|\s*<\/style>\s*$/g, '');
  const js = read('App.html').replace(/^\s*<script>\s*|\s*<\/script>\s*$/g, '');
  const hash = crypto.createHash('sha1').update(css + js + read('Index.html') + opts.api).digest('hex').slice(0, 10);

  fs.mkdirSync(path.join(out, 'app', 'icons'), { recursive: true });
  fs.writeFileSync(path.join(out, 'app', 'styles.css'), css);
  fs.writeFileSync(path.join(out, 'app', 'app.js'), js);
  copyBrand(out);

  const head = `
  <title>yogacentral · Yoga, meditación y sonoterapia en Torreón</title>
  <meta name="theme-color" content="#FCFCFC">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" type="image/png" sizes="192x192" href="app/icons/icon-192.png">
  <link rel="apple-touch-icon" href="app/icons/apple-touch-icon.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="yogacentral">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="yogacentral">
  <meta property="og:title" content="yogacentral · Yoga en Torreón">
  <meta property="og:description" content="Yoga, meditación y sonoterapia en el centro de Torreón. Tu primera clase es gratis.">
  <meta property="og:url" content="${SITE_URL}">
  <meta property="og:image" content="${SITE_URL}app/icons/icon-512.png">
  <script>addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__ycInstall = e; });</script>
  <link rel="preconnect" href="https://script.google.com">
  <link rel="preconnect" href="https://script.googleusercontent.com" crossorigin>`;
  const index = read('Index.html')
    .replace(/(<meta name="description"[^>]*>)/, '$1' + head)
    .replace(/<\?!=\s*include\('Styles'\);?\s*\?>/, `<link rel="stylesheet" href="app/styles.css?v=${hash}">`)
    .replace(/<\?!=\s*include\('App'\);?\s*\?>/, `<script>window.YC_API = ${JSON.stringify(opts.api)};</script>
  <script src="app/app.js?v=${hash}" defer></script>
  <script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('Sin modo sin conexión:', e.message));</script>`);
  if (/<\?/.test(index)) throw new Error('Quedó una etiqueta de plantilla de Apps Script sin reemplazar en Index.html');
  fs.writeFileSync(path.join(out, 'index.html'), index);

  fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
    name: 'yogacentral · Yoga en Torreón',
    short_name: 'yogacentral',
    description: 'Horarios, reservas y paquetes de yogacentral.',
    lang: 'es-MX',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#FCFCFC',
    theme_color: '#FCFCFC',
    icons: [
      { src: 'app/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'app/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'app/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2));

  fs.writeFileSync(path.join(out, 'sw.js'), serviceWorker(hash));
  return { out, hash };
}

// ---------------------------------------------------------------- service worker
function serviceWorker(hash) {
  return `// Generado por dev/build.js — no editar a mano.
const VERSION = '${hash}';
const SHELL = 'shell-' + VERSION;
const RUNTIME = 'runtime-v1';
const IMAGES = 'images-v2'; // v1 pudo guardar fotos de Drive fallidas (respuestas opacas)
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './app/styles.css?v=${hash}', './app/app.js?v=${hash}',
  './app/icons/icon-192.png', './app/icons/icon-512.png', './app/logo.png', './app/logo-mark.png'];

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
`;
}

// ---------------------------------------------------------------- logo e íconos
// Son los archivos oficiales de app/ (hechos a partir del logo de YogaCentral). Si el sitio se
// genera en otra carpeta (el simulador), se copian ahí.
const BRAND_FILES = ['app/logo.png', 'app/logo-mark.png', 'app/icons/icon-192.png', 'app/icons/icon-512.png',
  'app/icons/maskable-512.png', 'app/icons/apple-touch-icon.png'];
function copyBrand(out) {
  if (path.resolve(out) === ROOT) return;
  BRAND_FILES.forEach(f => fs.copyFileSync(path.join(ROOT, f), path.join(out, f)));
}

module.exports = { build };

if (require.main === module) {
  const r = build(args());
  console.log('Sitio generado en ' + path.relative(ROOT, r.out || ROOT) + ' (versión ' + r.hash + ')');
}
