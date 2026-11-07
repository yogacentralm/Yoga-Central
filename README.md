# yogacentral

Sitio del estudio con reservas, paquetes, panel de alumno y panel de administración.
Todo corre en **Google Apps Script**. Los datos quedan en **tu Google Drive**:

| En Drive | Qué guarda |
|---|---|
| `yogacentral/yogacentral — base de datos` (hoja de cálculo) | Una pestaña por tabla: Config, Usuarios, Instructores, Clases, Horario, Paquetes, Compras, Reservas, Videos |
| `yogacentral/imagenes/` | Fotos que subes desde el panel (públicas por enlace) |
| `yogacentral/comprobantes/` | Comprobantes de pago de los alumnos (privados, solo tú los ves) |
| `yogacentral/musica/` | Audios que subes desde el panel (públicos por enlace) |

El código no contiene el ID de la hoja, de las carpetas ni ninguna contraseña. `setup()` los crea y los guarda en las *Propiedades del script* de tu proyecto de Apps Script, así que el repositorio de GitHub no da acceso a la base de datos.

## Qué incluye

**Sitio público:** portada con clase gratis y WhatsApp, próximas clases, horario semanal con cupos y filtro por estilo, paquetes con precio por clase, instructoras, videoteca, mapa, contacto y términos.

**Panel del alumno** (`Mi cuenta`): saldo de clases y vigencia, reservar y cancelar (con límite de horas configurable), historial, compra de paquetes con subida de comprobante, clase muestra que se activa sola, perfil y cambio de contraseña.

**Panel de la instructora** (`Mis clases`): ve solo las clases que tiene asignadas en el horario, día por día. Muestra quién está inscrito con su teléfono, permite marcar asistió o faltó (un segundo clic lo deshace) o "Marcar a todos como asistió", y da el total de inscritos, asistencias y faltas del día. No ve pagos ni datos de otras clases.

**Panel de administración** (`Administrar`):
- Resumen: reservas de hoy, pagos por validar, alumnos activos, ventas del mes y vencimientos próximos.
- Asistencia: lista por día, marcar asistió o faltó, cancelar, agregar alumnos.
- Pagos: aprobar o rechazar comprobantes. Registrar ventas en mostrador (efectivo o terminal).
- Alumnos: buscar, ver saldo, enviar WhatsApp, vender paquete, cambiar el **rol** (alumno, instructora o administrador) y desactivar cuentas.
- Horario, Clases, Instructoras, Paquetes y Videos: alta, edición y baja, con fotos guardadas en Drive.
- Imágenes: fotos del diseño, asignadas a una página. Son decorativas y no se abren al tocarlas. Cada una tiene un **uso**:
  - *Fondo de la página*: va detrás del título con un velo claro para que el texto se lea. En Inicio reemplaza a la imagen de portada.
  - *Imagen a todo lo ancho*: va completa debajo del contenido. Sirve para una franja de fotos o una infografía.

  Las únicas fotos que se amplían son las de las **instructoras**: al tocar su tarjeta, su perfil muestra la foto en grande.
- Música: sube audios (MP3, M4A, OGG o WAV, hasta 15 MB) y elige en qué páginas suenan, incluidas *Mi cuenta* y *Mis clases*. Aparece un reproductor abajo a la izquierda. Los navegadores no permiten que la música suene sola: la persona toca ▶. Si pasa a otra página con la misma canción, sigue sonando sin cortarse. Usa música con licencia para uso comercial o libre de derechos.
- Sitio: los **7 colores** de la página, que se ven al momento y tienen un botón para restaurar los de marca, además de nombre, textos, imagen de portada, ícono, contacto, instrucciones y link de pago, horas de cancelación y términos.

## Publicarlo (una sola vez)

### Opción A: copiar y pegar (sin instalar nada)
1. Entra a <https://script.google.com> → **Nuevo proyecto**. Nómbralo `yogacentral`.
2. En **Configuración del proyecto** (⚙️), activa *"Mostrar el archivo de manifiesto appsscript.json"*.
3. Copia el contenido de cada archivo de `src/` en el editor:
   - `Code.gs` → reemplaza el `Código.gs` que viene por defecto.
   - `appsscript.json` → reemplaza el manifiesto.
   - Crea con **+ → HTML** los archivos `Index`, `Styles` y `App`, sin la extensión, y pega cada uno.
