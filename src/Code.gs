/**
 * yogacentral — backend en Google Apps Script.
 *
 * Datos: una hoja de cálculo en Drive (una pestaña por tabla).
 * Archivos: carpeta "yogacentral" en Drive con "imagenes" (pública por enlace)
 * y "comprobantes" (privada, solo la ve la cuenta dueña del script).
 *
 * Primer uso: ejecuta setup() una vez desde el editor y luego despliega como
 * aplicación web. Ver README.md.
 */

const TZ = 'America/Mexico_City';
const SESSION_TTL = 21600; // 6 h, máximo de CacheService

const TABLES = {
  Config: ['clave', 'valor'],
  // rol: alumno | instructor | admin. instructorId liga la cuenta con su ficha en Instructores.
  Usuarios: ['id', 'nombre', 'email', 'telefono', 'hash', 'salt', 'rol', 'activo', 'creado', 'instructorId'],
  Instructores: ['id', 'nombre', 'titulo', 'bio', 'foto', 'orden', 'activo'],
  Clases: ['id', 'nombre', 'nivel', 'intensidad', 'descripcion', 'activo'],
  Horario: ['id', 'claseId', 'instructorId', 'dia', 'hora', 'duracion', 'sala', 'cupo', 'modalidad', 'activo'],
  Paquetes: ['id', 'nombre', 'clases', 'vigenciaDias', 'precio', 'descripcion', 'soloNuevos', 'destacado', 'orden', 'activo'],
  Compras: ['id', 'usuarioId', 'paqueteId', 'precio', 'estado', 'comprobante', 'nota', 'creado', 'revisado', 'inicio', 'vence', 'clasesTotal', 'clasesUsadas'],
  Reservas: ['id', 'usuarioId', 'horarioId', 'fecha', 'estado', 'compraId', 'creado'],
  // pagina / paginas usan las claves de PAGES; paginas es una lista separada por comas.
  // uso: 'fondo' (detrás del título de la página) | 'ancho' (imagen completa debajo del contenido).
  Galeria: ['id', 'titulo', 'imagen', 'descripcion', 'pagina', 'orden', 'activo', 'uso'],
  Musica: ['id', 'titulo', 'audio', 'paginas', 'orden', 'activo'],
};

const PAGES = ['inicio', 'horarios', 'paquetes', 'instructores', 'panel', 'instructor'];
// Sitio público en GitHub Pages: los correos de aviso enlazan aquí.
const SITE_URL = 'https://yogacentralm.github.io/Yoga-Central/';
const COLOR_KEYS = ['colorPrimario', 'colorAcento', 'colorTitulos', 'colorTexto', 'colorFondo', 'colorSuave', 'colorBordes'];
// Tipografías de Google Fonts elegidas en Administrar → Sitio (solo el nombre de la familia).
const FONT_KEYS = ['fuenteTitulos', 'fuenteTexto'];

// Tipos de archivo que se pueden subir, la carpeta de Drive y su límite.
const UPLOADS = {
  imagen: { folder: 'IMG_FOLDER_ID', mime: /^image\/(png|jpe?g|webp|gif)$/, max: 5, msg: 'Sube una imagen (PNG, JPG, WebP o GIF).' },
  comprobante: { folder: 'RECEIPT_FOLDER_ID', mime: /^(image\/(png|jpe?g|webp|heic)|application\/pdf)$/, max: 5, msg: 'Sube una imagen o un PDF.' },
  audio: { folder: 'MUSIC_FOLDER_ID', mime: /^audio\/(mpeg|mp3|mp4|x-m4a|m4a|aac|ogg|wav|x-wav|webm)$/, max: 15, msg: 'Sube un audio MP3, M4A, OGG o WAV.' },
};

const NUMERIC = ['clases', 'vigenciaDias', 'precio', 'orden', 'duracion', 'cupo', 'dia', 'clasesTotal', 'clasesUsadas'];
const BOOLEAN = ['activo', 'soloNuevos', 'destacado'];

// Tablas que el administrador edita con el CRUD genérico.
const ADMIN_EDITABLE = ['Instructores', 'Clases', 'Horario', 'Paquetes', 'Galeria', 'Musica'];

// Claves de Config que se envían al público (el resto, p. ej. notas internas, no).
const PUBLIC_CONFIG = ['nombre', 'lema', 'descripcion', 'direccion', 'ciudad', 'telefono', 'whatsapp', 'email',
  'facebook', 'instagram', 'heroImagen', 'datosPago', 'linkPago', 'horasCancelacion', 'terminos', 'mapa', 'favicon',
  'pagoBanco', 'pagoTitular', 'pagoClabe', 'pagoTarjeta']
  .concat(COLOR_KEYS, FONT_KEYS);

// ---------------------------------------------------------------------------
// Entrada web

