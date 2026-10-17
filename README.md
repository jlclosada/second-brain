# Segundo Cerebro

Tu archivo personal: subes cualquier documento (PDF, foto, Word, texto) y la app lo lee, lo clasifica y lo deja listo para encontrarlo escribiendo cosas como **"seguro de coche 2024"**, o preguntando **"¿cuándo vence el seguro del coche?"**.

Funciona en tu PC y desde el móvil, que la puede instalar como si fuera una app.

## Qué hace hoy

- **Subir** archivos arrastrándolos, eligiéndolos o haciendo una foto con el móvil. Los duplicados se detectan solos.
- **Leer** el texto: PDFs normales, PDFs escaneados y fotos (OCR en español e inglés), Word y texto plano.
- **Clasificar** con Claude Haiku: título claro, tipo (póliza, factura, nómina…), categoría, año, fechas, vencimiento, etiquetas, resumen y entidades (aseguradora, matrícula…). Sin clave de API usa reglas básicas.
- **Buscar** combinando palabras exactas y significado: "coche" encuentra "automóvil", "poliza" encuentra "póliza", y el año de la búsqueda se usa como filtro.
- **Preguntar** en lenguaje natural: Claude responde usando solo tus documentos y enlaza cada dato a su fuente.
- **Ver vencimientos** de los próximos 60 días en la pantalla de inicio.
- **Editar** cualquier dato si la clasificación no acierta, reprocesar o borrar.

Los originales se guardan intactos en `data/files/` (un volumen de Docker).

## Arrancarlo en tu PC

Necesitas [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, Mac o Linux).

```bash
git clone https://github.com/jlclosada/second-brain.git
cd second-brain
cp .env.example .env        # en Windows: copy .env.example .env
# Edita .env: pon tu contraseña y tu ANTHROPIC_API_KEY
docker compose up -d --build
```

Abre <http://localhost:8000> y entra con tu contraseña.

La primera vez que se procesa un documento se descarga el modelo de búsqueda por significado (unos 220 MB). Después funciona sin conexión salvo la parte de Claude.

Para pararlo: `docker compose down`. Tus datos se quedan en los volúmenes y vuelven al arrancar.

## Usarlo desde el móvil

El PC tiene que estar encendido con la app arrancada.

**En casa (misma Wi-Fi):** abre `http://IP-DE-TU-PC:8000` en el móvil. La IP la ves con `ipconfig` (Windows) o `ipconfig getifaddr en0` (Mac).

**Desde cualquier sitio y como app instalada (recomendado):** usa [Tailscale](https://tailscale.com/), que es gratis para uso personal y no abre puertos en tu router.

1. Instala Tailscale en el PC y en el móvil, con la misma cuenta.
2. En el PC ejecuta `tailscale serve --bg 8000`. Te dará una dirección `https://tu-pc.xxxx.ts.net`.
3. Ábrela en el móvil y elige "Añadir a pantalla de inicio" (Safari) o "Instalar app" (Chrome).

Hace falta HTTPS para instalarla como app; Tailscale lo pone solo.

## Copias de seguridad

```bash
./scripts/backup.sh
```

Guarda la base de datos y todos los archivos en `backups/<fecha>/`. Llévala fuera del PC (disco externo o nube). Para restaurar la base de datos: `docker compose exec -T db pg_restore -U brain -d brain --clean < backups/<fecha>/brain.dump`.

## Coste

Todo es gratis excepto Claude Haiku, que se paga por uso en tu cuenta de Anthropic. Clasificar un documento normal cuesta una fracción de céntimo. La búsqueda no usa Claude; solo el modo "Preguntar".

## Pasarlo a la nube más adelante

La misma configuración de Docker funciona en un servidor. La opción gratuita recomendada es una máquina ARM de **Oracle Cloud Always Free**. Instala Docker y Tailscale allí, copia `.env` y restaura una copia de seguridad.

## Desarrollo

```bash
# Base de datos
docker compose up -d db

# Backend (Python 3.13)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload       # API en :8000
python -m app.worker                # en otra terminal
pytest                              # usa la base brain_test

# Interfaz (Node 22)
cd frontend
npm install
npm run dev                         # http://localhost:5173, redirige /api al backend
```

### Cómo está hecho

| Parte | Tecnología |
| --- | --- |
| Interfaz | React + Vite + Tailwind, instalable como PWA |
| API | FastAPI (Python) |
| Procesado en segundo plano | Worker propio con cola en PostgreSQL |
| Base de datos | PostgreSQL 16 + pgvector + búsqueda de texto en español |
| OCR | OCRmyPDF + Tesseract |
| Clasificación y respuestas | Claude Haiku (`claude-haiku-5-5`) |
| Búsqueda por significado | fastembed `paraphrase-multilingual-MiniLM-L12-v2`, local y gratis |

```
backend/app/
  main.py              arranque de la API y de la interfaz compilada
  worker.py            proceso que procesa los documentos subidos
  models.py            tablas: items, documents, chunks
  routers/             endpoints /api/...
  services/
    extract.py         texto de PDF, OCR, Word
    classify.py        Claude Haiku o reglas
    pipeline.py        extraer → clasificar → trocear → embeddings
    search.py          búsqueda híbrida con fusión RRF
    ask.py             preguntas con fuentes citadas
frontend/src/
  pages/               Buscar, Documentos, Documento, Subir, Login
```

## Próximas fases

1. Calendario: sincronizar con Google/Outlook y crear recordatorios de vencimientos.
2. Diario: nota del día, hábitos y resumen semanal.
3. Proyectos y tareas enlazados a documentos.
4. Más formas de captura: email de entrada, carpeta vigilada y notas de voz.
