// Uso: node dev/check.js   (antes de clasp push)
// Reproduce el recorte observado en Apps Script: borra desde "//" hasta fin de línea salvo
// dentro de comillas simples o dobles (las plantillas con acento grave NO se respetan),
// y luego intenta compilar el resultado.
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || require("path").join(__dirname, "..", "src", "App.html"), 'utf8').replace(/^<script>\n?|<\/script>\s*$/g, '');
const out = src.split('\n').map(line => {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'") { q = c; continue; } // observado: solo las comillas simples protegen la doble barra
    if (c === '/' && line[i + 1] === '/') {
      // una expresión regular como /\D/g no lleva doble barra, así que basta con esto
      return line.slice(0, i);
    }
  }
  return line;
}).join('\n');
const slashStar = (out.match(/\/\*/g) || []).length;
try { new Function(out); console.log('compila tras el recorte de Apps Script; barra-asterisco:', slashStar); }
catch (e) { console.log('ERROR tras el recorte:', e.message); process.exit(1); }
