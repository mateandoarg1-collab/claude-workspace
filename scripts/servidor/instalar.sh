#!/bin/bash
# Arma el servidor del lector de Empretienda (Hetzner, Ubuntu 24.04) sobre el repo ya clonado en /root/claude-workspace.
# Se puede volver a correr. Ver README.md.
set -e
cd /root/claude-workspace

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

echo '*/30 * * * * root bash /root/claude-workspace/scripts/servidor/leer-metricas.sh >> /var/log/empretienda.log 2>&1' > /etc/cron.d/empretienda
cat > /etc/logrotate.d/empretienda <<'EOF'
/var/log/empretienda.log {
  weekly
  rotate 4
  compress
  missingok
}
EOF

# solo SSH con clave
ufw allow OpenSSH >/dev/null && ufw --force enable >/dev/null
echo 'PasswordAuthentication no' > /etc/ssh/sshd_config.d/10-solo-clave.conf
systemctl reload ssh
echo "Listo. Falta /root/mateando/sa.json y el inicio de sesión a mano (README.md)."
