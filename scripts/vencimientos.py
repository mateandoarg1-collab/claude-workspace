#!/usr/bin/env python3
"""Vencimientos de «Mateando Datos» → pestaña `vencimientos` de la planilla Egresos MP (la de Juampi), que muestra
/vencimientos.

Francisco manda lunes y jueves a jpcipolletta@mateando.com un mail con los vencimientos de la semana (e-Cheqs,
préstamos, tarjeta, planes AFIP, IVA) y cuánto transferir desde Mercado Pago a cada banco. Cada mail cubre solo los
próximos días, así que se juntan todos: cada obligación queda con lo que dijo el último mail que la nombró.

Corre en el servidor de DonWeb (cron, ver scripts/servidor/README.md). Lee la casilla por IMAP con la contraseña de
aplicación de /root/mateando/vencimientos.json y solo los mails de franmateando@gmail.com. Escribe con la cuenta de
servicio de /root/mateando/sa.json.
Uso: venv/bin/python scripts/vencimientos.py [--dry]
"""
import email
import imaplib
import json
import re
import sys
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime

from google.oauth2 import service_account
from googleapiclient.discovery import build

REMITENTE = "franmateando@gmail.com"
SPREADSHEET_ID = "1PST8KAomncOqwNMLM5C3vqSjRDxEViQX0o4fr_6YAVU"  # Egresos MP
TAB = "vencimientos"
CREDENCIALES = "/root/mateando/vencimientos.json"
SA = "/root/mateando/sa.json"

MONTO = r"\$\s*([\d.]+,\d{2})"
OBLIGACION = re.compile(r"^(\d{2})/(\d{2})\s+" + MONTO + r"\s+(.+?)\s+\[([^\]]+)\]")
TRANSFERENCIA = re.compile(r"^(\d{2})/(\d{2})\s+transferir\s+" + MONTO + r"\s+a\s+(\S+)\s+\((.*)\)")
DOLARES = re.compile(r"U\$S\s*([\d.,]+)")
VENCE_EL = re.compile(r"vence el (\d{2})/(\d{2})", re.I)


