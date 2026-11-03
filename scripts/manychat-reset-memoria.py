#!/usr/bin/env python3
"""
Bot de comprobantes (ManyChat): borra la "memoria" de pedidos viejos para que en una recompra no se confunda.

El flujo del bot agrega la orden guardada en el contacto al mensaje que lee la IA ("<orden>#1067</orden>") y la
IA arrastra la conversación anterior (conversation_id). Si un cliente vuelve a comprar meses después, el bot le
habla de la orden vieja (2-nov-2026: pasó varias veces en recompras, Juampi lo pidió).

Cada hora (launchd com.mateando.manychat-reset): a los contactos cuya última orden en la planilla de comprobantes
quedó paga ("ok") hace más de 15 días (Juampi: 24 h era poco) y no tienen nada más nuevo, se les borran conversation_id, notif_orden,
notif_valor y em_orden, y se les saca la etiqueta "Notificación Transferencia". Se acuerda a quién limpió (y por
qué orden) en ~/.claude/manychat-reset-state.json para no repetir.

Token: MANYCHAT_COMP_TOKEN en ~/.claude/.manychat. Planilla: service account ~/.claude/.mateando-credentials.json.
Flags: --dry (no toca nada), --dias N (ventana de órdenes a mirar, default 60), --espera N (días después del pago, default 15).
"""

import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

import gspread

COMPROBANTES = "1UpKb4hhNDZFrNoxH2kIIBXIWBnHStHVflHJ1RKrvXYo"
API = "https://api.manychat.com"
CAMPOS = {13958682: "conversation_id", 13399897: "notif_orden", 13399895: "notif_valor", 13249357: "em_orden"}
TAG_NOTIF = 69078159  # "Notificación Transferencia"
STATE = Path.home() / ".claude/manychat-reset-state.json"

DRY = "--dry" in sys.argv
DIAS = int(sys.argv[sys.argv.index("--dias") + 1]) if "--dias" in sys.argv else 60
ESPERA = int(sys.argv[sys.argv.index("--espera") + 1]) if "--espera" in sys.argv else 15


def token() -> str:
    txt = (Path.home() / ".claude/.manychat").read_text()
    return dict(re.findall(r'^\s*(?:export\s+)?(\w+)=["\']?([^"\'\n]+)', txt, re.M))["MANYCHAT_COMP_TOKEN"]


def llamar(tok: str, ruta: str, body: dict) -> bool:
    req = urllib.request.Request(API + ruta, data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    for intento in range(3):
        try:
            return json.load(urllib.request.urlopen(req, timeout=20)).get("status") == "success"
        except urllib.error.HTTPError as e:
            if e.code == 429:  # límite de la API: esperar y reintentar
                time.sleep(5 * (intento + 1))
                continue
            return False
        except Exception:
            time.sleep(2)
    return False


def fecha(v: str) -> date | None:
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(v.strip()[:10], fmt).date()
        except ValueError:
            pass
    return None


def main():
    gc = gspread.service_account(filename=str(Path.home() / ".claude/.mateando-credentials.json"))
    filas = gc.open_by_key(COMPROBANTES).worksheet("Datos Manychat").get_all_values()
    hoy = date.today()

    # Por contacto: la fila más nueva (fecha, orden, pagada)
    ultima: dict[str, tuple[date, str, bool]] = {}
    for f in filas[1:]:
        if len(f) < 10:
            continue
        sid = (re.search(r"/chat/(\d+)", f[8]) or [None, None])[1]
        d = fecha(f[0])
        if not sid or not d or d < hoy - timedelta(days=DIAS):
            continue
        actual = (d, f[1].strip(), f[9].strip().lower() == "ok")
        if sid not in ultima or d >= ultima[sid][0]:
            ultima[sid] = actual

    estado = json.loads(STATE.read_text()) if STATE.exists() else {}
    pendientes = [(sid, orden) for sid, (d, orden, pagada) in ultima.items()
                  if pagada and d <= hoy - timedelta(days=ESPERA) and estado.get(sid) != orden]
    print(time.strftime("%Y-%m-%d %H:%M"), f"{len(pendientes)} contactos para limpiar" + (" (prueba, no se toca nada)" if DRY else ""),
          flush=True)
    if DRY:
        return

    tok = token()
    hechos = 0
    for sid, orden in pendientes:
        ok = all(llamar(tok, "/fb/subscriber/setCustomField", {"subscriber_id": int(sid), "field_id": fid, "field_value": None})
                 for fid in CAMPOS)
        llamar(tok, "/fb/subscriber/removeTag", {"subscriber_id": int(sid), "tag_id": TAG_NOTIF})  # puede no tenerla
        if ok:
            estado[sid] = orden
            hechos += 1
            if hechos % 50 == 0:
                STATE.write_text(json.dumps(estado))
        time.sleep(0.2)
    STATE.write_text(json.dumps(estado))
    print(time.strftime("%Y-%m-%d %H:%M"), f"Limpios: {hechos} de {len(pendientes)}", flush=True)


if __name__ == "__main__":
    main()
