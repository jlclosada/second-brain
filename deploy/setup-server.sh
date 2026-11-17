#!/usr/bin/env bash
# Prepara un servidor Ubuntu 24.04 (Oracle Cloud Always Free, ARM Ampere) para Jarvis.
# Se puede ejecutar varias veces: cada paso comprueba si ya está hecho.
#
#   curl -fsSL <este archivo> -o setup-server.sh && sudo bash setup-server.sh
#   sudo bash setup-server.sh --close-public-ssh   # paso final, cuando Tailscale funciona
#
# Variables opcionales:
#   DEPLOY_BRANCH   rama a desplegar (por defecto main)
#   GIT_REPO        repositorio (por defecto git@github.com:jlclosada/second-brain.git)
#   TS_AUTHKEY      clave de Tailscale para no tener que abrir el enlace de login
set -euo pipefail

JARVIS_HOME=/srv/jarvis
GIT_REPO="${GIT_REPO:-git@github.com:jlclosada/second-brain.git}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
TS_HOSTNAME="${TS_HOSTNAME:-jarvis}"

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
[[ $EUID -eq 0 ]] || { echo "Ejecútalo con sudo." >&2; exit 1; }

# ---------------------------------------------------------------- cortafuegos
# Entrada cerrada salvo: Tailscale (interfaz tailscale0 y su UDP cifrado), ping y,
# solo hasta que cierres el paso final, SSH público. Se conserva la cadena
# InstanceServices de Oracle (protege el servicio de metadatos).
write_firewall() {
  local public_ssh="$1"
  local orig=/etc/iptables/rules.v4.oracle
  [[ -f $orig || ! -f /etc/iptables/rules.v4 ]] || cp /etc/iptables/rules.v4 "$orig"
  {
    echo "# Generado por deploy/setup-server.sh (Jarvis). No editar a mano."
    echo "*filter"
    echo ":INPUT DROP [0:0]"
    echo ":FORWARD DROP [0:0]"
    echo ":OUTPUT ACCEPT [0:0]"
    [[ -f $orig ]] && grep -E '^:InstanceServices' "$orig" || true
    echo "-A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT"
    echo "-A INPUT -m conntrack --ctstate INVALID -j DROP"
    echo "-A INPUT -i lo -j ACCEPT"
    echo "-A INPUT -p icmp -j ACCEPT"
    echo "-A INPUT -i tailscale0 -j ACCEPT"
    echo "-A INPUT -p udp --dport 41641 -j ACCEPT"
    [[ $public_ssh == yes ]] && echo "-A INPUT -p tcp --dport 22 -m conntrack --ctstate NEW -m comment --comment jarvis-public-ssh -j ACCEPT"
    [[ -f $orig ]] && grep -E '^-A (OUTPUT|InstanceServices)' "$orig" || true
    echo "COMMIT"
  } > /etc/iptables/rules.v4
  cat > /etc/iptables/rules.v6 <<'V6'
# Generado por deploy/setup-server.sh (Jarvis). No editar a mano.
*filter
:INPUT DROP [0:0]
:FORWARD DROP [0:0]
:OUTPUT ACCEPT [0:0]
-A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
-A INPUT -i lo -j ACCEPT
-A INPUT -p ipv6-icmp -j ACCEPT
-A INPUT -i tailscale0 -j ACCEPT
-A INPUT -p udp --dport 41641 -j ACCEPT
COMMIT
V6
}

