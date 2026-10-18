# Jarvis — tu segundo cerebro

Un asistente personal que vive en tu ordenador y maneja toda tu información: le hablas (o le
escribes) y consulta tu vault de Obsidian, tus documentos, tu Google Calendar, tu Gmail, tus tareas
y tus issues de GitHub, y actúa: apunta, agenda, archiva y te avisa.

- **Jarvis.** La pantalla principal: un núcleo vivo que escucha, piensa y habla. Mantén pulsada la
  barra espaciadora para hablarle; responde en voz alta y en directo, enseñando lo que consulta y hace.
  Debajo, tu día: lo siguiente en la agenda (con botón para la videollamada), tareas, correo por
  atender, revisiones de GitHub y lo que ha hecho por su cuenta.
- **Memoria = tu vault de Obsidian.** Lo lee entero (búsqueda por palabras y por significado) y escribe
  siguiendo el `CLAUDE.md` del vault: capturas a `00-Bandeja`, diario en `05-Diario/AAAA-MM-DD.md`,
  wikilinks, y nunca borra nada. Lo que cambias en Obsidian lo ve en un minuto.
- **Descargas se ordena sola.** Cada documento nuevo (PDF, fotos, Word, hojas…) se lee con OCR, Claude lo
  clasifica (y mira las fotos), le pone un nombre claro y lo mueve a `Adjuntos/<categoría>/` del vault
  con una nota en `03-Recursos/Documentos/` y un índice. Los duplicados van a `Adjuntos/_Duplicados`.
  Instaladores, comprimidos y vídeos se quedan donde están. Necesita la clave de Claude.

## Qué hace

Cinco secciones, iguales en el ordenador y en el móvil: **Hoy**, **Bandeja**, **Calendario**,
**Tareas** y **Biblioteca** (notas, diario, documentos y proyectos). El asistente, los avisos y los
ajustes están siempre a mano arriba (móvil) o abajo en la barra lateral (ordenador).

**Hoy.** Lo que toca: lo siguiente en tu agenda (con botón para unirte a la videollamada), tareas
vencidas y de hoy, el correo que requiere respuesta, los PR que te piden revisar en GitHub, los
recordatorios y vencimientos, tu diario y tus notas fijadas. Arriba, la caja para apuntar.

**Bandeja.** Tu Gmail, con lo importante primero: «Requiere atención» (sin leer, importante o
destacado en Principal), Principal, notificaciones y promociones. De cada correo: crear tarea (con
enlace al correo), archivar (también en Gmail), marcar como leído o abrirlo en Gmail.

**Conexiones.** En Ajustes → Conexiones:
- **Google**: Gmail (últimos 30 días de la bandeja, cada 5 minutos) y Google Calendar en los dos
  sentidos (cada 10 minutos; lo que creas, editas o borras aquí se hace también en Google, al momento).
  Hace falta crear una vez un cliente OAuth en Google Cloud; la propia pantalla te guía paso a paso.
- **GitHub**: con un token, los PR en los que te piden revisión y los issues asignados aparecen como
  tareas, y se marcan como hechos al cerrarse.

**Captura rápida.** La caja de Hoy, el botón + o la tecla C. Escribe como hablas y verás antes de
guardar en qué se convierte; si se equivoca, toca Tarea, Evento, Aviso o Nota:
- «Cena con Laura el viernes a las 21h» → evento
- «Pagar el IBI el 5 de noviembre #casa !» → tarea con fecha, etiqueta y prioridad alta
- «Recuérdame sacar la ropa en 2 horas» → aviso en el móvil
- «nota: el código del trastero es 4512» → nota

Con clave de Claude lo interpreta Claude Haiku; sin ella, un intérprete propio de fechas en español
(«mañana por la tarde», «el 3/11 a las 9:15», «de 10 a 12 el lunes», «la próxima semana»…).

**Calendario.** Vistas de día, semana, mes y agenda. Eventos con repetición (cada semana, cada mes…)
y aviso previo. Google Calendar se conecta con tu cuenta (lectura y escritura); iCloud u Outlook, con
su enlace privado iCal (solo lectura, cifrado, cada 15 minutos). Y al revés: un enlace privado para
ver tus eventos en el calendario del móvil.

