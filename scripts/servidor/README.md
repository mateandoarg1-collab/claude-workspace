# Servidor de la sesión de Empretienda

Mantiene viva la sesión de Empretienda las 24 h y se la pasa cada 30 min a GitHub Actions
(`.github/workflows/empretienda.yml`), que es el que lee Métricas y actualiza /canales. Reemplaza a la Mac en ese papel:
la Mac se duerme y la copia de la sesión que usa GitHub vence a las ~6 h.

El servidor no lee Métricas él mismo: el firewall de Ualá (Imperva, `dashboard.empretienda.ar.ua.la`) bloquea a
Hetzner (también a Contabo y a Cloudflare WARP; probado 27-oct-2026). El panel y el login de Empretienda sí funcionan.

- Hetzner Cloud, proyecto "mateando", servidor `mateando-bot` (CPX12, Nuremberg, Ubuntu 24.04), IP `2.31.117.93`.
- Entrar: `ssh -i ~/.ssh/mateando_server root@2.31.117.93` (la clave está en la Mac de Juampi).
- Repo en `/root/claude-workspace`; antes de cada vuelta se pone igual a `origin/main`, así los cambios llegan solos.
- Navegador con perfil propio en `/root/mateando/perfil`, en la pantalla virtual `:99` (servicio `pantalla`).
  Empretienda pide captcha para iniciar sesión, así que se inicia a mano una vez; después el perfil la mantiene viva.
- Token de GitHub de grano fino, solo para este repo, con permisos Secrets y Actions (lectura y escritura):
  `/root/mateando/gh-token`, lo carga Juampi a mano.
- `/etc/cron.d/empretienda` → `mantener-sesion.sh` cada 30 min: abre el panel, sube la sesión al secreto
  `EMPRETIENDA_STATE` y relanza el lector de GitHub si se cortó su cadena. Log: `/var/log/empretienda.log`.
- Armado desde cero: clonar el repo, `npm install`, `npm install --no-save playwright`,
  `npx playwright install --with-deps chromium`, `apt install gh xvfb x11vnc novnc websockify`,
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

Abrir http://localhost:6080/vnc.html?autoconnect=1&resize=scale e iniciar sesión en Empretienda en esa ventana (pide
código por mail: tildar "Recordar este dispositivo por 30 días"). El script termina solo cuando aparece el panel.
Después `systemctl stop novnc vnc`.
