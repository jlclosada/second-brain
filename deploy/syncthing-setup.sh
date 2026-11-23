#!/usr/bin/env bash
# Configura Syncthing en el servidor para sincronizar el vault de Obsidian con tu Mac
# y mandarle las copias de seguridad. Todo va por Tailscale: sin relays públicos,
# sin descubrimiento global y con el cortafuegos cerrado al resto de internet.
#
#   sudo bash syncthing-setup.sh                         # deja el servidor listo y muestra su ID
#   sudo bash syncthing-setup.sh <ID-del-Mac> <nombre-tailscale-del-Mac>   # empareja con el Mac
set -euo pipefail
JARVIS_HOME="${JARVIS_HOME:-/srv/jarvis}"
MAC_ID="${1:-}"
MAC_HOST="${2:-}"
[[ $EUID -eq 0 ]] || exec sudo bash "$0" "$@"

jarvis compose up -d syncthing >/dev/null
cfg="$JARVIS_HOME/syncthing/config/config.xml"
for _ in $(seq 1 30); do [[ -f $cfg ]] && grep -q '<apikey>' "$cfg" && break; sleep 2; done
KEY="$(sed -n 's:.*<apikey>\(.*\)</apikey>.*:\1:p' "$cfg")"
api() { local m="$1" p="$2"; shift 2; curl -fsS -X "$m" -H "X-API-Key: $KEY" "http://127.0.0.1:8384/rest$p" "$@"; }
for _ in $(seq 1 30); do api GET /system/ping >/dev/null 2>&1 && break; sleep 2; done

# Privacidad: nada de servidores públicos de Syncthing.
api PATCH /config/options -d '{
  "globalAnnounceEnabled": false, "localAnnounceEnabled": false,
  "relaysEnabled": false, "natEnabled": false,
  "urAccepted": -1, "crashReportingEnabled": false,
  "listenAddresses": ["tcp://0.0.0.0:22000"]
}' >/dev/null
api DELETE /config/folders/default >/dev/null 2>&1 || true

for d in vault backups; do
  [[ -d "$JARVIS_HOME/$d/.stfolder" ]] || install -d -o 1000 -g 1000 "$JARVIS_HOME/$d/.stfolder"
done

devices='[]'
if [[ -n $MAC_ID ]]; then
  [[ -n $MAC_HOST ]] || { echo "Falta el nombre de Tailscale del Mac." >&2; exit 1; }
  api PUT "/config/devices/$MAC_ID" -d "{\"deviceID\":\"$MAC_ID\",\"name\":\"Mac\",\"addresses\":[\"tcp://$MAC_HOST:22000\"],\"autoAcceptFolders\":false}" >/dev/null
  devices="[{\"deviceID\":\"$MAC_ID\"}]"
fi

# Vault: en los dos sentidos. Lo que se borre o cambie aquí se guarda 30 días en .stversions.
api PUT /config/folders/jarvis-vault -d "{
  \"id\":\"jarvis-vault\",\"label\":\"Jarvis · Vault de Obsidian\",\"path\":\"/sync/vault\",
  \"type\":\"sendreceive\",\"fsWatcherEnabled\":true,\"devices\":$devices,
  \"versioning\":{\"type\":\"trashcan\",\"params\":{\"cleanoutDays\":\"30\"}}
}" >/dev/null
# Copias de seguridad: solo salen del servidor hacia el Mac.
api PUT /config/folders/jarvis-backups -d "{
  \"id\":\"jarvis-backups\",\"label\":\"Jarvis · Copias de seguridad\",\"path\":\"/sync/backups\",
  \"type\":\"sendonly\",\"fsWatcherEnabled\":true,\"devices\":$devices
}" >/dev/null

echo "SERVER_SYNCTHING_ID=$(api GET /system/status | jq -r .myID)"
