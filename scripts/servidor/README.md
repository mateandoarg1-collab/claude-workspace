# Servidor del lector de Empretienda

Servidor propio que lee Métricas de Empretienda cada 30 min y actualiza la planilla que muestra /canales, sin depender
de la Mac. Hetzner Cloud, proyecto "mateando", servidor `mateando-bot` (CPX12, Nuremberg, Ubuntu 24.04), IP `2.31.117.93`.

- Entrar: `ssh -i ~/.ssh/mateando_server root@2.31.117.93` (la clave está en la Mac de Juampi).
- Repo en `/root/claude-workspace`; antes de cada lectura se pone igual a `origin/main`, así los cambios llegan solos.
- Navegador con perfil propio en `/root/mateando/perfil`, en la pantalla virtual `:99` (servicio `pantalla`).
  Empretienda pide captcha para iniciar sesión, así que se inicia a mano una vez; después el perfil mantiene la sesión
  viva, igual que el bot de la Mac.
- Clave de Google (cuenta de servicio): `/root/mateando/sa.json`, la copia Juampi a mano.
- Lectura: `/etc/cron.d/empretienda` → `leer-metricas.sh` cada 30 min. Log: `/var/log/empretienda.log`.
- Armado desde cero: clonar el repo, `npm install`, `npm install --no-save playwright`,
  `npx playwright install --with-deps chromium`, `apt install python3-openpyxl xvfb x11vnc novnc websockify`,
  y `bash scripts/servidor/instalar.sh`.

## Iniciar sesión a mano (la primera vez, o si el log dice "Se cerró la sesión de Empretienda del servidor")

En el servidor:

```bash
systemctl start vnc novnc
cd /root/claude-workspace && DISPLAY=:99 EMPRETIENDA_PERFIL=/root/mateando/perfil flock /root/mateando/.navegador node scripts/servidor/login-empretienda.mjs
```

En la Mac, un túnel (noVNC solo escucha dentro del servidor):

```bash
ssh -i ~/.ssh/mateando_server -N -L 6080:127.0.0.1:6080 root@2.31.117.93
```

Abrir http://localhost:6080/vnc.html?autoconnect=1&resize=scale, iniciar sesión en Empretienda en esa ventana y
esperar a que aparezca Métricas: el script termina solo. Después `systemctl stop novnc vnc`.
