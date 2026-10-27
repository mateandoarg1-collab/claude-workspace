# Servidores de Empretienda

## DonWeb (principal, desde 27-oct-2026)

Lee Métricas cada 30 min y corre el tildador de comprobantes (mateandobot) cada 5 min, sin depender de la Mac.
Cloud Server de DonWeb (Rosario, 2 vCPU / 2 GB, Ubuntu 24.04, ID 6561125, ~$14.400/mes), IP `201.32.131.251`.
El firewall de Ualá (Imperva) no lo bloquea, a diferencia de Hetzner.

- Entrar: `ssh -i ~/.ssh/mateando_server -p 5175 root@201.32.131.251` (puerto 5175; solo con clave, sin contraseña).
- Repo en `/root/claude-workspace` (se pone igual a `origin/main` antes de cada lectura).
- Tildador en `/root/tildar_comprobantes` (copia del de la Mac, sin git) con su venv; claves `config.json`,
  `credentials.json`, `token.json` copiadas por Juampi. `auto.py` con `MATEANDO_SERVIDOR=1` no lee Métricas (lo hace
  el lector del panel) y deja las notificaciones en el log.
- Un solo perfil de Empretienda para los dos: `/root/tildar_profile`, en la pantalla virtual `:99` (servicio
  `pantalla`). Se turnan con el candado `/root/mateando/.navegador`. Clave de Google (cuenta de servicio) del lector:
  `/root/mateando/sa.json`.
- `/etc/cron.d/mateando`: `auto.py` cada 5 min → `/var/log/tildador.log`; `leer-metricas.sh` a los 7 y 37 →
  `/var/log/empretienda.log`.
- Si se cambia el tildador en la Mac (`~/Downloads/tildar_comprobantes`), copiarlo con
  `rsync -az -e "ssh -i ~/.ssh/mateando_server -p 5175" --exclude config.json --exclude 'credentials*.json' --exclude 'token*.json' --exclude venv --exclude __pycache__ ./ root@201.32.131.251:/root/tildar_comprobantes/`.
- El automático de la Mac quedó apagado (`~/Library/LaunchAgents/com.mateando.tildador.plist.desactivado`); la app
  mateandobot para usar a mano sigue igual.

## Hetzner (respaldo, a dar de baja)

`mateando-bot` (CPX12, Nuremberg), IP `2.31.117.93`, `ssh -i ~/.ssh/mateando_server root@2.31.117.93`. Imperva lo
bloquea para Métricas (`dashboard.empretienda.ar.ua.la` → 403; también Contabo y Cloudflare WARP), así que solo mantiene
viva una sesión y cada 30 min la sube al secreto `EMPRETIENDA_STATE` para que GitHub Actions
(`.github/workflows/empretienda.yml`) lea Métricas: `mantener-sesion.sh` con un token de GitHub de grano fino
(`/root/mateando/gh-token`). Queda de respaldo hasta confirmar DonWeb; después: deshabilitar el workflow y borrar el
servidor en la consola de Hetzner.

## Iniciar sesión a mano en Empretienda (la primera vez, o si el log dice que se cerró la sesión)

En el servidor (DonWeb: perfil `/root/tildar_profile`; Hetzner: `/root/mateando/perfil`):

```bash
systemctl start vnc novnc
cd /root/claude-workspace && DISPLAY=:99 EMPRETIENDA_PERFIL=/root/tildar_profile flock /root/mateando/.navegador node scripts/servidor/login-empretienda.mjs
```

En la Mac, un túnel (noVNC solo escucha dentro del servidor; en DonWeb agregar `-p 5175`):

```bash
ssh -i ~/.ssh/mateando_server -p 5175 -N -L 6080:127.0.0.1:6080 root@201.32.131.251
```

Abrir http://localhost:6080/vnc.html?autoconnect=1&resize=scale e iniciar sesión en Empretienda en esa ventana (pide
código por mail: tildar "Recordar este dispositivo por 30 días"). El script termina solo cuando aparece el panel.
Después `systemctl stop novnc vnc`.