**Tareas.** Hoy, próximas, sin fecha, todas y hechas. Fecha y hora, prioridad, repetición (al
completarla salta a la siguiente fecha), etiquetas y proyecto.

**Notas y diario.** Notas en Markdown con enlaces `[[Otra nota]]` (con autocompletado) y la lista
de notas que te mencionan. Una entrada de diario por día que se guarda sola.

**Proyectos y áreas.** Agrupa tareas, notas y documentos: proyectos con final («Reforma de la
cocina») y áreas permanentes («Salud», «Casa»).

**Documentos.** Sube PDFs (también escaneados), fotos, Word o texto. Se leen con OCR, se
clasifican (tipo, categoría, año, vencimiento, entidades) y se avisa antes de que venzan.

**Búsqueda.** ⌘K (o /). Una sola búsqueda para todo, también tus correos,, por palabras y por significado: «coche» encuentra
«automóvil» y «poliza» encuentra «póliza». Un año en la búsqueda filtra por ese año.

**Asistente.** Conversa con Claude, que consulta tu segundo cerebro y actúa: «¿qué tengo esta
semana?», «¿qué correos tengo pendientes?», «¿cuándo vence el seguro del coche?», «apúntame el dentista el jueves a las 10»,
«resume lo que escribí en el diario estos días». Enseña qué ha consultado o creado, con enlaces.

**Avisos.** Notificaciones push en el móvil y en el ordenador: recordatorios, eventos próximos,
tareas con hora, vencimientos (30, 7 y 1 día antes) y un resumen del día cada mañana.

## Seguridad

- Contraseña guardada con **Argon2**; se cambia desde Ajustes. La de `.env` es solo la inicial.
- **Verificación en dos pasos (TOTP)** opcional, con cualquier app de autenticación.
- **Sesiones revocables**: ves desde qué dispositivos has entrado y puedes cerrarlas. Cambiar la
  contraseña cierra todas las demás.
- **Límite de intentos**: 5 fallos en 15 minutos bloquean esa IP (y hay un límite global).
- **CSRF**: toda petición que cambia datos exige una cabecera propia que otra web no puede añadir;
  la cookie es `HttpOnly`, `SameSite=Lax` y `Secure` con HTTPS.
- **Cabeceras de seguridad**: CSP estricta, `nosniff`, `frame-ancestors`, HSTS con HTTPS.
- Los archivos HTML/SVG subidos se sirven aislados (`CSP: sandbox`) para que no ejecuten nada.
- Los enlaces iCal, la semilla TOTP y los tokens de Google y GitHub se guardan **cifrados**.
- El permiso de Google se pide con un estado firmado y atado a tu sesión; desconectar revoca el
  permiso en Google y borra de aquí los correos y eventos traídos de allí.
- **Registro de actividad**: entradas, fallos, cambios de contraseña…
- Los contenedores corren **sin root**.

Si olvidas la contraseña: `docker compose exec app python -m app.cli reset-password`.

## Arrancarlo en tu PC

Necesitas [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, Mac o Linux).

```bash
git clone https://github.com/jlclosada/second-brain.git
cd second-brain
cp .env.example .env        # en Windows: copy .env.example .env
# Edita .env: tu contraseña inicial, ANTHROPIC_API_KEY (imprescindible para Jarvis),
# y si tu vault o tu Descargas no están en ~/Documents/Segundo-Cerebro y ~/Downloads, VAULT_PATH y DOWNLOADS_PATH
docker compose up -d --build
```

Abre <http://localhost:8000> y entra con tu contraseña.

Al arrancar, el servicio `migrate` pone la base de datos al día y termina; después arrancan la API
y el worker. La primera vez que se procesa algo se descarga el modelo de búsqueda por significado
(unos 220 MB). Después funciona sin conexión salvo lo que usa Claude y la sincronización de calendarios.

Para pararlo: `docker compose down`. Tus datos se quedan en los volúmenes y vuelven al arrancar.

## Usarlo desde el móvil

El PC tiene que estar encendido con la app arrancada.