def monto(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


def numero(s: str) -> float:
    """Dólares de la tarjeta, que vienen en los dos formatos (766,02 · 766.02 · 1,361.37): el último separador seguido
    de 2 dígitos es el decimal."""
    s = s.strip(".,")
    if re.search(r"[.,]\d{2}$", s):
        return float(re.sub(r"[.,]", "", s[:-3]) + "." + s[-2:])
    return float(re.sub(r"[.,]", "", s))


def fecha(dia: str, mes: str, ref: date) -> str:
    """dd/mm del mail → AAAA-MM-DD, con el año del mail (o el de al lado si cruza fin de año)."""
    anio = ref.year + (1 if ref.month - int(mes) > 6 else -1 if int(mes) - ref.month > 6 else 0)
    return f"{anio}-{mes}-{dia}"


def tipo(detalle: str) -> str:
    d = detalle.lower()
    return ("cheque" if "cheq" in d else "impuestos" if re.search(r"afip|agip|arba|vep|\biva\b", d) else "tarjeta" if "tarjeta" in d
            else "prestamo" if "prestamo" in d or "préstamo" in d else "otro")


def clave(f: str, detalle: str) -> str:
    cheque = re.search(r"e-Cheq\s+(\d+)", detalle)
    plan = re.search(r"Plan (?:AFIP|AGIP) (\w+) — cuota ([\d/]+)", detalle)
    return cheque.group(1) if cheque else f"{plan.group(1)} {plan.group(2)}" if plan else f"{f} {detalle.lower()}"


def leer_mails() -> list[tuple[datetime, str]]:
    c = json.load(open(CREDENCIALES))
    m = imaplib.IMAP4_SSL("imap.gmail.com")
    m.login(c["usuario"], c["app_password"])
    m.select("INBOX", readonly=True)
    mails = []
    for i in m.search(None, f'FROM "{REMITENTE}"')[1][0].split():
        msg = email.message_from_bytes(m.fetch(i, "(BODY.PEEK[])")[1][0][1])
        texto = next((p.get_payload(decode=True).decode(p.get_content_charset() or "utf-8", "replace")
                      for p in msg.walk() if p.get_content_type() == "text/plain"), "")
        mails.append((parsedate_to_datetime(msg["Date"]), texto))
    m.logout()
    return sorted(mails)


def procesar(mails: list[tuple[datetime, str]]):
    obligaciones: dict[str, dict] = {}
    transferencias, recordatorios = [], {}
    for n, (cuando, texto) in enumerate(mails):
        ultimo = n == len(mails) - 1
        ref = cuando.date()
        seccion, anterior = "", None
        if ultimo:
            transferencias = []
        for linea in texto.splitlines():
            if linea and not linea.startswith(" "):
                seccion = linea.split("—")[0].strip().upper()
                continue
            l = linea.strip()
            if not l:
                continue
            if (t := TRANSFERENCIA.match(l)) and ultimo:
                transferencias.append({"fecha": fecha(t[1], t[2], ref), "monto": monto(t[3]), "cuenta": t[4], "detalle": t[5]})
            elif o := OBLIGACION.match(l):
                f, detalle, cuenta = fecha(o[1], o[2], ref), o[4].strip(), o[5].strip()
                anterior = obligaciones.setdefault(clave(f, detalle), {})
                anterior.update({"fecha": f, "detalle": detalle, "monto": monto(o[3]), "cuenta": cuenta,
                                 "seccion": seccion, "mail": ref.isoformat(), "tipo": tipo(detalle)})
            elif (d := DOLARES.search(l)) and anterior is not None:
                anterior["usd"] = numero(d[1])
            elif seccion.startswith("RECORDATORIO") and (v := VENCE_EL.search(l)):
                recordatorios[l] = {"fecha": fecha(v[1], v[2], ref), "detalle": l, "mail": ref.isoformat()}
            elif seccion.startswith("RECORDATORIO") and recordatorios:
                ult = list(recordatorios.values())[-1]
                ult["nota"] = (ult.get("nota", "") + " " + l).strip()
    ultimo_mail = mails[-1][0].date().isoformat() if mails else ""
    return obligaciones, transferencias, recordatorios, ultimo_mail


def main():
    mails = leer_mails()
    obligaciones, transferencias, recordatorios, ultimo_mail = procesar(mails)
    filas = [["clase", "fecha", "tipo", "detalle", "cuenta", "monto", "usd", "seccion", "mail", "en_ultimo_mail"]]
    for o in sorted(obligaciones.values(), key=lambda o: o["fecha"]):
        filas.append(["obligacion", o["fecha"], o["tipo"], o["detalle"], o["cuenta"], o["monto"], o.get("usd", ""),
                      o["seccion"], o["mail"], o["mail"] == ultimo_mail])
    for t in transferencias:
        filas.append(["transferencia", t["fecha"], "", t["detalle"], t["cuenta"], t["monto"], "", "", ultimo_mail, True])
    for r in sorted(recordatorios.values(), key=lambda r: r["fecha"]):
        filas.append(["recordatorio", r["fecha"], "", (r["detalle"] + " " + r.get("nota", "")).strip(), "", "", "", "",
                      r["mail"], r["mail"] == ultimo_mail])
    filas[0].append(datetime.now(timezone.utc).isoformat(timespec="seconds"))
    print(f"{len(mails)} mails · {len(obligaciones)} obligaciones · {len(transferencias)} transferencias · "
          f"{len(recordatorios)} recordatorios · último mail {ultimo_mail}")
    if "--dry" in sys.argv:
        for f in filas[-12:]:
            print(f)
        return
    creds = service_account.Credentials.from_service_account_file(SA, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    s = build("sheets", "v4", credentials=creds, cache_discovery=False).spreadsheets()
    if TAB not in [h["properties"]["title"] for h in s.get(spreadsheetId=SPREADSHEET_ID).execute()["sheets"]]:
        s.batchUpdate(spreadsheetId=SPREADSHEET_ID, body={"requests": [{"addSheet": {"properties": {"title": TAB}}}]}).execute()
    s.values().clear(spreadsheetId=SPREADSHEET_ID, range=f"'{TAB}'!A:Z").execute()
    s.values().update(spreadsheetId=SPREADSHEET_ID, range=f"'{TAB}'!A1", valueInputOption="RAW", body={"values": filas}).execute()


if __name__ == "__main__":
    main()