function doGet() {
  const cfg = readConfig_();
  const page = HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(cfg.nombre || 'yogacentral')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  // Permite mostrar el sitio dentro de la página corta de GitHub Pages (docs/index.html).
  page.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  // El ícono de pestaña es opcional: si Google rechaza la URL, la página carga igual.
  try { if (cfg.favicon) page.setFaviconUrl(cfg.favicon); } catch (e) { console.warn('Favicon no válido: ' + e); }
  return page;
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * API JSON para el sitio en GitHub Pages: fetch POST con cuerpo text/plain
 * {"action","payload","token"} (text/plain evita la verificación CORS previa).
 */
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Solicitud no válida.' }); }
  return json_(api(String(req.action || ''), req.payload, req.token));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Punto único: google.script.run.api(...) desde HtmlService o doPost desde GitHub Pages. */
function api(action, payload, token) {
  resetRequestCache_();
  try {
    const route = ROUTES[action];
    if (!route) throw userError_('Acción desconocida.');
    const user = route.role ? requireUser_(token, route.role) : currentUser_(token);
    const data = route.run(payload || {}, user, token);
    return JSON.parse(JSON.stringify({ ok: true, data: data === undefined ? null : data }));
  } catch (e) {
    if (e && e.userMessage) return { ok: false, error: e.userMessage };
    console.error(action, e && e.stack || e);
    return { ok: false, error: 'Ocurrió un error inesperado. Intenta de nuevo.' };
  }
}

const ROUTES = {
  'public.bootstrap': { run: (p, user) => bootstrap_(user) },
  'public.occupancy': { run: p => occupancy_(p.desde, p.hasta) },
  'auth.register': { run: p => register_(p) },
  'auth.login': { run: p => login_(p) },
  'auth.logout': { run: (p, u, token) => { if (token) cache_().remove('s_' + token); return true; } },

  'me.dashboard': { role: 'alumno', run: (p, u) => dashboard_(u) },
  'me.book': { role: 'alumno', run: (p, u) => book_(u, p.horarioId, p.fecha) },
  'me.cancel': { role: 'alumno', run: (p, u) => cancelBooking_(u, p.reservaId, false) },
  'me.buy': { role: 'alumno', run: (p, u) => buy_(u, p) },
  'me.uploadReceipt': { role: 'alumno', run: (p, u) => uploadReceipt_(u, p.compraId, p.archivo) },
  'me.updateProfile': { role: 'alumno', run: (p, u) => updateProfile_(u, p) },
  'me.changePassword': { role: 'alumno', run: (p, u) => changePassword_(u, p) },

  // Instructoras: solo sus propias clases. Un admin las ve todas.
  'instructor.classes': { role: 'instructor', run: (p, u) => attendance_(p.fecha, ownInstructor_(u)) },
  'instructor.markAttendance': { role: 'instructor', run: (p, u) => markAttendance_(p.reservaId, p.estado, ownInstructor_(u)) },

  'admin.overview': { role: 'admin', run: () => adminOverview_() },
  'admin.list': { role: 'admin', run: p => adminList_(p.tabla) },
  'admin.save': { role: 'admin', run: p => adminSave_(p.tabla, p.item) },
  'admin.delete': { role: 'admin', run: p => adminDelete_(p.tabla, p.id) },
  'admin.saveConfig': { role: 'admin', run: p => saveConfig_(p.config) },
  'admin.students': { role: 'admin', run: () => students_() },
  'admin.setUser': { role: 'admin', run: (p, u) => setUser_(u, p) },
  'admin.purchases': { role: 'admin', run: p => purchasesForAdmin_(p.estado) },
  'admin.reviewPurchase': { role: 'admin', run: p => reviewPurchase_(p.id, p.estado, p.nota) },
  'admin.sellPackage': { role: 'admin', run: p => sellPackage_(p.usuarioId, p.paqueteId, p.nota) },
  'admin.attendance': { role: 'admin', run: p => attendance_(p.fecha) },
  'admin.markAttendance': { role: 'admin', run: p => markAttendance_(p.reservaId, p.estado) },
  'admin.bookFor': { role: 'admin', run: p => book_(getById_('Usuarios', p.usuarioId), p.horarioId, p.fecha, true) },
  'admin.cancelFor': { role: 'admin', run: p => cancelBooking_(null, p.reservaId, true) },
  'admin.upload': { role: 'admin', run: p => uploadPublic_(p.archivo, p.tipo === 'audio' ? 'audio' : 'imagen') },
};

// ---------------------------------------------------------------------------
// Instalación

function setup() {
  const props = PropertiesService.getScriptProperties();
  let ss;
  if (props.getProperty('DB_ID')) {
    ss = SpreadsheetApp.openById(props.getProperty('DB_ID'));
  } else {
    ss = SpreadsheetApp.create('yogacentral — base de datos');
    props.setProperty('DB_ID', ss.getId());
  }

  let root;
  if (props.getProperty('FOLDER_ID')) {
    root = DriveApp.getFolderById(props.getProperty('FOLDER_ID'));
  } else {
    root = DriveApp.createFolder('yogacentral');
    props.setProperty('FOLDER_ID', root.getId());
    DriveApp.getFileById(ss.getId()).moveTo(root);
  }
  if (!props.getProperty('IMG_FOLDER_ID')) {
    const img = root.createFolder('imagenes');
    try { img.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { console.warn('No se pudo compartir la carpeta de imágenes: ' + e); }
    props.setProperty('IMG_FOLDER_ID', img.getId());
  }
  if (!props.getProperty('RECEIPT_FOLDER_ID')) {
    props.setProperty('RECEIPT_FOLDER_ID', root.createFolder('comprobantes').getId());
  }
  if (!props.getProperty('MUSIC_FOLDER_ID')) {
    const music = root.createFolder('musica');
    try { music.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { console.warn('No se pudo compartir la carpeta de música: ' + e); }
    props.setProperty('MUSIC_FOLDER_ID', music.getId());
  }

  // La cuenta que instala es el primer contacto del sitio (se cambia en Administrar → Sitio).
  const owner = Session.getEffectiveUser().getEmail();

  Object.keys(TABLES).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange('A:Z').setNumberFormat('@');
      sh.getRange(1, 1, 1, TABLES[name].length).setValues([TABLES[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
      (SEED[name] || []).forEach(row => {
        const seeded = name === 'Config' && row.clave === 'email' && owner ? { clave: 'email', valor: owner.toLowerCase() } : row;
        insert_(name, seeded, sh);
      });
    } else {
      // Instalaciones previas: agrega al final las columnas nuevas sin tocar los datos.
      const head = headerOf_(sh);
      const missing = TABLES[name].filter(k => head.indexOf(k) < 0);
      if (missing.length) sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    }
  });
  const blank = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);

  // La cuenta que instala queda como administradora al registrarse con ese correo.
  if (owner && !props.getProperty('ADMIN_EMAILS')) props.setProperty('ADMIN_EMAILS', owner.toLowerCase());

  console.log('Listo. Base de datos: ' + ss.getUrl());
  console.log('Regístrate en la web con ' + (owner || 'tu correo') + ' para entrar como administrador.');
}

// ---------------------------------------------------------------------------
// Acceso a la hoja

// Caché por consulta: la hoja se abre una vez y cada tabla se lee una vez; toda escritura
// la invalida. api() la reinicia al empezar, así nunca sobrevive entre consultas.
let DB_ = null;
const SHEETS_ = {};
const ROWS_ = {};
function resetRequestCache_() {
  DB_ = null;
  Object.keys(SHEETS_).forEach(k => delete SHEETS_[k]);
  Object.keys(ROWS_).forEach(k => delete ROWS_[k]);
}

// Lo que ve cualquier visitante se guarda en CacheService unos minutos; se borra al editarlo.
const PUBLIC_TABLES = ['Config', 'Instructores', 'Clases', 'Horario', 'Paquetes', 'Galeria', 'Musica'];
const PUBLIC_CACHE_KEY = 'pub_v2'; // v1 pudo guardar horas mal leídas
function touched_(name) {
  delete ROWS_[name];
  if (PUBLIC_TABLES.indexOf(name) >= 0) cache_().remove(PUBLIC_CACHE_KEY);
}

function db_() {
  if (DB_) return DB_;
  const id = PropertiesService.getScriptProperties().getProperty('DB_ID');
  if (!id) throw userError_('El sitio aún no está instalado (ejecuta setup).');
  DB_ = SpreadsheetApp.openById(id);
  return DB_;
}

function sheet_(name) {
  if (SHEETS_[name]) return SHEETS_[name];
  const sh = db_().getSheetByName(name);
  if (!sh) throw userError_('Falta la tabla ' + name + ' (ejecuta setup).');
  SHEETS_[name] = sh;
  return sh;
}

// Hojas de cálculo convierten "20:15", "2026-11-09" o números largos a hora, fecha o número
// si la celda no tiene formato de texto. Al leer se regresan al texto que usa la app.
const DATE_ONLY = ['fecha', 'inicio', 'vence'];
let SHEET_TZ_ = null;
function sheetTz_() { return SHEET_TZ_ || (SHEET_TZ_ = db_().getSpreadsheetTimeZone() || TZ); }

function parse_(key, v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    const fmt = key === 'hora' || v.getFullYear() < 1900 ? 'HH:mm' : DATE_ONLY.indexOf(key) >= 0 ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm';
    v = Utilities.formatDate(v, sheetTz_(), fmt);
  }
  if (NUMERIC.indexOf(key) >= 0) return v === '' || v === null ? 0 : Number(v);
  if (BOOLEAN.indexOf(key) >= 0) return v === true || String(v).toUpperCase() === 'TRUE';
  return v === null || v === undefined ? '' : String(v);
}

function serialize_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  const s = String(v);
  // El apóstrofo guarda el valor como texto: evita fórmulas y que Hojas de cálculo convierta
  // horas, fechas o números largos (CLABE, tarjeta) y los regrese distintos.
  return /^[=+\-@]/.test(s) || /^(\d{1,2}:\d{2}(:\d{2})?|\d{4}-\d{2}-\d{2}( \d{1,2}:\d{2}(:\d{2})?)?|0\d+|\d{11,})$/.test(s) ? "'" + s : s;
}

