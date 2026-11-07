// Simulador local de Apps Script para probar yogacentral sin desplegar.
// Ejecuta src/Code.gs dentro de un contexto con versiones en memoria de
// SpreadsheetApp, DriveApp, CacheService, etc. Los datos se guardan en
// dev/.data.json y los archivos subidos en dev/.uploads/.
//
//   node dev/server.js            → http://localhost:8787
//   node dev/server.js --reset    → borra los datos y vuelve a ejecutar setup()
//
// La cuenta que se registre con admin@yogacentral.test será administradora.

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DATA_FILE = path.join(__dirname, '.data.json');
const UPLOADS = path.join(__dirname, '.uploads');
const PORT = Number(process.env.PORT || 8787);
const DEV_ADMIN = 'admin@yogacentral.test';

if (process.argv.includes('--reset')) { fs.rmSync(DATA_FILE, { force: true }); fs.rmSync(UPLOADS, { recursive: true, force: true }); }
fs.mkdirSync(UPLOADS, { recursive: true });

// ---------------------------------------------------------------- estado
let state = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : { props: {}, sheets: {}, files: {} };
const cache = new Map();
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(state));

// ---------------------------------------------------------------- mocks
const toCell = v => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v == null ? '' : String(v));

function makeSheet(name) {
  const rows = () => state.sheets[name];
  const sheet = {
    getName: () => name,
    getDataRange: () => ({ getValues: () => rows().map(r => r.slice()) }),
    appendRow: r => { rows().push(r.map(toCell)); return sheet; },
    deleteRow: i => { rows().splice(i - 1, 1); return sheet; },
    setFrozenRows: () => sheet,
    getLastRow: () => rows().length,
    getLastColumn: () => (rows()[0] || []).length,
    getRange: (r, c, nr, nc) => {
      const rng = {
        getValues: () => rows().slice(r - 1, r - 1 + nr).map(row => Array.from({ length: nc }, (_, j) => (row[c - 1 + j] == null ? '' : row[c - 1 + j]))),
        setNumberFormat: () => rng,
        setFontWeight: () => rng,
        setValues: vals => {
          if (typeof r !== 'number') return rng;
          vals.forEach((row, i) => {
            const target = rows()[r - 1 + i] || (rows()[r - 1 + i] = []);
            row.forEach((v, j) => { target[c - 1 + j] = toCell(v); });
          });
          return rng;
        },
      };
      return rng;
    },
  };
  return sheet;
}

const spreadsheet = id => ({
  getId: () => id,
  getUrl: () => 'http://localhost:' + PORT + '/__db',
  getSheetByName: n => (state.sheets[n] ? makeSheet(n) : null),
  insertSheet: n => { state.sheets[n] = []; return makeSheet(n); },
  getSheets: () => Object.keys(state.sheets).map(makeSheet),
  deleteSheet: s => { delete state.sheets[s.getName()]; },
});

const file = id => ({
  getId: () => id,
  getUrl: () => 'http://localhost:' + PORT + '/__files/' + id,
  getDownloadUrl: () => 'http://localhost:' + PORT + '/__files/' + id,
  moveTo: () => {},
  setSharing: () => {},
});
const folder = id => ({
  getId: () => id,
  createFolder: () => folder(crypto.randomUUID()),
  setSharing: () => {},
  createFile: blob => {
    const fid = crypto.randomUUID().replace(/-/g, '');
    fs.writeFileSync(path.join(UPLOADS, fid), Buffer.from(blob.bytes));
    state.files[fid] = { name: blob.name, mime: blob.mime };
    return file(fid);
  },
});

const toSigned = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));
const toBuf = v => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map(b => b & 255)));

function formatDate(date, tz, fmt) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(p => [p.type, p.value]));
  return fmt.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
    .replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
}

const globals = {
  console,
  Logger: { log: (...a) => console.log(...a) },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in state.props ? state.props[k] : null),
    setProperty: (k, v) => { state.props[k] = String(v); },
  }) },
  CacheService: { getScriptCache: () => ({
    get: k => { const e = cache.get(k); return e && e.exp > Date.now() ? e.v : null; },
    put: (k, v, ttl) => cache.set(k, { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }),
    remove: k => cache.delete(k),
  }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  Session: { getEffectiveUser: () => ({ getEmail: () => DEV_ADMIN }) },
  SpreadsheetApp: {
    create: () => { state.sheets = {}; state.sheets['Hoja 1'] = []; return spreadsheet('dev-db'); },
    openById: id => spreadsheet(id),
  },
  DriveApp: {
    createFolder: () => folder('dev-root'),
    getFolderById: id => folder(id),
    getFileById: id => file(id),
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
    Permission: { VIEW: 'VIEW' },
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, value) => toSigned(crypto.createHash(alg).update(toBuf(value)).digest()),
    base64Encode: v => toBuf(v).toString('base64'),
    base64Decode: s => toSigned(Buffer.from(s, 'base64')),
    newBlob: (data, mime, name) => ({ bytes: typeof data === 'string' ? Buffer.from(data) : toBuf(data), mime, name, getBytes() { return toSigned(this.bytes); } }),
    getUuid: () => crypto.randomUUID(),
    formatDate,
  },
};

