# Jarvis 24/7 en Oracle Cloud (gratis)

Jarvis pasa de tu Mac a un servidor ARM de Oracle Cloud **Always Free** (4 núcleos, 24 GB de RAM,
hasta 200 GB de disco, 0 €). Queda encendido siempre y se abre desde el Mac y el móvil con
**Tailscale**, sin ningún puerto abierto a internet.

```
 Mac / móvil ──Tailscale (WireGuard cifrado)──▶ servidor "jarvis"
                                                 ├─ tailscale serve  https://jarvis.<tu-red>.ts.net → 127.0.0.1:8000
                                                 ├─ app + worker + Postgres (Docker, reinicio automático)
                                                 ├─ Syncthing: vault de Obsidian ⇄ Mac, copias → Mac
                                                 └─ copia de seguridad cada noche (03:30)
```

## Qué hay en esta carpeta

| Archivo | Para qué |
|---|---|
| `setup-server.sh` | Prepara el servidor desde cero: actualizaciones automáticas, cortafuegos, SSH solo con clave, Docker, Tailscale, código, secretos, copias nocturnas y arranque. Se puede repetir. |
| `docker-compose.prod.yml` | Los servicios en producción: nada expuesto en la IP pública, contraseña de base de datos aleatoria, registros con rotación, `restart: unless-stopped`. |
| `jarvis` | El comando del servidor: `jarvis status`, `logs`, `update`, `rollback`, `backup`, `restore`… |
| `migrate-from-mac.sh` | Se ejecuta en el Mac: empareja Syncthing, copia base de datos, documentos, clave de cifrado y `.env`, y apaga Jarvis en el Mac. |
| `syncthing-setup.sh` | Configura Syncthing en el servidor (lo llama `migrate-from-mac.sh`). |
| `jarvis.env.example` | Plantilla de configuración si empiezas sin migrar. |

## Lo que tienes que hacer tú (unos 15 minutos)

### 1. Cuenta de Oracle Cloud

1. Entra en <https://signup.cloud.oracle.com> y crea la cuenta. Pide una tarjeta solo para comprobar
   que eres tú; no cobra nada mientras uses recursos Always Free.
2. **Región de inicio:** elige **Spain Central (Madrid)**. No se puede cambiar después. Si al crear la
   máquina dice que no hay capacidad, Frankfurt suele tener más.
3. Recomendado: en *Billing → Upgrade and Manage Payment* pasa la cuenta a **Pay As You Go**. Sigue
   siendo gratis dentro de los límites Always Free, pero Oracle deja de reclamar máquinas «ociosas» y
   casi siempre hay capacidad para ARM. Crea a la vez un aviso de presupuesto de 1 € en
   *Billing → Budgets* para enterarte si algo se sale de lo gratuito.

### 2. Crear la máquina

*Menú → Compute → Instances → Create instance*

- **Name:** `jarvis`
- **Image:** Canonical Ubuntu **24.04** (la normal, no «Minimal»)
- **Shape:** *Ampere* → `VM.Standard.A1.Flex`, **4 OCPU y 24 GB** de memoria
- **Networking:** deja que cree una VCN nueva con subred pública y **asigna IPv4 pública** (solo se usa
  para la instalación; luego se cierra).
- **SSH keys:** *Paste public keys* y pega la clave que te preparo en el Mac
  (`~/.ssh/jarvis_oracle.pub`).
- **Boot volume:** marca *Specify a custom size* y pon **100 GB**.

Pulsa *Create*. Cuando esté en verde (*Running*), copia la **Public IP address**.

> Si sale *Out of capacity*, prueba otro *Availability domain* o vuelve a intentarlo más tarde.

### 3. Tailscale

En <https://login.tailscale.com/admin/dns> activa **MagicDNS** y **HTTPS Certificates**. Durante la
instalación te aparecerá un enlace para dar de alta el servidor en tu red: ábrelo e inicia sesión.

### 4. Clave de despliegue en GitHub

La instalación te dará una clave pública. Pégala en
<https://github.com/jlclosada/second-brain/settings/keys/new> con el título `jarvis-oracle` y **sin**
marcar *Allow write access*. Así el servidor solo puede leer el código.

El resto lo hago yo desde tu Mac. Si lo quieres hacer a mano, son estos pasos.

## Instalación (en el Mac)

```bash
cd ~/Code/second-brain
IP=<la IP pública de Oracle>
scp -i ~/.ssh/jarvis_oracle deploy/setup-server.sh ubuntu@$IP:
ssh -t -i ~/.ssh/jarvis_oracle ubuntu@$IP 'sudo DEPLOY_BRANCH=main bash setup-server.sh'
# (si pide la clave de GitHub, añádela y repite la última línea)
```

