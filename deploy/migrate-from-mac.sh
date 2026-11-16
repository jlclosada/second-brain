#!/usr/bin/env bash
# Se ejecuta EN EL MAC, desde la carpeta del repo (~/Code/second-brain).
# Lleva Jarvis del Mac al servidor:
#   1. Empareja Syncthing: tu vault de Obsidian se sincroniza en los dos sentidos y
#      las copias de seguridad del servidor llegan a ~/Backups/Jarvis.
#   2. Copia la base de datos, tus documentos, la clave de cifrado y tu .env.
#   3. Para Jarvis en el Mac para que no haya dos funcionando a la vez.
#
#   ./deploy/migrate-from-mac.sh [servidor]        # por defecto «jarvis» (nombre en Tailscale)
#   ./deploy/migrate-from-mac.sh jarvis --sync-only   # solo el paso 1
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER="${1:-jarvis}"
MODE="${2:-}"
SSH_USER="${SSH_USER:-ubuntu}"
TARGET="$SSH_USER@$SERVER"
say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
remote() { ssh -o BatchMode=yes "$TARGET" "$@"; }

[[ -f .env ]] || die "No encuentro .env en $(pwd). Ejecútalo desde la carpeta del repo."
remote true 2>/dev/null || die "No puedo entrar por SSH en $TARGET. ¿Tailscale está conectado en el Mac?"

envval() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" .env | tail -1; }
VAULT="$(envval VAULT_PATH)"; VAULT="${VAULT:-$HOME/Documents/Segundo-Cerebro}"; VAULT="${VAULT/#\~/$HOME}"
[[ -d "$VAULT" ]] || die "No encuentro el vault en $VAULT (pon VAULT_PATH en .env)."

# ------------------------------------------------------------------ 1. Syncthing
say "Syncthing en el Mac"
TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
command -v tailscale >/dev/null && TS=tailscale
MAC_HOST="$("$TS" status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
if ! command -v syncthing >/dev/null; then
  command -v brew >/dev/null || die "Necesito Homebrew para instalar Syncthing (https://brew.sh)."
  brew install syncthing
fi
brew services start syncthing >/dev/null 2>&1 || true
CFG=""
for _ in $(seq 1 30); do
  for c in "$HOME/Library/Application Support/Syncthing/config.xml" "$HOME/.local/state/syncthing/config.xml" "$HOME/.config/syncthing/config.xml"; do
    [[ -f "$c" ]] && CFG="$c" && break
  done
  [[ -n "$CFG" ]] && break; sleep 2
done
[[ -n "$CFG" ]] || die "Syncthing no ha creado su configuración."
KEY="$(sed -n 's:.*<apikey>\(.*\)</apikey>.*:\1:p' "$CFG")"
GUI="$(sed -n '/<gui /,/<\/gui>/s:.*<address>\(.*\)</address>.*:\1:p' "$CFG")"; GUI="${GUI:-127.0.0.1:8384}"
api() { local m="$1" p="$2"; shift 2; curl -fsS -X "$m" -H "X-API-Key: $KEY" "http://$GUI/rest$p" "$@"; }
for _ in $(seq 1 30); do api GET /system/ping >/dev/null 2>&1 && break; sleep 2; done
MAC_ID="$(api GET /system/status | python3 -c 'import json,sys; print(json.load(sys.stdin)["myID"])')"

say "Syncthing en el servidor"
SERVER_ID="$(remote "sudo bash /srv/jarvis/app/deploy/syncthing-setup.sh '$MAC_ID' '$MAC_HOST'" | sed -n 's/^SERVER_SYNCTHING_ID=//p')"
[[ -n "$SERVER_ID" ]] || die "El servidor no devolvió su ID de Syncthing."