function rows_(name) {
  if (!ROWS_[name]) {
    const values = sheet_(name).getDataRange().getValues();
    const head = values.shift() || [];
    ROWS_[name] = values.filter(r => r[0] !== '').map(r => {
      const o = {};
      head.forEach((k, i) => { o[k] = parse_(k, r[i]); });
      return o;
    });
  }
  // Copias: quien llama puede modificar los objetos sin tocar la caché.
  return ROWS_[name].map(r => Object.assign({}, r));
}

function getById_(name, id) {
  const row = rows_(name).find(r => r.id === String(id));
  if (!row) throw userError_('No se encontró el registro.');
  return row;
}

function headerOf_(sh) {
  return sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
}

function insert_(name, obj, sh) {
  const row = Object.assign({}, obj);
  if (!row.id && name !== 'Config') row.id = newId_();
  sh = sh || sheet_(name);
  // Se escribe según el encabezado real de la hoja, por si sus columnas están en otro orden.
  sh.appendRow(headerOf_(sh).map(k => serialize_(row[k])));
  touched_(name);
  return row;
}

function update_(name, id, patch) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const head = values[0];
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      const current = {};
      head.forEach((k, j) => { current[k] = parse_(k, values[i][j]); });
      const next = Object.assign(current, patch, { [head[0]]: current[head[0]] });
      sh.getRange(i + 1, 1, 1, head.length).setValues([head.map(k => serialize_(next[k]))]);
      touched_(name);
      return next;
    }
  }
  throw userError_('No se encontró el registro.');
}

function remove_(name, id) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === String(id)) { sh.deleteRow(i + 1); touched_(name); return true; }
  }
  throw userError_('No se encontró el registro.');
}

function readConfig_() {
  if (!PropertiesService.getScriptProperties().getProperty('DB_ID')) return {};
  const out = {};
  rows_('Config').forEach(r => { out[r.clave] = r.valor; });
  return out;
}

function saveConfig_(config) {
  const current = readConfig_();
  Object.keys(config || {}).forEach(k => {
    if (!/^[a-zA-Z][\w]{0,40}$/.test(k)) return;
    const v = String(config[k] == null ? '' : config[k]).trim();
    if (COLOR_KEYS.indexOf(k) >= 0 && v && !/^#[0-9a-fA-F]{6}$/.test(v)) throw userError_('Color no válido: ' + v + ' (usa el formato #RRGGBB).');
    if (FONT_KEYS.indexOf(k) >= 0 && v && !/^[A-Za-z0-9 ]{2,40}$/.test(v)) throw userError_('Tipografía no válida: ' + v);
    if (k === 'pagoClabe' && v && !/^\d{18}$/.test(v.replace(/\s/g, ''))) throw userError_('La CLABE debe tener 18 dígitos.');
    if (k === 'pagoTarjeta' && v && !/^\d{15,16}$/.test(v.replace(/[\s-]/g, ''))) throw userError_('El número de tarjeta debe tener 16 dígitos.');
    if (k in current) update_('Config', k, { valor: v });
    else insert_('Config', { clave: k, valor: v });
  });
  return readConfig_();
}

// ---------------------------------------------------------------------------
// Utilidades

function userError_(msg) { const e = new Error(msg); e.userMessage = msg; return e; }
function newId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 16); }
function cache_() { return CacheService.getScriptCache(); }
function nowStamp_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

/** Suma días a una fecha 'yyyy-MM-dd' sin depender de la zona horaria. */
function addDays_(ymd, n) {
  const p = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

/** Día de la semana 0=domingo … 6=sábado para 'yyyy-MM-dd'. */
function weekday_(ymd) {
  const p = ymd.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

function isYmd_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

function clean_(s, max) { return String(s == null ? '' : s).trim().slice(0, max || 500); }

// ---------------------------------------------------------------------------
// Autenticación (correo + contraseña, sesiones en CacheService)

function hash_(password, salt) {
  let bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password, Utilities.Charset.UTF_8);
  for (let i = 0; i < 200; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes.concat(Utilities.newBlob(salt).getBytes()));
  }
  return Utilities.base64Encode(bytes);
}

function publicUser_(u) {
  return { id: u.id, nombre: u.nombre, email: u.email, telefono: u.telefono, rol: u.rol, instructorId: u.instructorId || '' };
}

function startSession_(u) {
  const token = Utilities.getUuid() + Utilities.getUuid();
  cache_().put('s_' + token, u.id, SESSION_TTL);
  return { token: token, user: publicUser_(u) };
}

function currentUser_(token) {
  if (!token) return null;
  const id = cache_().get('s_' + token);
  if (!id) return null;
  const u = rows_('Usuarios').find(r => r.id === id);
  if (!u || !u.activo) return null;
  cache_().put('s_' + token, id, SESSION_TTL); // renueva
  return u;
}

function requireUser_(token, role) {
  const u = currentUser_(token);
  if (!u) throw userError_('Tu sesión expiró. Inicia sesión de nuevo.');
  if (role === 'admin' && u.rol !== 'admin') throw userError_('No tienes permiso para esta sección.');
  if (role === 'instructor' && u.rol !== 'instructor' && u.rol !== 'admin') throw userError_('No tienes permiso para esta sección.');
  return u;
}