if [[ "${1:-}" == "--close-public-ssh" ]]; then
  say "Comprobando Tailscale antes de cerrar el SSH público"
  tailscale status --json | jq -e '.BackendState == "Running"' >/dev/null \
    || { echo "Tailscale no está conectado: no cierro nada para no dejarte fuera." >&2; exit 1; }
  if [[ -n "${SSH_CONNECTION:-}" ]]; then
    client_ip="${SSH_CONNECTION%% *}"
    [[ "$client_ip" == 100.* ]] || warn "Estás conectado por la IP pública ($client_ip). Esta sesión seguirá viva, pero las nuevas tendrán que ir por Tailscale."
  fi
  write_firewall no
  touch /etc/jarvis-public-ssh-closed
  while iptables -C INPUT -p tcp --dport 22 -m conntrack --ctstate NEW -m comment --comment jarvis-public-ssh -j ACCEPT 2>/dev/null; do
    iptables -D INPUT -p tcp --dport 22 -m conntrack --ctstate NEW -m comment --comment jarvis-public-ssh -j ACCEPT
  done
  say "SSH público cerrado. Entra con: ssh ubuntu@$TS_HOSTNAME"
  warn "Quita también la regla de entrada del puerto 22 en Oracle: Networking → VCN → Security List → Ingress Rules."
  exit 0
fi

# ---------------------------------------------------------------- sistema
say "Actualizando el sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install ca-certificates curl git jq gnupg unattended-upgrades iptables-persistent netfilter-persistent

say "Actualizaciones de seguridad automáticas (reinicio a las 04:30 si hace falta)"
cat > /etc/apt/apt.conf.d/52jarvis-unattended <<'UU'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
UU
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'AU'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
AU
timedatectl set-timezone Europe/Madrid || true

say "Cortafuegos: todo cerrado salvo Tailscale (y SSH público mientras configuramos)"
if [[ -f /etc/jarvis-public-ssh-closed ]]; then write_firewall no; else write_firewall yes; fi
if ! systemctl is-active --quiet docker; then
  netfilter-persistent reload
else
  warn "Docker ya está en marcha: las reglas nuevas se aplicarán en el próximo reinicio."
fi

say "SSH: solo con clave, sin root"
cat > /etc/ssh/sshd_config.d/10-jarvis.conf <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
SSHD
sshd -t && systemctl reload ssh

# ---------------------------------------------------------------- Docker
if ! command -v docker >/dev/null; then
  say "Instalando Docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if [[ ! -f /etc/docker/daemon.json ]]; then
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'DJ'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true
}
DJ
  systemctl restart docker 2>/dev/null || true
fi
systemctl enable --now docker

# ---------------------------------------------------------------- Tailscale
if ! command -v tailscale >/dev/null; then
  say "Instalando Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled
if ! tailscale status --json 2>/dev/null | jq -e '.BackendState == "Running"' >/dev/null; then
  say "Conectando a tu red de Tailscale"
  if [[ -n "${TS_AUTHKEY:-}" ]]; then
    tailscale up --hostname="$TS_HOSTNAME" --authkey="$TS_AUTHKEY"
  else
    echo "Abre el enlace que aparece abajo e inicia sesión con tu cuenta de Tailscale:"
    tailscale up --hostname="$TS_HOSTNAME"
  fi
fi
TS_DNS="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
PUBLIC_URL="https://$TS_DNS"
say "Este servidor en Tailscale: $TS_DNS"

# ---------------------------------------------------------------- carpetas y código
say "Carpetas en $JARVIS_HOME"
id jarvis >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/jarvis --shell /usr/sbin/nologin jarvis
install -d -m 755 "$JARVIS_HOME"
install -d -m 700 -o root -g root "$JARVIS_HOME/config"
install -d -m 755 -o jarvis -g jarvis "$JARVIS_HOME/app"
for d in data vault backups downloads syncthing; do install -d -m 750 -o 1000 -g 1000 "$JARVIS_HOME/$d"; done
chmod 700 "$JARVIS_HOME/backups"
git config --system --get-all safe.directory 2>/dev/null | grep -qx "$JARVIS_HOME/app" \
  || git config --system --add safe.directory "$JARVIS_HOME/app"