**Desde cualquier sitio y como app instalada (recomendado):** usa [Tailscale](https://tailscale.com/),
gratis para uso personal y sin abrir puertos en el router.

1. Instala Tailscale en el PC y en el móvil, con la misma cuenta.
2. En el PC ejecuta `tailscale serve --bg 8000`. Te dará una dirección `https://tu-pc.xxxx.ts.net`.
3. Ábrela en el móvil y elige «Añadir a pantalla de inicio» (Safari) o «Instalar app» (Chrome).
4. En Ajustes, pulsa «Activar notificaciones».

Las notificaciones y la instalación como app necesitan HTTPS; Tailscale lo pone solo.

**En casa (misma Wi-Fi):** `http://IP-DE-TU-PC:8000`. Funciona todo menos las notificaciones push.

## Copias de seguridad

```bash
./scripts/backup.sh
```

Guarda la base de datos y todos los archivos en `backups/<fecha>/`. Llévala fuera del PC. Para
restaurar la base de datos: `docker compose exec -T db pg_restore -U brain -d brain --clean < backups/<fecha>/brain.dump`.

## Coste

Todo es gratis excepto Claude, que se paga por uso en tu cuenta de Anthropic. Clasificar documentos y
entender la captura rápida usa Claude Haiku (una fracción de céntimo cada vez). El asistente también usa
Haiku por defecto (`CHAT_MODEL`); puedes cambiarlo por un modelo más potente si lo prefieres.

## Escalar

- Más workers: `docker compose up -d --scale worker=3`. La cola reparte el trabajo con
  `SKIP LOCKED` y solo uno ejecuta el planificador (advisory lock de Postgres).
- Más procesos de API: `WEB_CONCURRENCY=2` en `.env`.
- La misma configuración funciona en un servidor (por ejemplo una máquina ARM de Oracle Cloud
  Always Free con Docker y Tailscale): copia `.env` y restaura una copia de seguridad.

## Desarrollo

```bash
# Base de datos
docker compose up -d db

# Backend (Python 3.13)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python -m app.cli migrate           # aplica las migraciones
uvicorn app.main:app --reload       # API en :8000
python -m app.worker                # en otra terminal
ruff check . && pytest              # pytest usa la base brain_test

# Interfaz (Node 22)
cd frontend
npm install
npm run dev                         # http://localhost:5173, redirige /api al backend (API_URL)
```

### Cómo está hecho

| Parte | Tecnología |
| --- | --- |
| Interfaz | React 19 + Vite + Tailwind 4, TanStack Query, transiciones de vista nativas, PWA con push |
| API | FastAPI (Python 3.13) |
| Base de datos | PostgreSQL 16 + pgvector + búsqueda de texto en español, migraciones con Alembic |
| Trabajo en segundo plano | Cola propia en PostgreSQL con reintentos + planificador cada minuto |
| OCR | OCRmyPDF + Tesseract |
| IA | Claude Haiku para clasificar y capturar; asistente con herramientas (`CHAT_MODEL`) |
| Búsqueda por significado | fastembed `paraphrase-multilingual-MiniLM-L12-v2`, local y gratis |
| Calendario | iCalendar + recurring-ical-events, reglas RFC 5545 |

```
backend/app/
  main.py              API, middleware de seguridad e interfaz compilada
  worker.py            cola de trabajos + planificador
  cli.py               migrate, reset-password
  security.py          Argon2, TOTP, sesiones, límite de intentos, cifrado
  models/              items (común), notas, tareas, eventos, sistema
  migrations/          Alembic
  routers/             endpoints /api/...
  services/
    brain.py           crear y modificar notas, tareas, eventos y recordatorios
    capture.py, when.py  captura rápida y fechas en español
    calendar.py        ocurrencias, sincronización iCal y feed
    google.py          OAuth, Gmail y Google Calendar (lectura y escritura)
    github.py          issues y PR → tareas
    scheduler.py       avisos, resumen del día, sincronizaciones
    notify.py          avisos en la app y Web Push
    assistant.py       Claude con herramientas
    jobs.py            cola de trabajos
    indexing.py, search.py  indexado y búsqueda híbrida (RRF)
    extract.py, classify.py, pipeline.py  documentos
frontend/src/
  pages/               Hoy, Bandeja, Calendario, Tareas, Notas, Diario, Documentos,
                       Proyectos, Buscar, Asistente, Ajustes
  components/          Shell, captura, búsqueda ⌘K, conexiones, hilo del día, editores
```

## Próximas ideas

- Captura por email y carpeta vigilada; notas de voz.
- Hábitos y resumen semanal.
- Responder correos desde la app (hoy se abre Gmail).
