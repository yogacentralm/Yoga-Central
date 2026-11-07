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
const zlib = require('zlib');
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
  writeIcons(path.join(out, 'app', 'icons'));

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
const IMAGES = 'images-v1';
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './app/styles.css?v=${hash}', './app/app.js?v=${hash}',
  './app/icons/icon-192.png', './app/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k))))
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
    e.respondWith(cacheFirst(req, IMAGES, 80));
  }
});
`;
}

// ---------------------------------------------------------------- íconos
// El logo del sitio (círculo + hoja + dos pétalos, del SVG de Index.html) dibujado en blanco
// sobre el verde de marca, con suavizado por supermuestreo. Solo se generan si no existen.
function writeIcons(dir) {
  const specs = [
    ['icon-192.png', 192, 'rounded'], ['icon-512.png', 512, 'rounded'],
    ['maskable-512.png', 512, 'full'], ['apple-touch-icon.png', 180, 'full'],
  ];
  specs.forEach(([name, size, shape]) => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, png(size, size, drawIcon(size, shape)));
  });
}

function drawIcon(size, shape) {
  const BG = [0x66, 0x9C, 0x35];
  const ss = 4; // muestras por lado
  const markScale = shape === 'full' ? 0.58 : 0.66; // el ícono "maskable" deja margen de seguridad
  const u = size * markScale / 40; // el logo está dibujado en una caja de 40 unidades
  const ox = size / 2 - 20 * u, oy = size / 2 - 20 * u;
  const corner = size * 0.22;
  const lens = (ax, ay, bx, by, w) => {
    const mx = (ax + bx) / 2, my = (ay + by) / 2, h = Math.hypot(bx - ax, by - ay) / 2;
    const R = (h * h + w * w) / (2 * w), d = R - w;
    const nx = -(by - ay) / (2 * h), ny = (bx - ax) / (2 * h);
    const c1 = [mx + nx * d, my + ny * d], c2 = [mx - nx * d, my - ny * d];
    return (x, y) => Math.hypot(x - c1[0], y - c1[1]) < R && Math.hypot(x - c2[0], y - c2[1]) < R;
  };
  const leaf = lens(20, 9, 20, 24, 3.2);
  const petalL = lens(9, 22, 20, 28, 2.4);
  const petalR = lens(31, 22, 20, 28, 2.4);
  const inBg = (x, y) => {
    if (shape === 'full') return true;
    const cx = Math.min(Math.max(x, corner), size - corner), cy = Math.min(Math.max(y, corner), size - corner);
    return Math.hypot(x - cx, y - cy) <= corner;
  };
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let a = 0, white = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const x = px + (sx + 0.5) / ss, y = py + (sy + 0.5) / ss;
        if (!inBg(x, y)) continue;
        a++;
        const lx = (x - ox) / u, ly = (y - oy) / u;
        const ring = Math.abs(Math.hypot(lx - 20, ly - 20) - 18) < 0.9;
        if (ring || leaf(lx, ly)) white += 1;
        else if (petalL(lx, ly) || petalR(lx, ly)) white += 0.78;
      }
      const n = ss * ss, i = (py * size + px) * 4;
      const wf = a ? white / a : 0;
      for (let k = 0; k < 3; k++) buf[i + k] = Math.round(BG[k] * (1 - wf) + 255 * wf);
      buf[i + 3] = Math.round(255 * a / n);
    }
  }
  return buf;
}

function png(w, h, rgba) {
  const table = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const v of b) c = table[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { build };

if (require.main === module) {
  const r = build(args());
  console.log('Sitio generado en ' + path.relative(ROOT, r.out || ROOT) + ' (versión ' + r.hash + ')');
}
