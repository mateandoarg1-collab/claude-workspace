"""Pasa a "Stock Equivalencias" las filas tildadas OK de las pestañas "Revisar MeLi" y "Revisar Tienda" de Costos JP
(las completa un empleado a mano, ver planilla_empleado.py). revisado = "<quien> (planilla)".
Uso: python3 importar_planilla_empleado.py "Nombre del empleado" [--dry]
"""
import os, re, sys, datetime
from google.oauth2 import service_account
from googleapiclient.discovery import build

ST = '1VP12eqQsJpZdOA6crIUMZccqpPobVZzxc8jev2iUkF8'
quien = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else sys.exit('Falta el nombre del empleado')
cred = service_account.Credentials.from_service_account_file(os.path.expanduser('~/.claude/.mateando-credentials.json'), scopes=['https://www.googleapis.com/auth/spreadsheets'])
sh = build('sheets', 'v4', credentials=cred).spreadsheets()
get = lambda r: sh.values().get(spreadsheetId=ST, range=r, valueRenderOption='UNFORMATTED_VALUE').execute().get('values', [])
cat = {str(r[0]).split(' · ')[0].strip().upper() for r in get("'Lista productos'!A3:A") if r}
ahora = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=3)).strftime('%Y-%m-%d %H:%M')
eq = get("'Stock Equivalencias'!A2:G")
pos = {f'{r[0]}|{r[1]}': i + 2 for i, r in enumerate(eq) if len(r) > 1}
updates, problemas = [], []
for tab, canal in (('Revisar MeLi', 'MeLi'), ('Revisar Tienda', 'Tienda')):
    filas = get(f"'{tab}'!A2:Z")
    enc = filas[0]; ci = enc.index('Código (no tocar)'); ok = enc.index('OK'); p1 = enc.index('Producto 1')
    for n, f in enumerate(filas[1:], start=3):
        f = f + [''] * (len(enc) - len(f))
        if f[ok] is not True: continue
        partes, mal = [], False
        if str(f[p1]).strip().upper() == 'NADA': skus = '-'
        else:
            for i in range(p1, ok, 2):
                sku = str(f[i]).split(' · ')[0].strip().upper()
                if not sku: continue
                if sku not in cat: problemas.append(f'{tab} fila {n}: no conozco "{f[i]}"'); mal = True; break
                try: c = int(f[i + 1] or 1)
                except Exception: c = 1
                partes.append(sku if c == 1 else f'{sku}*{c}')
            if mal: continue
            if not partes: problemas.append(f'{tab} fila {n}: tildada OK sin productos'); continue
            skus = ' + '.join(partes)
        k = f'{canal}|{f[ci]}'
        if k not in pos: problemas.append(f'{tab} fila {n}: código desconocido'); continue
        updates.append({'range': f"'Stock Equivalencias'!D{pos[k]}:G{pos[k]}", 'values': [[skus, ahora, f'{quien} (planilla) {ahora}', '']]})
print(len(updates), 'filas OK para pasar'); print('\n'.join(problemas))
if updates and '--dry' not in sys.argv:
    sh.values().batchUpdate(spreadsheetId=ST, body={'valueInputOption': 'RAW', 'data': updates}).execute(); print('Pasadas a Stock Equivalencias')