function register_(p) {
  const nombre = clean_(p.nombre, 80);
  const email = clean_(p.email, 120).replace(/\s+/g, '').toLowerCase();
  const telefono = clean_(p.telefono, 30);
  const password = String(p.password || '');
  if (nombre.length < 2) throw userError_('Escribe tu nombre.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw userError_('Correo no válido.');
  if (password.length < 8) throw userError_('La contraseña debe tener al menos 8 caracteres.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (rows_('Usuarios').some(u => u.email === email)) throw userError_('Ya existe una cuenta con ese correo.');
    const admins = String(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '').split(',');
    const salt = newId_();
    const u = insert_('Usuarios', {
      nombre: nombre, email: email, telefono: telefono, salt: salt, hash: hash_(password, salt),
      rol: admins.indexOf(email) >= 0 ? 'admin' : 'alumno', activo: true, creado: nowStamp_(),
    });
    return startSession_(u);
  } finally { lock.releaseLock(); }
}

function login_(p) {
  // Los teclados del celular a veces agregan espacios o mayúsculas al correo.
  const email = clean_(p.email, 120).replace(/\s+/g, '').toLowerCase();
  const tries = Number(cache_().get('fail_' + email) || 0);
  if (tries >= 8) throw userError_('Demasiados intentos fallidos. Por seguridad espera 15 minutos e intenta de nuevo.');
  const u = rows_('Usuarios').find(r => r.email === email);
  if (!u || u.hash !== hash_(String(p.password || ''), u.salt)) {
    cache_().put('fail_' + email, String(tries + 1), 900);
    const left = 8 - (tries + 1);
    throw userError_('Correo o contraseña incorrectos.' + (left <= 4
      ? (left > 0 ? ' Te quedan ' + left + ' intento' + (left === 1 ? '' : 's') + ' antes de una pausa de 15 minutos.' : ' Por seguridad espera 15 minutos.')
      : ' Toca el ojo para revisar lo que escribiste.'));
  }
  if (!u.activo) throw userError_('Tu cuenta está desactivada. Contacta al estudio.');
  cache_().remove('fail_' + email);
  return startSession_(u);
}

function updateProfile_(u, p) {
  const nombre = clean_(p.nombre, 80);
  if (nombre.length < 2) throw userError_('Escribe tu nombre.');
  return publicUser_(update_('Usuarios', u.id, { nombre: nombre, telefono: clean_(p.telefono, 30) }));
}

function changePassword_(u, p) {
  if (u.hash !== hash_(String(p.actual || ''), u.salt)) throw userError_('La contraseña actual no coincide.');
  if (String(p.nueva || '').length < 8) throw userError_('La nueva contraseña debe tener al menos 8 caracteres.');
  const salt = newId_();
  update_('Usuarios', u.id, { salt: salt, hash: hash_(String(p.nueva), salt) });
  return true;
}

// ---------------------------------------------------------------------------
// Público

function bootstrap_(user) {
  return Object.assign(publicData_(), {
    user: user ? publicUser_(user) : null,
    hoy: today_(),
    ahora: nowStamp_(),
  });
}

function publicData_() {
  const hit = cache_().get(PUBLIC_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const data = buildPublicData_();
  // CacheService guarda hasta 100 KB por clave; si no cabe, solo se pierde la aceleración.
  try { cache_().put(PUBLIC_CACHE_KEY, JSON.stringify(data), 600); } catch (e) { console.warn('Datos públicos sin caché: ' + e); }
  return data;
}

function buildPublicData_() {
  const cfg = readConfig_();
  const publicCfg = {};
  PUBLIC_CONFIG.forEach(k => { publicCfg[k] = cfg[k] || ''; });
  const byOrder = (a, b) => (a.orden || 0) - (b.orden || 0);
  const clases = rows_('Clases').filter(r => r.activo);
  const instructores = rows_('Instructores').filter(r => r.activo).sort(byOrder);
  return {
    config: publicCfg,
    instructores: instructores,
    clases: clases,
    // Solo se publican horarios cuyo estilo e instructora están visibles.
    horario: rows_('Horario').filter(r => r.activo && clases.some(c => c.id === r.claseId) &&
      instructores.some(i => i.id === r.instructorId)),
    paquetes: rows_('Paquetes').filter(r => r.activo).sort(byOrder),
    galeria: rows_('Galeria').filter(r => r.activo && r.imagen).sort(byOrder),
    musica: rows_('Musica').filter(r => r.activo && r.audio).sort(byOrder),
  };
}

/** Lugares ocupados por horario y fecha: { "horarioId|yyyy-MM-dd": n }. */
function occupancy_(desde, hasta) {
  if (!isYmd_(desde) || !isYmd_(hasta)) throw userError_('Rango de fechas no válido.');
  const out = {};
  rows_('Reservas').forEach(r => {
    if (r.estado === 'cancelada' || r.fecha < desde || r.fecha > hasta) return;
    const k = r.horarioId + '|' + r.fecha;
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Alumno

function activePurchases_(userId, fecha, compras) {
  const day = fecha || today_();
  return (compras || rows_('Compras')).filter(c => c.usuarioId === userId && c.estado === 'aprobado' &&
    c.inicio <= day && c.vence >= day && (c.clasesTotal === 0 || c.clasesUsadas < c.clasesTotal))
    .sort((a, b) => a.vence < b.vence ? -1 : 1);
}

function dashboard_(u) {
  const compras = rows_('Compras');
  const paquetes = rows_('Paquetes');
  const pkgName = id => (paquetes.find(p => p.id === id) || {}).nombre || 'Paquete';
  const mine = compras.filter(c => c.usuarioId === u.id)
    .map(c => Object.assign({}, c, { paquete: pkgName(c.paqueteId), comprobante: c.comprobante ? 'sí' : '' }))
    .sort((a, b) => a.creado < b.creado ? 1 : -1);
  const reservas = rows_('Reservas').filter(r => r.usuarioId === u.id)
    .sort((a, b) => a.fecha < b.fecha ? 1 : -1);
  return {
    user: publicUser_(u),
    activos: activePurchases_(u.id, null, compras).map(c => Object.assign({}, c, { paquete: pkgName(c.paqueteId) })),
    compras: mine,
    reservas: reservas,
    ahora: nowStamp_(),
  };
}

function slotStart_(slot, fecha) { return fecha + ' ' + slot.hora; }

function book_(u, horarioId, fecha, byAdmin) {
  if (!u) throw userError_('Alumno no encontrado.');
  if (!isYmd_(fecha)) throw userError_('Fecha no válida.');
  const slot = rows_('Horario').find(r => r.id === String(horarioId) && r.activo);
  if (!slot) throw userError_('Esa clase ya no está disponible.');
  if (slot.dia !== weekday_(fecha)) throw userError_('La clase no se imparte ese día.');
  if (!byAdmin && slotStart_(slot, fecha) <= nowStamp_()) throw userError_('Esa clase ya comenzó.');
  if (!byAdmin && fecha > addDays_(today_(), 30)) throw userError_('Solo puedes reservar con hasta 30 días de anticipación.');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const reservas = rows_('Reservas').filter(r => r.horarioId === slot.id && r.fecha === fecha && r.estado !== 'cancelada');
    if (reservas.some(r => r.usuarioId === u.id)) throw userError_('Ya tienes un lugar en esta clase.');
    if (slot.cupo > 0 && reservas.length >= slot.cupo) throw userError_('La clase está llena.');
    const compra = activePurchases_(u.id, fecha)[0];
    if (!compra) throw userError_('No tienes un paquete vigente con clases disponibles para esa fecha.');
    update_('Compras', compra.id, { clasesUsadas: compra.clasesUsadas + 1 });
    return insert_('Reservas', {
      usuarioId: u.id, horarioId: slot.id, fecha: fecha, estado: 'reservada', compraId: compra.id, creado: nowStamp_(),
    });
  } finally { lock.releaseLock(); }
}

function cancelBooking_(u, reservaId, byAdmin) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const r = getById_('Reservas', reservaId);
    if (!byAdmin && r.usuarioId !== u.id) throw userError_('Esa reserva no es tuya.');
    if (r.estado !== 'reservada') throw userError_('La reserva ya no se puede cancelar.');
    if (!byAdmin) {
      const slot = rows_('Horario').find(s => s.id === r.horarioId);
      const horas = Number(readConfig_().horasCancelacion || 2);
      const limit = Utilities.formatDate(new Date(Date.now() + horas * 3600 * 1000), TZ, 'yyyy-MM-dd HH:mm');
      if (slot && slotStart_(slot, r.fecha) <= limit) {
        throw userError_('Solo puedes cancelar hasta ' + horas + ' h antes de la clase.');
      }
    }
    update_('Reservas', r.id, { estado: 'cancelada' });
    const compra = rows_('Compras').find(c => c.id === r.compraId);
    if (compra && compra.clasesUsadas > 0) update_('Compras', compra.id, { clasesUsadas: compra.clasesUsadas - 1 });
    return true;
  } finally { lock.releaseLock(); }
}

function saveUpload_(archivo, tipo, prefix) {
  const kind = UPLOADS[tipo];
  if (!archivo || !archivo.data) throw userError_('Adjunta un archivo.');
  const mime = String(archivo.mime || '');
  if (!kind.mime.test(mime)) throw userError_(kind.msg);
  const bytes = Utilities.base64Decode(archivo.data);
  if (bytes.length > kind.max * 1024 * 1024) throw userError_('El archivo pesa más de ' + kind.max + ' MB.');
  const folderId = PropertiesService.getScriptProperties().getProperty(kind.folder);
  if (!folderId) throw userError_('Falta la carpeta de Drive para este archivo (vuelve a ejecutar setup).');
  const safeName = prefix + '-' + clean_(archivo.name, 80).replace(/[^\w.\-]+/g, '_');
  return DriveApp.getFolderById(folderId).createFile(Utilities.newBlob(bytes, mime, safeName));
}

function buy_(u, p) {
  const pkg = rows_('Paquetes').find(x => x.id === String(p.paqueteId) && x.activo);
  if (!pkg) throw userError_('Ese paquete ya no está disponible.');
  const compras = rows_('Compras').filter(c => c.usuarioId === u.id);
  if (pkg.soloNuevos && compras.some(c => c.estado !== 'rechazado')) {
    throw userError_('Este paquete es solo para quienes nos visitan por primera vez.');
  }
  if (compras.some(c => c.paqueteId === pkg.id && c.estado === 'pendiente')) {
    throw userError_('Ya tienes una compra pendiente de este paquete.');
  }
  const compra = {
    usuarioId: u.id, paqueteId: pkg.id, precio: pkg.precio, estado: 'pendiente', comprobante: '',
    nota: clean_(p.nota, 300), creado: nowStamp_(), revisado: '', inicio: '', vence: '',
    clasesTotal: pkg.clases, clasesUsadas: 0,
  };
  if (p.archivo) compra.comprobante = saveUpload_(p.archivo, 'comprobante', 'comprobante-' + u.email).getUrl();
  const saved = insert_('Compras', compra);
  if (pkg.precio === 0) return approve_(saved.id, 'Clase sin costo');
  if (saved.comprobante) notifyPayment_(saved, u);
  return saved;
}

function uploadReceipt_(u, compraId, archivo) {
  const c = getById_('Compras', compraId);
  if (c.usuarioId !== u.id) throw userError_('Esa compra no es tuya.');
  if (c.estado !== 'pendiente') throw userError_('Esa compra ya fue revisada.');
  const url = saveUpload_(archivo, 'comprobante', 'comprobante-' + u.email).getUrl();
  const saved = update_('Compras', c.id, { comprobante: url });
  notifyPayment_(saved, u);
  return saved;
}

// Correo a los administradores cuando un alumno sube un comprobante. En el celular llega
// como notificación de Gmail aunque el sitio esté cerrado. Se apaga en Administrar → Sitio.
function notifyPayment_(compra, u) {
  try {
    const cfg = readConfig_();
    if (String(cfg.avisoPagos) === 'false') return;
    const to = rows_('Usuarios').filter(x => x.rol === 'admin' && x.activo && x.email).map(x => x.email);
    if (!to.length) return;
    const pkg = rows_('Paquetes').find(p => p.id === compra.paqueteId) || {};
    const estudio = cfg.nombre || 'yogacentral';
    const precio = '$' + Number(compra.precio || 0).toLocaleString('es-MX');
    const link = SITE_URL + '#/admin/pagos';
    MailApp.sendEmail({
      to: to.join(','),
      name: estudio,
      subject: 'Pago por aprobar: ' + u.nombre + ' · ' + (pkg.nombre || 'paquete') + ' · ' + precio,
      body: u.nombre + ' subió su comprobante de pago.\n\nPaquete: ' + (pkg.nombre || '') + '\nMonto: ' + precio
        + '\nTeléfono: ' + (u.telefono || '—') + '\n\nRevísalo y apruébalo aquí: ' + link,
      htmlBody: '<div style="font-family:Arial,sans-serif;font-size:15px;color:#333;line-height:1.5">'
        + '<p><b>' + esc_(u.nombre) + '</b> subió su comprobante de pago.</p>'
        + '<p>Paquete: <b>' + esc_(pkg.nombre || '') + '</b><br>Monto: <b>' + precio + '</b><br>Teléfono: ' + esc_(u.telefono || '—') + '</p>'
        + '<p><a href="' + link + '" style="display:inline-block;background:#669C35;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Revisar y aprobar</a></p>'
        + '<p style="color:#888;font-size:12px">Puedes apagar estos avisos en Administrar → Sitio.</p></div>',
    });
  } catch (e) {
    // El comprobante ya quedó guardado; un fallo del correo no debe afectar al alumno.
    console.warn('Aviso de pago sin enviar: ' + e);
  }
}

function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

// Ejecútala una vez desde el editor de Apps Script: acepta el permiso de enviar correos
// y te manda un aviso de prueba.
function probarAvisoDePago() {
  const u = { nombre: 'Alumno de prueba', telefono: '8710000000' };
  const pkg = rows_('Paquetes').find(p => p.activo && p.precio > 0) || {};
  notifyPayment_({ paqueteId: pkg.id, precio: pkg.precio || 0 }, u);
  return 'Listo: revisa el correo de los administradores.';
}

// ---------------------------------------------------------------------------
// Administración

function adminOverview_() {
  const hoy = today_();
  const mes = hoy.slice(0, 7);
  const compras = rows_('Compras');
  const usuarios = rows_('Usuarios');
  const reservas = rows_('Reservas');
  const activos = {};
  compras.forEach(c => { if (activePurchases_(c.usuarioId, hoy, [c]).length) activos[c.usuarioId] = true; });
  return {
    alumnos: usuarios.filter(u => u.rol === 'alumno').length,
    alumnosActivos: Object.keys(activos).length,
    pendientes: compras.filter(c => c.estado === 'pendiente').length,
    ingresosMes: compras.filter(c => c.estado === 'aprobado' && String(c.revisado).slice(0, 7) === mes)
      .reduce((s, c) => s + c.precio, 0),
    reservasHoy: reservas.filter(r => r.fecha === hoy && r.estado !== 'cancelada').length,
    proximosVencimientos: compras.filter(c => c.estado === 'aprobado' && c.vence >= hoy && c.vence <= addDays_(hoy, 7))
      .map(c => ({ usuario: (usuarios.find(u => u.id === c.usuarioId) || {}).nombre || '', vence: c.vence })),
    hoy: hoy,
  };
}

function adminList_(tabla) {
  if (ADMIN_EDITABLE.indexOf(tabla) < 0) throw userError_('Tabla no editable.');
  return rows_(tabla);
}

function adminSave_(tabla, item) {
  if (ADMIN_EDITABLE.indexOf(tabla) < 0) throw userError_('Tabla no editable.');
  const clean = {};
  TABLES[tabla].forEach(k => { if (k !== 'id' && item && k in item) clean[k] = parse_(k, item[k]); });
  if ('nombre' in clean && !clean.nombre) throw userError_('El nombre es obligatorio.');
  if (tabla === 'Galeria') {
    if (PAGES.indexOf(clean.pagina) < 0) clean.pagina = 'inicio';
    if (clean.uso !== 'ancho') clean.uso = 'fondo';
  }
  if (tabla === 'Musica') clean.paginas = String(clean.paginas || '').split(',').filter(p => PAGES.indexOf(p) >= 0).join(',');
  if (tabla === 'Horario') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clean.hora || '')) throw userError_('Hora no válida (usa HH:MM, 24 h).');
    if (!(clean.dia >= 0 && clean.dia <= 6)) throw userError_('Día no válido.');
  }
  if (item && item.id) return update_(tabla, item.id, clean);
  return insert_(tabla, clean);
}

