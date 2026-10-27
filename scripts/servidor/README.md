# Servidor de Empretienda (DonWeb)

Lee Métricas cada 30 min y corre el tildador de comprobantes (mateandobot) cada 5 min, sin depender de la Mac.
Cloud Server de DonWeb (Rosario, 2 vCPU / 2 GB, Ubuntu 24.04, ID 6561125, ~$14.400/mes), IP `201.32.131.251`.

Por qué DonWeb: Métricas carga las ventas desde `dashboard.empretienda.ar.ua.la`, detrás del firewall de Ualá (Imperva),
que bloquea hostings como Hetzner, Contabo y Cloudflare WARP (403 "Incapsula", probado 27-oct-2026). El 27-oct se
probó Hetzner manteniendo la sesión para que GitHub Actions leyera Métricas; se dio de baja al andar DonWeb. El workflow
`.github/workflows/empretienda.yml` quedó deshabilitado.

- Entrar: `ssh -i ~/.ssh/mateando_server -p 5175 root@201.32.131.251` (puerto 5175; solo con clave, sin contraseña).
- Repo en `/root/claude-workspace` (se pone igual a `origin/main` antes de cada lectura).
- Tildador en `/root/tildar_comprobantes` (copia del de la Mac, sin git) con su venv (`playwright` igual versión que el
  del repo, `gspread`, `google-api-python-client`, `google-auth-oauthlib`, `openpyxl`, `pandas`). Claves `config.json`,
  `credentials.json`, `token.json` copiadas por Juampi. `auto.py` con `MATEANDO_SERVIDOR=1` no lee Métricas (lo hace el
  lector del panel) y manda las alertas (ESTAFA, revisar a mano, FALLÓ) por mail a jpcipolletta@mateando.com.
- Un solo perfil de Empretienda para los dos: `/root/tildar_profile`, en la pantalla virtual `:99` (servicio
  `pantalla`). Se turnan con el candado `/root/mateando/.navegador`. Clave de Google (cuenta de servicio) del lector:
  `/root/mateando/sa.json`.
- `/etc/cron.d/mateando`: `auto.py` cada 5 min → `/var/log/tildador.log`; `leer-metricas.sh` a los 7 y 37 →
  `/var/log/empretienda.log`; `scripts/vencimientos.py` a las 10:20 y 15:20 → `/var/log/vencimientos.log`.
- Vencimientos (/vencimientos): lee por IMAP solo los mails de franmateando@gmail.com («Mateando Datos») en
  jpcipolletta@mateando.com, con la contraseña de aplicación de Google del mail de Stock Full
  (`/root/mateando/vencimientos.json`, la copió Juampi) → pestaña `vencimientos` de la planilla Egresos MP.
- Si se cambia el tildador en la Mac (`~/Downloads/tildar_comprobantes`), copiarlo con
  `rsync -az -e "ssh -i ~/.ssh/mateando_server -p 5175" --exclude config.json --exclude 'credentials*.json' --exclude 'token*.json' --exclude venv --exclude __pycache__ ./ root@201.32.131.251:/root/tildar_comprobantes/`.
- El automático de la Mac quedó apagado (`~/Library/LaunchAgents/com.mateando.tildador.plist.desactivado`); la app
  mateandobot para usar a mano sigue igual.
- Armado desde cero: clonar el repo, `npm install`, `npm install --no-save playwright@<versión>`,
  `npx playwright install --with-deps chromium`, `apt install python3-venv xvfb x11vnc novnc websockify ufw`, copiar el
  tildador y armar su venv, y `bash scripts/servidor/instalar.sh`.

## Iniciar sesión a mano en Empretienda (la primera vez, o si llega un mail del tildador con FALLÓ por sesión)

En el servidor:

```bash
systemctl start vnc novnc
cd /root/claude-workspace && DISPLAY=:99 EMPRETIENDA_PERFIL=/root/tildar_profile flock /root/mateando/.navegador node scripts/servidor/login-empretienda.mjs
```

En la Mac, un túnel (noVNC solo escucha dentro del servidor):

```bash
ssh -i ~/.ssh/mateando_server -p 5175 -N -L 6080:127.0.0.1:6080 root@201.32.131.251
```

Abrir http://localhost:6080/vnc.html?autoconnect=1&resize=scale e iniciar sesión en Empretienda en esa ventana (pide
código por mail: tildar "Recordar este dispositivo por 30 días"). El script termina solo cuando aparece el panel.
Después `systemctl stop novnc vnc`.