4. Elige la función **`setup`** en la barra superior y pulsa **Ejecutar**. Acepta los permisos (Drive y Hojas de cálculo). Se crean la carpeta y la hoja con los datos iniciales.
5. **Implementar → Nueva implementación → Aplicación web**:
   - *Ejecutar como*: **Yo**.
   - *Quién tiene acceso*: **Cualquier usuario**.
6. Abre la URL que te da (`https://script.google.com/macros/s/.../exec`) y **crea tu cuenta con el mismo correo de Google** con el que ejecutaste `setup`. Esa cuenta queda como administradora.

### Opción B: con clasp (línea de comandos)
```bash
npm install -g @google/clasp
```
```bash
clasp login
```
```bash
clasp create --type webapp --title yogacentral --rootDir src
```
```bash
clasp push
```
Después sigue los pasos 4 a 6 de la opción A.

### Cómo se reparte el sitio
| Dónde | Qué hace | Dirección |
|---|---|---|
| **GitHub Pages** (principal) | Página rápida e instalable: HTML, CSS y JS generados por `dev/build.js` a partir de `src/`. Funciona sin internet con lo último guardado. | https://yogacentralm.github.io/Yoga-Central/ |
| **Apps Script** | Datos y lógica: la API JSON (`doPost`) que usa GitHub Pages y, de respaldo, la misma página servida por Google (`doGet`). | La URL `/exec` |

**Velocidad:**
- **Visitas siguientes a la primera:** el sitio abre desde el celular en menos de medio segundo, aun sin señal. Muestra la información guardada y se actualiza por detrás.
- **Servidor:** la hoja se abre una sola vez por consulta y la información pública queda guardada 10 minutos en CacheService. Esa copia se borra al editar cualquier dato desde el panel.

**Instalar como app:**
- **En celular**, a los pocos segundos de entrar aparece una tarjeta de invitación, una sola vez. *Ahora no* la pospone 7 días.
- **Desde el menú**, la opción **📲 Instalar app** siempre está disponible mientras no esté instalada.
- **En iPhone**, la tarjeta explica los pasos (Compartir → Agregar a inicio).

### Publicar cambios
1. Ejecuta el verificador. Si dice *ERROR*, no publiques:
   ```bash
   node dev/check.js
   ```
2. Sube el código a Apps Script:
   ```bash
   clasp push -f
   ```
3. Actualiza la implementación. La URL no cambia:
   ```bash
   clasp create-deployment -i AKfycbxAhzC4IYx1tq9GcATo1CWdTlhL7lHalcmgR0O2h1NqqioJNHMUPdQTb3x3fyw7qNoWmQ --description "cambio"
   ```
4. Regenera el sitio de GitHub Pages:
   ```bash
   node dev/build.js
   ```
5. Haz commit y `git push`. GitHub Pages se actualiza en uno o dos minutos. Los celulares que ya lo tienen guardado reciben la versión nueva la siguiente vez que abran el sitio.

Para probar en local la versión de GitHub Pages, arranca el simulador y abre http://localhost:8787/site/.

### Regla importante al editar `App.html`
Apps Script recorta el JavaScript antes de servirlo. Borra todo lo que sigue a `//` en cada línea, salvo que esté entre **comillas simples**, y todo lo que sigue a un barra-asterisco. En el simulador no pasa, así que:
- Comenta solo con `//` al principio de la línea y nunca uses barra-asterisco.
- Escribe las direcciones web entre comillas simples (`'https://…'`), nunca dentro de una plantilla con acento grave ni entre comillas dobles.
- Antes de publicar, ejecuta el verificador. Si dice *ERROR*, no publiques:
```bash
node dev/check.js
```