const context = vm.createContext(globals);
vm.runInContext(fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8') + '\n;globalThis.__api = api; globalThis.__setup = setup;', context, { filename: 'Code.gs' });

if (!state.props.DB_ID) { context.__setup(); save(); }

// ---------------------------------------------------------------- HTML
function renderIndex() {
  const read = n => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
  // Apps Script recorta el script desde cualquier barra-asterisco: en local no pasa, así que se avisa aquí.
  ['App', 'Index'].forEach(n => {
    const lines = read(n).split('\n');
    lines.forEach((l, i) => {
      if (/\/\*|\*\//.test(l)) console.warn(`AVISO ${n}.html:${i + 1}: barra-asterisco rompe la página en Apps Script → ${l.trim().slice(0, 80)}`);
      // Una URL que no empieza justo después de comilla simple suele estar en una plantilla `…`: Apps Script la corta.
      if (/(^|[^'])https?:\/\//.test(l)) console.warn(`AVISO ${n}.html:${i + 1}: URL fuera de comillas simples, Apps Script corta la línea → ${l.trim().slice(0, 80)}`);
    });
  });
  const shim = `<script>
  window.google = { script: { run: (function make(ok, fail) {
    return new Proxy({}, { get(_, fn) {
      if (fn === 'withSuccessHandler') return h => make(h, fail);
      if (fn === 'withFailureHandler') return h => make(ok, h);
      return (...args) => fetch('/__rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn, args }) })
        .then(r => r.json()).then(r => ok && ok(r), e => fail && fail(e));
    } });
  })() } };
  </script>`;
  return read('Index')
    .replace(/<\?!=\s*include\('(\w+)'\);?\s*\?>/g, (_, n) => (n === 'App' ? shim : '') + read(n));
}

// Versión de GitHub Pages: se genera en dev/.site y llama a /__api como si fuera doPost.
const SITE_DIR = path.join(__dirname, '.site');
const { build } = require('./build');
build({ out: SITE_DIR, api: 'http://localhost:' + PORT + '/__api' });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const localUrls = s => s.split('https://lh3.googleusercontent.com/d/').join('http://localhost:' + PORT + '/__files/');

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/__api') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let out;
      try {
        const r = JSON.parse(body);
        out = context.__api(String(r.action || ''), r.payload, r.token);
      } catch (e) { out = { ok: false, error: 'Solicitud no válida.' }; }
      save();
      // Igual que Apps Script: respuesta JSON que cualquier origen puede leer.
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(localUrls(JSON.stringify(out)));
    });
    return;
  }
  if (req.url === '/site' || req.url.startsWith('/site/')) {
    const rel = decodeURIComponent(req.url.replace(/^\/site\/?/, '').split('?')[0]) || 'index.html';
    const file = path.join(SITE_DIR, rel);
    if (!file.startsWith(SITE_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(file));
  }
  if (req.method === 'POST' && req.url === '/__rpc') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const { fn, args } = JSON.parse(body);
      let out;
      try { out = fn === 'api' ? context.__api(...args) : { ok: false, error: 'Función no expuesta' }; } catch (e) { out = { ok: false, error: String(e) }; }
      save();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Las imágenes "de Drive" se sirven desde dev/.uploads para poder verlas en local.
      res.end(localUrls(JSON.stringify(out)));
    });
    return;
  }
  if (req.url.startsWith('/__files/')) {
    const id = req.url.slice(9);
    const meta = state.files[id];
    if (!meta) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': meta.mime });
    return res.end(fs.readFileSync(path.join(UPLOADS, id)));
  }
  if (req.url === '/__db') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(state.sheets, null, 2));
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderIndex());
}).listen(PORT, () => {
  console.log('yogacentral dev en http://localhost:' + PORT + '  (versión Apps Script, admin: ' + DEV_ADMIN + ')');
  console.log('versión GitHub Pages (rápida e instalable) en http://localhost:' + PORT + '/site/');
});
