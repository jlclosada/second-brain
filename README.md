# Segundo Cerebro

Tu agenda, tus tareas, tus notas y tus papeles en un solo sitio, en tu ordenador y en el móvil.
Abres la app y ves qué te toca hoy; escribes «dentista el martes a las 10» y queda en el
calendario; buscas «seguro de coche 2024» y aparece la póliza.

## Qué hace

**Hoy.** La pantalla de inicio: la fecha, qué tienes y qué viene después, el hilo del día con tus
eventos y la hora actual, las tareas vencidas y de hoy, los recordatorios, los documentos que
vencen pronto, tu diario del día y tus notas fijadas.

**Captura rápida.** Botón + (o ⌘K / Ctrl+K) y escribe como hablas:
- «Cena con Laura el viernes a las 21h» → evento
- «Pagar el IBI el 5 de noviembre #casa !» → tarea con fecha, etiqueta y prioridad alta
- «Recuérdame sacar la ropa en 2 horas» → aviso en el móvil
- «nota: el código del trastero es 4512» → nota

Con clave de Claude lo interpreta Claude Haiku; sin ella, un intérprete propio de fechas en español
(«mañana por la tarde», «el 3/11 a las 9:15», «de 10 a 12 el lunes», «la próxima semana»…).

**Calendario.** Vistas de día, semana, mes y agenda. Eventos con repetición (cada semana, cada mes…)
y aviso previo. Conecta Google Calendar, iCloud u Outlook con su enlace privado iCal (se guarda
cifrado y se sincroniza cada 15 minutos). Y al revés: un enlace privado para ver tus eventos en el
calendario del móvil.

**Tareas.** Hoy, próximas, sin fecha, todas y hechas. Fecha y hora, prioridad, repetición (al
completarla salta a la siguiente fecha), etiquetas y proyecto.

**Notas y diario.** Notas en Markdown con enlaces `[[Otra nota]]` (con autocompletado) y la lista
de notas que te mencionan. Una entrada de diario por día que se guarda sola.

**Proyectos y áreas.** Agrupa tareas, notas y documentos: proyectos con final («Reforma de la
cocina») y áreas permanentes («Salud», «Casa»).

**Documentos.** Sube PDFs (también escaneados), fotos, Word o texto. Se leen con OCR, se
clasifican (tipo, categoría, año, vencimiento, entidades) y se avisa antes de que venzan.

**Búsqueda.** Una sola búsqueda para todo, por palabras y por significado: «coche» encuentra
«automóvil» y «poliza» encuentra «póliza». Un año en la búsqueda filtra por ese año.

**Asistente.** Conversa con Claude, que consulta tu segundo cerebro y actúa: «¿qué tengo esta
semana?», «¿cuándo vence el seguro del coche?», «apúntame el dentista el jueves a las 10»,
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
- Los enlaces iCal y la semilla TOTP se guardan **cifrados**.
- **Registro de actividad**: entradas, fallos, cambios de contraseña…
- Los contenedores corren **sin root**.

Si olvidas la contraseña: `docker compose exec app python -m app.cli reset-password`.

## Arrancarlo en tu PC

Necesitas [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, Mac o Linux).

```bash
git clone https://github.com/jlclosada/second-brain.git
cd second-brain
cp .env.example .env        # en Windows: copy .env.example .env
# Edita .env: pon tu contraseña inicial y, si quieres, tu ANTHROPIC_API_KEY
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
    scheduler.py       avisos, resumen del día, sincronizaciones
    notify.py          avisos en la app y Web Push
    assistant.py       Claude con herramientas
    jobs.py            cola de trabajos
    indexing.py, search.py  indexado y búsqueda híbrida (RRF)
    extract.py, classify.py, pipeline.py  documentos
frontend/src/
  pages/               Hoy, Calendario, Tareas, Notas, Diario, Documentos, Proyectos,
                       Buscar, Asistente, Ajustes
  components/          Shell, paleta ⌘K, hilo del día, editores
```

## Próximas ideas

- Captura por email y carpeta vigilada; notas de voz.
- Hábitos y resumen semanal.
- Escribir en Google Calendar (hoy la sincronización es de lectura).