`DEPLOY_BRANCH` es la rama que sigue el servidor. Mientras los cambios no estén en `main`, usa la rama
más reciente que tenga esta carpeta `deploy/`; cuando se fusione, `jarvis update main`.

Añade esto a `~/.ssh/config` para entrar por Tailscale con `ssh jarvis`:

```
Host jarvis
  HostName jarvis
  User ubuntu
  IdentityFile ~/.ssh/jarvis_oracle
```

Migra tus datos y tu vault, y cierra el SSH público:

```bash
./deploy/migrate-from-mac.sh jarvis
ssh jarvis 'sudo bash /srv/jarvis/app/deploy/setup-server.sh --close-public-ssh'
```

Y en Oracle, *Networking → Virtual Cloud Networks → (tu VCN) → Security Lists → Default* → borra la
regla de entrada del puerto 22. A partir de aquí el servidor no tiene **ningún** puerto abierto a internet.

### Después de migrar

- **Dirección:** `https://jarvis.<tu-red>.ts.net` (la muestra `jarvis status`). En el móvil, con
  Tailscale activado, ábrela y usa *Añadir a pantalla de inicio*.
- **Google (Gmail y Calendar):** en Google Cloud → *APIs & Services → Credentials → tu cliente OAuth*
  añade el URI de redirección `https://jarvis.<tu-red>.ts.net/api/integrations/google/callback` y vuelve
  a conectar desde Ajustes → Conexiones.
- **Notificaciones push:** como cambia la dirección, actívalas otra vez en cada dispositivo.
- **Obsidian** sigue en tu Mac como siempre: Syncthing mantiene el vault igual en los dos lados. Lo que
  se borre o cambie se guarda 30 días en `.stversions` de cada lado.
- **Descargas:** el servidor no ve las Descargas del Mac, así que la ordenación automática queda
  apagada. Se puede activar sincronizando esa carpeta con Syncthing y poniendo `DOWNLOADS_DIR=/downloads`
  en `/srv/jarvis/config/jarvis.env`.

## Día a día

```bash
ssh jarvis
jarvis status              # servicios, salud, versión, dirección, última copia, disco
jarvis logs app            # registros en vivo
jarvis update              # copia + último código de la rama + reconstruir + arrancar
jarvis update otra-rama    # probar otra rama (queda como rama por defecto)
jarvis rollback            # volver a la versión anterior
jarvis backup              # copia ahora
jarvis cli reset-password  # si olvidas la contraseña
```

## Copias de seguridad

- Cada noche a las 03:30 (`jarvis-backup.timer`) y antes de cada `jarvis update`.
- En `/srv/jarvis/backups/<fecha>/`: `brain.dump` (base de datos), `data.tar.gz` (documentos y la clave
  `.secret_key` que descifra los tokens guardados) y `vault.tar.gz`. Se guardan las últimas 14.
- Syncthing las copia a tu Mac en `~/Backups/Jarvis`, así que hay siempre una copia fuera de Oracle.
  Esa carpeta contiene tus datos y tu clave: no la compartas.
- Restaurar: `jarvis restore /srv/jarvis/backups/<fecha>`.

## Seguridad

- **Sin puertos públicos.** Cortafuegos de entrada en *DROP* (IPv4 e IPv6) salvo Tailscale; la
  Security List de Oracle, sin reglas de entrada. La app escucha solo en `127.0.0.1`.
- **HTTPS** con certificado válido de Tailscale; cookies `Secure`.
- **SSH** solo con clave, sin root, sin contraseña, y solo por Tailscale tras el último paso.
- **Secretos fuera del repo:** `/srv/jarvis/config/*.env` con permisos `600`, propiedad de root. La
  contraseña de Postgres es aleatoria y la base de datos no tiene puertos.
- **Código de solo lectura:** el servidor baja el repo con una clave de despliegue sin permiso de escritura.
- **Actualizaciones de seguridad** automáticas con reinicio a las 04:30 si el núcleo lo necesita;
  Docker vuelve a levantar todo solo.
- **Syncthing** sin relays ni descubrimiento público: solo habla con tu Mac por Tailscale.
- Contenedores sin root (`brain`) y con `no-new-privileges`.

## Si algo falla

- **No abre la dirección:** comprueba que Tailscale está activo en ese dispositivo; en el servidor,
  `jarvis status` y `tailscale serve status`.
- **Me he quedado sin SSH:** en Oracle, *Instance → Console connection → Launch Cloud Shell connection*
  te da una consola del servidor sin red.
- **Syncthing:** la interfaz está solo en el servidor; ábrela con
  `ssh -L 8385:127.0.0.1:8384 jarvis` y entra en <http://localhost:8385>.
