#!/usr/bin/env bash
# Copia de seguridad: base de datos + archivos originales en ./backups/<fecha>/
# Uso: ./scripts/backup.sh   (con la app arrancada con docker compose)
set -euo pipefail
cd "$(dirname "$0")/.."
dest="backups/$(date +%Y-%m-%d_%H%M)"
mkdir -p "$dest"
docker compose exec -T db pg_dump -U brain -Fc brain > "$dest/brain.dump"
docker compose exec -T app tar -C /data -czf - files > "$dest/files.tar.gz"
echo "Copia guardada en $dest"
echo "Recuerda llevarla fuera de este equipo (disco externo, nube…)."
