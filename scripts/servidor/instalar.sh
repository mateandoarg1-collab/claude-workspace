#!/bin/bash
# Arma el servidor de DonWeb (Ubuntu 24.04) que corre el tildador y el lector de Métricas, sobre el repo ya clonado en
# /root/claude-workspace y el tildador copiado en /root/tildar_comprobantes (con su venv). Se puede volver a correr.
# Ver README.md.
set -e
cd /root/claude-workspace
mkdir -p /root/mateando /root/Downloads && chmod 700 /root/mateando

# pantalla virtual donde corre el navegador; VNC y noVNC solo escuchan en el propio servidor (se entra por túnel SSH)
cat > /etc/systemd/system/pantalla.service <<'EOF'
[Unit]
Description=Pantalla virtual :99 para el navegador de Empretienda
[Service]
ExecStart=/usr/bin/Xvfb :99 -screen 0 1280x900x24 -nolisten tcp
Restart=always
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/vnc.service <<'EOF'
[Unit]
Description=VNC de la pantalla :99 (solo localhost)
After=pantalla.service
[Service]
ExecStart=/usr/bin/x11vnc -display :99 -localhost -nopw -forever -shared -quiet
Restart=on-failure
EOF
cat > /etc/systemd/system/novnc.service <<'EOF'
[Unit]
Description=noVNC en 127.0.0.1:6080 (solo por túnel SSH)
After=vnc.service
[Service]
ExecStart=/usr/bin/websockify --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900
Restart=on-failure
EOF
systemctl daemon-reload
systemctl enable --now pantalla.service

# Tildador cada 5 min y Métricas a los 7 y 37: comparten el perfil de Empretienda y se turnan con el candado
cat > /etc/cron.d/mateando <<'EOF'
# Tildador de comprobantes (cada 5 min) y lectura de Métricas de Empretienda (cada 30 min). Comparten el perfil de
# Empretienda (/root/tildar_profile): se turnan con el candado /root/mateando/.navegador.
*/5 * * * * root cd /root/tildar_comprobantes && DISPLAY=:99 MATEANDO_SERVIDOR=1 flock -w 600 /root/mateando/.navegador venv/bin/python auto.py >> /var/log/tildador.log 2>&1
7,37 * * * * root bash /root/claude-workspace/scripts/servidor/leer-metricas.sh >> /var/log/empretienda.log 2>&1
EOF
cat > /etc/logrotate.d/mateando <<'EOF'
/var/log/tildador.log /var/log/empretienda.log {
  weekly
  rotate 4
  compress
  missingok
}
EOF

# solo SSH con clave, en el puerto que asignó DonWeb
ufw allow 5175/tcp >/dev/null && ufw --force enable >/dev/null
echo 'PasswordAuthentication no' > /etc/ssh/sshd_config.d/10-solo-clave.conf
systemctl reload ssh
echo "Listo. Falta copiar las claves y el inicio de sesión a mano en Empretienda (README.md)."