function adminDelete_(tabla, id) {
  if (ADMIN_EDITABLE.indexOf(tabla) < 0) throw userError_('Tabla no editable.');
  if (tabla === 'Horario' && rows_('Reservas').some(r => r.horarioId === id && r.estado === 'reservada' && r.fecha >= today_())) {
    throw userError_('Esa clase tiene reservas futuras. Desactívala en lugar de borrarla.');
  }
  if (tabla === 'Paquetes' && rows_('Compras').some(c => c.paqueteId === id)) {
    throw userError_('Ese paquete ya tiene compras. Desactívalo en lugar de borrarlo.');
  }
  return remove_(tabla, id);
}

function students_() {
  const compras = rows_('Compras');
  const hoy = today_();
  return rows_('Usuarios').map(u => {
    const vigentes = activePurchases_(u.id, hoy, compras);
    const ilimitado = vigentes.some(c => c.clasesTotal === 0);
    return Object.assign(publicUser_(u), {
      activo: u.activo, creado: u.creado,
      clasesDisponibles: ilimitado ? 'ilimitadas' : vigentes.reduce((s, c) => s + c.clasesTotal - c.clasesUsadas, 0),
      vence: vigentes.length ? vigentes[vigentes.length - 1].vence : '',
    });
  }).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function setUser_(admin, p) {
  const patch = {};
  if (['admin', 'alumno', 'instructor'].indexOf(p.rol) >= 0) {
    patch.rol = p.rol;
    patch.instructorId = '';
    if (p.rol === 'instructor') {
      const ficha = rows_('Instructores').find(i => i.id === String(p.instructorId || ''));
      if (!ficha) throw userError_('Elige la ficha de instructora que corresponde a esta cuenta.');
      patch.instructorId = ficha.id;
    }
  }
  if (typeof p.activo === 'boolean') patch.activo = p.activo;
  if (p.id === admin.id && ((patch.rol && patch.rol !== 'admin') || patch.activo === false)) {
    throw userError_('No puedes quitarte tu propio acceso de administrador.');
  }
  return publicUser_(update_('Usuarios', p.id, patch));
}

/** Ficha de instructora de la cuenta; null para un admin (ve todas las clases). */
function ownInstructor_(u) {
  if (u.rol === 'admin') return null;
  if (!u.instructorId) throw userError_('Tu cuenta aún no está ligada a una ficha de instructora. Pídeselo al estudio.');
  return u.instructorId;
}

function purchasesForAdmin_(estado) {
  const usuarios = rows_('Usuarios');
  const paquetes = rows_('Paquetes');
  return rows_('Compras').filter(c => !estado || c.estado === estado).map(c => {
    const u = usuarios.find(x => x.id === c.usuarioId) || {};
    return Object.assign({}, c, {
      usuario: u.nombre || '', email: u.email || '', telefono: u.telefono || '',
      paquete: (paquetes.find(x => x.id === c.paqueteId) || {}).nombre || '',
    });
  }).sort((a, b) => a.creado < b.creado ? 1 : -1);
}

function approve_(id, nota) {
  const c = getById_('Compras', id);
  const pkg = rows_('Paquetes').find(p => p.id === c.paqueteId) || { vigenciaDias: 30 };
  const inicio = today_();
  return update_('Compras', id, {
    estado: 'aprobado', revisado: nowStamp_(), inicio: inicio,
    vence: addDays_(inicio, Math.max(1, pkg.vigenciaDias) - 1), nota: nota != null ? clean_(nota, 300) : c.nota,
  });
}

function reviewPurchase_(id, estado, nota) {
  const c = getById_('Compras', id);
  if (c.estado !== 'pendiente') throw userError_('Esa compra ya fue revisada.');
  if (estado === 'aprobado') return approve_(id, nota);
  if (estado === 'rechazado') return update_('Compras', id, { estado: 'rechazado', revisado: nowStamp_(), nota: clean_(nota, 300) });
  throw userError_('Estado no válido.');
}

/** Venta en mostrador (efectivo/terminal): crea la compra ya aprobada. */
function sellPackage_(usuarioId, paqueteId, nota) {
  getById_('Usuarios', usuarioId);
  const pkg = getById_('Paquetes', paqueteId);
  const c = insert_('Compras', {
    usuarioId: usuarioId, paqueteId: pkg.id, precio: pkg.precio, estado: 'pendiente', comprobante: '',
    nota: '', creado: nowStamp_(), clasesTotal: pkg.clases, clasesUsadas: 0,
  });
  return approve_(c.id, nota || 'Venta en estudio');
}

function attendance_(fecha, instructorId) {
  if (!isYmd_(fecha)) throw userError_('Fecha no válida.');
  const dia = weekday_(fecha);
  const usuarios = rows_('Usuarios');
  const reservas = rows_('Reservas').filter(r => r.fecha === fecha && r.estado !== 'cancelada');
  return rows_('Horario').filter(s => s.dia === dia && s.activo && (!instructorId || s.instructorId === instructorId))
    .sort((a, b) => a.hora < b.hora ? -1 : 1)
    .map(s => ({
      horario: s,
      reservas: reservas.filter(r => r.horarioId === s.id).map(r => {
        const u = usuarios.find(x => x.id === r.usuarioId) || {};
        return Object.assign({}, r, { nombre: u.nombre || '', telefono: u.telefono || '' });
      }),
    }));
}

function markAttendance_(reservaId, estado, instructorId) {
  if (['reservada', 'asistio', 'falta'].indexOf(estado) < 0) throw userError_('Estado no válido.');
  const r = getById_('Reservas', reservaId);
  if (r.estado === 'cancelada') throw userError_('La reserva está cancelada.');
  if (instructorId) {
    const slot = rows_('Horario').find(s => s.id === r.horarioId);
    if (!slot || slot.instructorId !== instructorId) throw userError_('Esa clase no es tuya.');
  }
  return update_('Reservas', reservaId, { estado: estado });
}

/** Imagen o audio público por enlace; devuelve la URL que usa la página. */
function uploadPublic_(archivo, tipo) {
  const file = saveUpload_(archivo, tipo, tipo + '-' + Date.now());
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* hereda de la carpeta */ }
  if (tipo === 'audio') return { url: file.getDownloadUrl() };
  return { url: 'https://lh3.googleusercontent.com/d/' + file.getId() };
}