BACKUP_DIR="$HOME/Backups/Jarvis"
mkdir -p "$BACKUP_DIR"
api PUT "/config/devices/$SERVER_ID" -d "{\"deviceID\":\"$SERVER_ID\",\"name\":\"Jarvis (Oracle)\",\"addresses\":[\"tcp://$SERVER:22000\"]}" >/dev/null
api PUT /config/folders/jarvis-vault -d "{
  \"id\":\"jarvis-vault\",\"label\":\"Jarvis · Vault de Obsidian\",\"path\":\"$VAULT\",
  \"type\":\"sendreceive\",\"fsWatcherEnabled\":true,\"devices\":[{\"deviceID\":\"$SERVER_ID\"}],
  \"versioning\":{\"type\":\"trashcan\",\"params\":{\"cleanoutDays\":\"30\"}}
}" >/dev/null
api PUT /config/folders/jarvis-backups -d "{
  \"id\":\"jarvis-backups\",\"label\":\"Jarvis · Copias de seguridad\",\"path\":\"$BACKUP_DIR\",
  \"type\":\"receiveonly\",\"fsWatcherEnabled\":false,\"devices\":[{\"deviceID\":\"$SERVER_ID\"}]
}" >/dev/null
echo "Vault $VAULT ⇄ servidor; copias del servidor → $BACKUP_DIR"

say "Esperando a que el vault termine de subir…"
for _ in $(seq 1 180); do
  pct="$(api GET "/db/completion?folder=jarvis-vault&device=$SERVER_ID" 2>/dev/null | python3 -c 'import json,sys; print(int(json.load(sys.stdin).get("completion",0)))' 2>/dev/null || echo 0)"
  printf '\r  %s%%' "$pct"; [[ "$pct" == 100 ]] && break; sleep 5
done
echo
[[ "$MODE" == "--sync-only" ]] && { say "Listo (solo sincronización)."; exit 0; }

# ------------------------------------------------------------------ 2. datos
WORK="$(mktemp -d)"; chmod 700 "$WORK"; trap 'rm -rf "$WORK"' EXIT
say "Parando Jarvis en el Mac para copiar los datos sin cambios a medias"
docker compose up -d db >/dev/null
docker compose stop app worker >/dev/null
until docker compose exec -T db pg_isready -U brain >/dev/null 2>&1; do sleep 2; done
docker compose exec -T db pg_dump -U brain -Fc brain > "$WORK/brain.dump"
docker compose run --rm --no-deps -T --entrypoint tar app -C /data --exclude=./models -czf - . > "$WORK/data.tar.gz"
# .env del Mac → jarvis.env del servidor: sin espacios alrededor del «=» y sin lo que
# en el servidor decide docker-compose.prod.yml o setup-server.sh.
sed -E -e 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*/\1=/' .env \
  | grep -vE '^(VAULT_PATH|DOWNLOADS_PATH|DATABASE_URL|PUBLIC_URL|COOKIE_SECURE|VAULT_DIR|DOWNLOADS_DIR)=' > "$WORK/jarvis.env"
chmod 600 "$WORK"/*
ls -lh "$WORK" | tail -n +2 | awk '{print "  "$5"  "$9}'

say "Enviando al servidor (cifrado por SSH sobre Tailscale)"
remote 'rm -rf ~/jarvis-migration && mkdir -m 700 ~/jarvis-migration'
scp -q "$WORK"/brain.dump "$WORK"/data.tar.gz "$WORK"/jarvis.env "$TARGET:jarvis-migration/"

say "Restaurando en el servidor"
remote 'set -e
  sudo sh -c "jarvis backup >/dev/null"   # por si acaso, copia de lo que hubiera
  url=$(sudo grep "^PUBLIC_URL=" /srv/jarvis/config/jarvis.env || true)
  sudo install -m 600 -o root -g root ~/jarvis-migration/jarvis.env /srv/jarvis/config/jarvis.env
  [ -n "$url" ] && echo "$url" | sudo tee -a /srv/jarvis/config/jarvis.env >/dev/null
  echo sí | sudo jarvis restore ~/jarvis-migration
  rm -rf ~/jarvis-migration'

say "Apagando Jarvis en el Mac (tus datos siguen en los volúmenes de Docker por si acaso)"
docker compose down >/dev/null

URL="$(remote 'sudo sed -n "s/^PUBLIC_URL=//p" /srv/jarvis/config/jarvis.env')"
cat <<FIN

  ✅ Migración hecha. Abre $URL
     En el móvil: Tailscale activado, abre esa dirección y «Añadir a pantalla de inicio».
     Si usas Gmail/Calendar, añade en Google Cloud el URI $URL/api/integrations/google/callback
FIN
