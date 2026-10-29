#!/usr/bin/env python3
"""Mail de aviso a Juampi desde el servidor (con el Gmail del tildador, /root/tildar_comprobantes/config.json).
Uso: avisar.py <clave> <asunto> <texto>. Manda como mucho un mail por clave cada 12 h (/root/mateando/.avisos.json).
Lo usa leer-metricas.sh cuando se cierra la sesión de Empretienda del servidor."""
import json, smtplib, sys, time
from email.message import EmailMessage
from pathlib import Path

clave, asunto, texto = sys.argv[1:4]
estado = Path('/root/mateando/.avisos.json')
enviados = json.loads(estado.read_text()) if estado.exists() else {}
if time.time() - enviados.get(clave, 0) < 12 * 3600:
    sys.exit(0)
cfg = json.loads(Path('/root/tildar_comprobantes/config.json').read_text())
usuario = (cfg.get('gmail_user') or 'mateandoarg1@gmail.com').strip()
msg = EmailMessage()
msg['Subject'], msg['From'], msg['To'] = asunto, usuario, 'jpcipolletta@mateando.com'
msg.set_content(texto + '\n\n— Servidor de Mateando (DonWeb)')
with smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=30) as s:
    s.login(usuario, (cfg.get('gmail_app_password') or '').replace(' ', ''))
    s.send_message(msg)
enviados[clave] = time.time()
estado.write_text(json.dumps(enviados))
print(f'Aviso por mail: {asunto}')