// ---------------------------------------------------------------------------
// Datos iniciales (editables después desde el panel de administración)

const SEED = {
  Config: [
    { clave: 'nombre', valor: 'YogaCentral' },
    { clave: 'lema', valor: 'Human Care' },
    { clave: 'descripcion', valor: [
      'YogaCentral es un espacio de encuentro que te brinda el acompañamiento para conectar contigo mism@ y así, dar paso al constante crecimiento del Autocuidado Integral.',
      'A través del descubrimiento de los beneficios que la práctica de Yoga puede proporcionar a tu cuerpo, mente, intuición, energía y conexión se da paso a la consciencia.',
      'Aquí encontrarás sesiones de Meditación manteniéndote en el momento de Consciencia Plena o Mindfulness para tu vida diaria, un momento de detenerte. STOP!',
      'En las sesiones de Sonoterapia conocerás la armonía perfecta para liberar tensiones, bloqueos emocionales para después lograr mayor claridad mental y serenidad emocional.',
      'También encuentra en YogaCentral una Comunidad sintonizada en las frecuencias del bienestar, una Red de apoyo y crecimiento, el espacio perfecto para la contención.',
      'Los maestros, terapeutas y red de servicios de salud con la mejor capacitación.',
    ].join('\n') },
    { clave: 'direccion', valor: 'Av. Allende 614, Segundo de Cobián Centro' },
    { clave: 'ciudad', valor: 'Torreón, Coahuila' },
    { clave: 'telefono', valor: '8713300940' },
    { clave: 'whatsapp', valor: '528713300940' },
    { clave: 'email', valor: 'yogacentralm@gmail.com' }, // setup() pone el correo de la cuenta que instala
    { clave: 'facebook', valor: 'https://www.facebook.com/yogacentralmx/' },
    { clave: 'instagram', valor: 'https://www.instagram.com/yogacentralmx/' },
    { clave: 'heroImagen', valor: '' },
    { clave: 'pagoBanco', valor: '' },
    { clave: 'pagoTitular', valor: '' },
    { clave: 'pagoClabe', valor: '' },
    { clave: 'pagoTarjeta', valor: '' },
    { clave: 'datosPago', valor: 'Sube la foto del comprobante y lo validamos el mismo día.' },
    { clave: 'linkPago', valor: '' },
    { clave: 'horasCancelacion', valor: '2' },
    { clave: 'mapa', valor: '' },
    { clave: 'favicon', valor: '' },
    { clave: 'colorPrimario', valor: '#669C35' },
    { clave: 'colorAcento', valor: '#00F0B5' },
    { clave: 'colorTitulos', valor: '#444142' },
    { clave: 'colorTexto', valor: '#4A5565' },
    { clave: 'colorFondo', valor: '#FCFCFC' },
    { clave: 'colorSuave', valor: '#DEE9D5' },
    { clave: 'colorBordes', valor: '#E5E7EB' },
    { clave: 'fuenteTitulos', valor: 'Fraunces' },
    { clave: 'fuenteTexto', valor: 'Inter' },
    { clave: 'terminos', valor: [
      'Salud: consulta a tu médico antes de iniciar y avisa a tu instructora de cualquier lesión o condición. Cada persona practica bajo su propia responsabilidad.',
      'Paquetes: son personales, no transferibles y no reembolsables. La vigencia corre desde que se aprueba el pago.',
      'Reservas: cancela con la anticipación indicada en tu panel para recuperar la clase; las faltas sin cancelar se descuentan.',
      'Convivencia: llega unos minutos antes, guarda silencio en la sala y mantén el teléfono en modo silencio.',
      'Privacidad: usamos tus datos solo para gestionar tu cuenta, reservas y avisos del estudio; no los compartimos con terceros.',
      'Fotos: podemos tomar fotos de las clases para redes sociales; avísanos si prefieres no aparecer.',
    ].join('\n') },
  ],
  Instructores: [
    { id: 'i1', nombre: 'Daniela Bazán', titulo: 'Hatha/Vinyasa, Relax y Sonoterapia', bio: 'Más de 20 años de práctica. Certificada en enseñanza de yoga (200 y 300 h) y en yoga oncológico; se especializa en clases suaves para descansar y bajar el estrés.', foto: '', orden: 1, activo: true },
    { id: 'i2', nombre: 'Michelle Fernández', titulo: 'Sattva, Mandala y entrenamiento deportivo', bio: 'Clases dinámicas que combinan fuerza, movilidad y respiración.', foto: '', orden: 2, activo: true },
    { id: 'i3', nombre: 'Verónica Ávila', titulo: 'Hatha/Vinyasa', bio: 'Prácticas equilibradas entre esfuerzo y quietud.', foto: '', orden: 3, activo: true },
    { id: 'i4', nombre: 'Azucena Moreno', titulo: 'Power Yoga', bio: 'Secuencias intensas para ganar fuerza y resistencia.', foto: '', orden: 4, activo: true },
    { id: 'i5', nombre: 'Alejandra Madero García', titulo: 'Meditación', bio: 'Guía de meditación y atención plena.', foto: '', orden: 5, activo: true },
  ],
  Clases: [
    { id: 'c1', nombre: 'Mandala Vinyasa', nivel: 'Intermedio', intensidad: 'Media', descripcion: 'Secuencias fluidas que giran alrededor del tapete para trabajar movilidad, coordinación y concentración.', activo: true },
    { id: 'c2', nombre: 'Hatha', nivel: 'Intermedio', intensidad: 'Media', descripcion: 'Posturas sostenidas y respiración consciente para encontrar fuerza y calma.', activo: true },
    { id: 'c3', nombre: 'Relax', nivel: 'Principiante', intensidad: 'Baja', descripcion: 'Práctica lenta y suave, ideal si buscas dormir mejor o aliviar tensión en cuello y espalda.', activo: true },
    { id: 'c4', nombre: 'Vinyasa Flow', nivel: 'Intermedio', intensidad: 'Media', descripcion: 'Transiciones continuas entre posturas sincronizadas con la respiración.', activo: true },
    { id: 'c5', nombre: 'Cuencos y Mindfulness', nivel: 'Multinivel', intensidad: 'Baja', descripcion: 'Yoga suave, meditación guiada y baño de sonido con cuencos de cuarzo.', activo: true },
    { id: 'c6', nombre: 'Power Yoga', nivel: 'Intermedio', intensidad: 'Alta', descripcion: 'Clase vigorosa para fortalecer y tonificar mientras mejoras flexibilidad y capacidad pulmonar.', activo: true },
    { id: 'c7', nombre: 'Restaurativo', nivel: 'Principiante', intensidad: 'Baja', descripcion: 'Posturas adaptadas con apoyos, pensadas para recuperar movilidad tras lesiones o sedentarismo.', activo: true },
    { id: 'c8', nombre: 'Yoga Somático y Oncológico', nivel: 'Principiante', intensidad: 'Baja', descripcion: 'Movimiento suave como acompañamiento complementario durante y después de tratamientos.', activo: true },
    { id: 'c9', nombre: 'Yin Yoga', nivel: 'Multinivel', intensidad: 'Baja', descripcion: 'Posturas pasivas sostenidas varios minutos para soltar y preparar la meditación.', activo: false },
    { id: 'c10', nombre: 'Yoga Nidra', nivel: 'Principiante', intensidad: 'Baja', descripcion: 'Relajación profunda guiada, acostado, para descansar el sistema nervioso.', activo: false },
  ],
  // dia: 0=domingo … 6=sábado
  Horario: [
    { claseId: 'c4', instructorId: 'i1', dia: 1, hora: '19:15', duracion: 60, sala: 'Espacio Cielo', cupo: 12, modalidad: 'presencial', activo: true },
    { claseId: 'c5', instructorId: 'i1', dia: 1, hora: '20:15', duracion: 60, sala: 'Espacio Cielo', cupo: 12, modalidad: 'presencial', activo: true },
    { claseId: 'c6', instructorId: 'i2', dia: 2, hora: '19:15', duracion: 60, sala: 'Espacio Cielo', cupo: 12, modalidad: 'presencial', activo: true },
    { claseId: 'c7', instructorId: 'i2', dia: 2, hora: '20:15', duracion: 60, sala: 'Espacio Cielo', cupo: 12, modalidad: 'presencial', activo: true },
    { claseId: 'c1', instructorId: 'i2', dia: 3, hora: '19:15', duracion: 60, sala: 'Espacio Cielo', cupo: 12, modalidad: 'presencial', activo: true },
    { claseId: 'c3', instructorId: 'i1', dia: 3, hora: '20:15', duracion: 60, sala: 'Espacio Cielo', cupo: 12, modalidad: 'presencial', activo: true },
    { claseId: 'c2', instructorId: 'i3', dia: 4, hora: '19:15', duracion: 60, sala: 'Espacio Cielo', cupo: 12, modalidad: 'presencial', activo: true },
    { claseId: 'c8', instructorId: 'i1', dia: 5, hora: '11:00', duracion: 60, sala: 'Espacio Cielo', cupo: 10, modalidad: 'presencial', activo: true },
  ],
  Paquetes: [
    { nombre: 'Clase muestra', clases: 1, vigenciaDias: 30, precio: 0, descripcion: 'Tu primera clase sin costo, en el estilo y horario que elijas.', soloNuevos: true, destacado: true, orden: 1, activo: true },
    { nombre: 'Ágata · 1 clase', clases: 1, vigenciaDias: 30, precio: 170, descripcion: 'Una clase suelta de cualquier estilo.', soloNuevos: false, destacado: false, orden: 2, activo: true },
    // Escalera: a más clases, menor precio por clase ($170 → $122.50 → $105 → $90),
    // y el ilimitado conviene a partir de la clase 14 del mes.
    { nombre: 'Fragmento · 4 clases', clases: 4, vigenciaDias: 30, precio: 490, descripcion: 'Una clase por semana durante un mes.', soloNuevos: false, destacado: false, orden: 3, activo: true },
    { nombre: 'Fénix · 8 clases', clases: 8, vigenciaDias: 30, precio: 840, descripcion: 'Dos clases por semana.', soloNuevos: false, destacado: true, orden: 4, activo: true },
    { nombre: 'Sol · 12 clases', clases: 12, vigenciaDias: 30, precio: 1080, descripcion: 'Tres clases por semana.', soloNuevos: false, destacado: false, orden: 5, activo: true },
    { nombre: 'Infinito · ilimitado', clases: 0, vigenciaDias: 30, precio: 1250, descripcion: 'Todas las clases, meditación y sonoterapia durante un mes.', soloNuevos: false, destacado: true, orden: 6, activo: true },
  ],
};