### Actualizar después de cambiar el código
**Implementar → Gestionar implementaciones → ✏️ → Versión: nueva → Implementar.** La URL no cambia.

## Primeros ajustes recomendados
1. **Administrar → Sitio**: pon tus datos bancarios en *Instrucciones de pago*. Si tienes Mercado Pago o Stripe, pega el link en *Link de pago en línea* y aparecerá el botón "Pagar en línea".
2. Sube una **imagen de portada** y las **fotos de las instructoras**: hoy se muestran sus iniciales.
3. Revisa los **precios**. Los datos iniciales ya vienen escalonados para que cada paquete tenga sentido:

   | Paquete | Precio | Por clase | Antes |
   |---|---|---|---|
   | Clase muestra | Gratis | — | Gratis |
   | Ágata · 1 clase | $170 | $170 | $170 |
   | Fragmento · 4 clases | $490 | $122.50 | $490 |
   | Fénix · 8 clases | $840 | $105 | $760 |
   | Sol · 12 clases | $1,080 | $90 | $870 |
   | Infinito · ilimitado | $1,250 | conviene desde 14 clases | $970 ($776 con promoción) |

   Antes, Sol costaba más que el ilimitado y Fénix casi lo mismo, así que nadie tenía razón para comprarlos. Para una promoción, baja el precio temporalmente en **Paquetes** y avísalo en la descripción.
4. Agrega horarios de mañana y fin de semana en **Horario**. Activa Yin y Nidra en **Clases** cuando tengan horario: un estilo inactivo no aparece en el sitio.
5. **Da acceso a cada instructora:** pídele que cree su cuenta en el sitio. Luego ve a **Administrar → Alumnos → Rol**, elige *Instructora* y su ficha. A partir de ese momento ve "Mis clases" con las clases asignadas a esa ficha en **Horario**.
6. Para usar tu dominio, por ejemplo `yogacentral.mx`, incrusta la URL `/exec` en Google Sites o redirige el dominio a ella.

## Probar en tu computadora sin desplegar
No abras los archivos de `src/` directo en el navegador: son piezas que Apps Script une al servir la página, y solos se ven en blanco. En Windows, da **doble clic en `iniciar.bat`**: arranca el simulador y abre el navegador. También puedes arrancarlo desde la terminal. El simulador ejecuta `src/Code.gs` con versiones en memoria de los servicios de Google:
```bash
node dev/server.js
```
Abre <http://localhost:8787>. Regístrate con `admin@yogacentral.test` para entrar como administrador; cualquier otro correo será alumno. Para probar el panel de instructora, registra otra cuenta y asígnale el rol desde **Alumnos → Rol**. Los datos se guardan en `dev/.data.json`. Para empezar de cero:
```bash
node dev/server.js --reset
```
El simulador no reproduce los límites de Google: cuotas, tiempo máximo de 6 minutos por llamada, ni que la caché pueda vaciarse antes.

## Notas y límites
- **Inicio de sesión:** correo y contraseña propios del sitio. Las contraseñas se guardan con sal y hash SHA-256 iterado. La sesión dura 6 horas sin actividad y se renueva al usar el sitio. Google puede vaciar la caché antes; en ese caso se pide iniciar sesión de nuevo.
- **Olvidé mi contraseña:** no hay envío de correos. El alumno te escribe por WhatsApp; para restablecerla, borra su fila en la pestaña `Usuarios` y pídele que se registre de nuevo, o agrega esa función.
- **Pagos:** el pago en línea es un enlace externo. La compra queda *pendiente* hasta que la apruebas; la clase muestra (precio 0) se activa sola.
- **Volumen:** la hoja funciona bien hasta unos miles de reservas. Si crece mucho, archiva las reservas viejas en otra hoja.
- **No edites a mano** las columnas `hash`, `salt` e `id` de la hoja.
- **Roles:** `alumno`, `instructor` y `admin`, en la columna `rol` de `Usuarios`. `instructorId` liga una cuenta de instructora con su ficha. Si actualizas una instalación anterior, vuelve a ejecutar `setup()`: agrega las columnas nuevas sin borrar datos.
