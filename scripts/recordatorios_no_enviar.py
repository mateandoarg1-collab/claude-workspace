#!/usr/bin/env python3
"""Órdenes que NO tienen que recibir el mail "Datos para la transferencia de tu compra".

Ese mail lo manda un Apps Script de Blas desde info@mateando.com, a los :10 y :40. Arranca del aviso de Empretienda
"Tienes una nueva orden … Estado del pago: Pendiente" y nunca se fija si la orden se pagó después. Ejemplo del
10-nov-2026, orden #207876: la orden entró 23:24, la pagó 23:25, el tildador la tildó 23:37 y el mail salió 23:40.

Este script corre en el servidor DonWeb cada 5 min y escribe la lista en la planilla
"Recordatorios transferencia - no enviar". El script de Blas la lee antes de mandar cada mail.

Motivos para entrar a la lista:
- pagada: el tildador la tildó (ok en ABONADAS o pagos_usados.json), al instante. También si Empretienda la marca
  pagada (emp_ordenes; se lee a los :07 y :37), que cubre lo tildado a mano.
- comprobante recibido: el cliente ya mandó el comprobante por WhatsApp (fila en "Datos Manychat"), aunque el pago
  todavía no esté verificado o esté en REVISAR. Esas órdenes las mira una persona, no un mail automático.
- cancelada: CANCELADA en ABONADAS.

Sin datos de clientes: solo número de orden, motivo y fecha.
Si falla cualquier fuente, no se escribe nada. Así F1 ("actualizado") queda vieja y el script de Blas deja de mandar:
mejor saltear un recordatorio que escribirle "no recibimos nada" a alguien que pagó.
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone

import gspread
from google.oauth2.service_account import Credentials

LISTA = "1HNGL0EGeMNnrQNqrw626UxrL6DP3VaWv9WOZN4q6Zvc"  # Recordatorios transferencia - no enviar
COMPROBANTES = "1UpKb4hhNDZFrNoxH2kIIBXIWBnHStHVflHJ1RKrvXYo"  # Excel de comprobantes (pestaña Datos Manychat)
MAYORISTA = "1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI"  # emp_ordenes (la escribe leer-metricas.sh)
SA = "/root/mateando/sa.json"
PAGOS_USADOS = "/root/tildar_comprobantes/pagos_usados.json"
PESTANA = "no_enviar"
DIAS = 20  # el script de Blas recuerda órdenes de los últimos días; con 20 sobra
AR = timezone(timedelta(hours=-3))
PRIORIDAD = {"pagada": 3, "cancelada": 2, "comprobante recibido": 1}


def numeros(texto: str) -> list[int]:
    """Números de orden escritos en la celda ("#207876", "207597 y 207598", "Orden: 207876")."""
    return [int(n) for n in re.findall(r"\d{4,7}", texto or "")]


def main() -> None:
    ahora = datetime.now(AR)
    desde = (ahora - timedelta(days=DIAS)).strftime("%Y-%m-%d")
    g = gspread.authorize(Credentials.from_service_account_file(SA, scopes=["https://www.googleapis.com/auth/spreadsheets"]))
    lista: dict[int, tuple[str, str]] = {}  # orden → (motivo, fecha)

    def sumar(orden: int, motivo: str, fecha: str) -> None:
        previo = lista.get(orden)
        if not previo or PRIORIDAD[motivo] > PRIORIDAD[previo[0]]:
            lista[orden] = (motivo, fecha or (previo[1] if previo else ""))

    # 1. Comprobantes recibidos por WhatsApp (A Fecha, B Número de Orden, J ABONADAS)
    dm = g.open_by_key(COMPROBANTES).worksheet("Datos Manychat")
    filas = dm.get_values("A2:J")
    if len(filas) < 50:
        raise SystemExit(f"Datos Manychat devolvió solo {len(filas)} filas: no se actualiza la lista")
    for f in filas:
        fecha = (f[0] if f else "").strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", fecha) and fecha < desde:
            continue
        abonadas = (f[9] if len(f) > 9 else "").strip().lower()
        motivo = "pagada" if abonadas == "ok" else "cancelada" if abonadas.startswith("cancelad") else "comprobante recibido"
        for n in numeros(f[1] if len(f) > 1 else ""):
            sumar(n, motivo, fecha)

    # 2. Lo que tildó el tildador (pago del banco → orden), por si la fila del Excel tiene otro número
    with open(PAGOS_USADOS) as fh:
        for orden in json.load(fh).values():
            for n in numeros(str(orden)):
                sumar(n, "pagada", "")

    # 3. Pagadas según Empretienda (B numero, C fecha UTC, F pago: 1 = pagada)
    emp = g.open_by_key(MAYORISTA).worksheet("emp_ordenes").get_values("B2:F")
    if not emp:
        raise SystemExit("emp_ordenes vacía: no se actualiza la lista")
    ultima_emp = ""
    for f in emp:
        if len(f) < 5 or not f[0].isdigit():
            continue
        try:
            fecha = datetime.fromisoformat(f[1].replace("Z", "+00:00")).astimezone(AR).strftime("%Y-%m-%d")
        except ValueError:
            fecha = ""
        ultima_emp = max(ultima_emp, f[1])
        if fecha and fecha < desde:
            continue
        if f[4].strip() == "1":
            sumar(int(f[0]), "pagada", fecha)

    filas_out = [[n, m, fe] for n, (m, fe) in sorted(lista.items(), reverse=True)]

    # 4. Escribir: primero la lista (pisando, sin vaciar antes, así nunca queda vacía), después lo que sobra, y al
    # final la hora. Si algo falla antes de la hora, F1 queda vieja y el script de Blas no manda.
    ss = g.open_by_key(LISTA)
    try:
        ws = ss.worksheet(PESTANA)
    except gspread.WorksheetNotFound:
        ws = ss.sheet1
        ws.update_title(PESTANA)
        ss.update_timezone("America/Argentina/Buenos_Aires")
    if ws.row_count < len(filas_out) + 50:
        ws.add_rows(len(filas_out) + 500 - ws.row_count)
    ws.update(range_name="A1", values=[["orden", "motivo", "fecha"]] + filas_out, value_input_option="RAW")
    ws.batch_clear([f"A{len(filas_out) + 2}:C"])
    ws.update(range_name="E1", value_input_option="RAW", values=[
        ["actualizado", ahora.isoformat(timespec="seconds")],
        ["órdenes", len(filas_out)],
        ["última orden leída de Empretienda", ultima_emp],
        ["", ""],
        ["La llena el servidor cada 5 min. No editar a mano.", ""],
    ])
    cuenta = {m: sum(1 for r in filas_out if r[1] == m) for m in PRIORIDAD}
    print(f"{ahora:%d/%m %H:%M} {len(filas_out)} órdenes {cuenta}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 — el log lo lee una persona; F1 queda vieja y Blas deja de mandar
        print(f"{datetime.now(AR):%d/%m %H:%M} ERROR {type(e).__name__}: {str(e)[:300]}", file=sys.stderr)
        sys.exit(1)