if [[ ! -d "$JARVIS_HOME/app/.git" ]]; then
  say "Clave de despliegue (solo lectura) para bajar el código de GitHub"
  sudo -u jarvis mkdir -p -m 700 /home/jarvis/.ssh
  [[ -f /home/jarvis/.ssh/id_ed25519 ]] || sudo -u jarvis ssh-keygen -q -t ed25519 -N "" -C "jarvis-oracle-deploy" -f /home/jarvis/.ssh/id_ed25519
  sudo -u jarvis sh -c 'ssh-keyscan -t ed25519 github.com > ~/.ssh/known_hosts 2>/dev/null'
  if ! sudo -u jarvis git ls-remote "$GIT_REPO" >/dev/null 2>&1; then
    warn "GitHub aún no conoce la clave de este servidor. Añádela (sin marcar «Allow write access») en:"
    echo "  https://github.com/jlclosada/second-brain/settings/keys/new"
    echo "  Título: jarvis-oracle"
    echo "  Clave:  $(cat /home/jarvis/.ssh/id_ed25519.pub)"
    echo
    echo "Después vuelve a ejecutar: sudo bash setup-server.sh"
    exit 2
  fi
  sudo -u jarvis git clone --quiet --branch "$DEPLOY_BRANCH" "$GIT_REPO" "$JARVIS_HOME/app"
fi
ln -sf "$JARVIS_HOME/app/deploy/jarvis" /usr/local/bin/jarvis

# ---------------------------------------------------------------- configuración y secretos
umask 077
if [[ ! -f "$JARVIS_HOME/config/compose.env" ]]; then
  say "Generando contraseña de la base de datos"
  cat > "$JARVIS_HOME/config/compose.env" <<CE
# Secretos del servidor. No se suben a ningún sitio.
POSTGRES_PASSWORD=$(openssl rand -hex 32)
DEPLOY_BRANCH=$DEPLOY_BRANCH
CE
fi
if [[ ! -f "$JARVIS_HOME/config/jarvis.env" ]]; then
  cp "$JARVIS_HOME/app/deploy/jarvis.env.example" "$JARVIS_HOME/config/jarvis.env"
  sed -i "s|^APP_PASSWORD=.*|APP_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=')|" "$JARVIS_HOME/config/jarvis.env"
  warn "Creado $JARVIS_HOME/config/jarvis.env desde la plantilla. Si migras desde el Mac, deploy/migrate-from-mac.sh lo sustituye por tu .env."
fi
if grep -q '^PUBLIC_URL=' "$JARVIS_HOME/config/jarvis.env"; then
  sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=$PUBLIC_URL|" "$JARVIS_HOME/config/jarvis.env"
else
  echo "PUBLIC_URL=$PUBLIC_URL" >> "$JARVIS_HOME/config/jarvis.env"
fi
chmod 600 "$JARVIS_HOME"/config/*.env
umask 022

# ---------------------------------------------------------------- copias nocturnas
say "Copia de seguridad cada noche a las 03:30"
install -m 644 "$JARVIS_HOME/app/deploy/systemd/jarvis-backup.service" /etc/systemd/system/
install -m 644 "$JARVIS_HOME/app/deploy/systemd/jarvis-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now jarvis-backup.timer

# ---------------------------------------------------------------- arrancar
say "Construyendo y arrancando Jarvis (la primera vez tarda unos minutos)"
jarvis up

say "Publicando Jarvis con HTTPS solo dentro de tu Tailscale"
tailscale serve --bg --https=443 http://127.0.0.1:8000

bash "$JARVIS_HOME/app/deploy/syncthing-setup.sh" || warn "Syncthing no se pudo configurar todavía; vuelve a lanzar deploy/syncthing-setup.sh."

cat <<FIN

  ✅ Jarvis está en marcha en $PUBLIC_URL
     (solo se abre desde tus dispositivos con Tailscale)

  Siguientes pasos:
   1. Migrar tus datos desde el Mac:   ./deploy/migrate-from-mac.sh $TS_HOSTNAME   (en el Mac)
   2. Cerrar el SSH público:           sudo bash $JARVIS_HOME/app/deploy/setup-server.sh --close-public-ssh
   3. En Google Cloud, añade este URI de redirección a tu cliente OAuth:
        $PUBLIC_URL/api/integrations/google/callback
FIN
