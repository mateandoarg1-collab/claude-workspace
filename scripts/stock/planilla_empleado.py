"""Arma en "Costos JP - meli" las pestañas para que un empleado revise a mano qué lleva cada publicación (pedido de Juampi
15-nov-2026): "Revisar MeLi" y "Revisar Tienda" (Empretienda online + local) + "Lista productos" (desplegable).
Cada fila viene precargada con la sugerencia de Claude (Stock Equivalencias); el empleado corrige Producto/Cant y tilda OK.
Después scripts/stock/importar_planilla_empleado.py pasa lo tildado a "Stock Equivalencias" (revisado = nombre del empleado).
Uso: python3 planilla_empleado.py   (no pisa una pestaña que ya existe: borrarla a mano para regenerar)
"""
import json, os, re
from google.oauth2 import service_account
from googleapiclient.discovery import build

ST = '1VP12eqQsJpZdOA6crIUMZccqpPobVZzxc8jev2iUkF8'
N = 5  # productos por publicación
cred = service_account.Credentials.from_service_account_file(os.path.expanduser('~/.claude/.mateando-credentials.json'), scopes=['https://www.googleapis.com/auth/spreadsheets'])
sh = build('sheets', 'v4', credentials=cred).spreadsheets()
get = lambda r: sh.values().get(spreadsheetId=ST, range=r).execute().get('values', [])
cat = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'tmp', 'catalogo.json')))
nombre = {s: re.sub(r'\s+', ' ', str(n)).strip() for s, n in cat}
opcion = lambda s: f'{s} · {nombre.get(s, "?")}'
eq = [(r + [''] * 10)[:10] for r in get("'Stock Equivalencias'!A2:J")]
meli = {x['k']: x for x in json.load(open(os.path.join(os.path.dirname(__file__), '..', 'tmp', 'meli-items.json')))}

def comps(skus):
    out = []
    for p in str(skus).split('+'):
        m = re.match(r'^\s*(\S+?)\s*(?:\*\s*(\d+))?\s*$', p)
        if m and m.group(1) != '-': out.append((m.group(1).upper(), int(m.group(2) or 1)))
    return out

hojas = {h['properties']['title']: h['properties']['sheetId'] for h in sh.get(spreadsheetId=ST, fields='sheets.properties').execute()['sheets']}
def nueva(t, filas, cols):
    if t in hojas: print('ya existe', t); return None
    r = sh.batchUpdate(spreadsheetId=ST, body={'requests': [{'addSheet': {'properties': {'title': t, 'gridProperties': {'rowCount': len(filas) + 5, 'columnCount': cols, 'frozenRowCount': 2}}}}]}).execute()
    sid = r['replies'][0]['addSheet']['properties']['sheetId']; hojas[t] = sid
    sh.values().update(spreadsheetId=ST, range=f"'{t}'!A1", valueInputOption='USER_ENTERED', body={'values': filas}).execute()
    return sid

# Lista para el desplegable
lista = [['Producto (SKU · nombre del Excel)']] + [[opcion(s)] for s, _ in cat]
nueva('Lista productos', [['Desplegable de las pestañas Revisar MeLi / Revisar Tienda. Se arma sola desde las pestañas de categoría.']] + lista, 1)

AYUDA_T = ('INSTRUCCIONES TIENDA: cada fila es una publicación de Empretienda. En Producto/Cant va SOLO lo que lleva SIEMPRE una venta '
         '(ej: "Set Matero" = mate + termo + bombilla + canasta + yerbera). NO pongas lo que el cliente elige en las opciones (columna '
         '"Opciones que elige el cliente": bombilla SÍ/NO, caja de regalo SÍ/NO, bolsa SÍ/NO, personalizado SÍ/NO): eso el sistema lo suma solo en cada venta según lo que eligió. '
         'Si el título dice "+ bombilla" y no hay opción de bombilla, la bombilla SÍ va. Ya viene cargado lo que sugirió Claude: corregí lo que esté mal (desplegable) y tildá OK. '
         'Amarillas = Claude no estaba seguro. Si no descuenta nada, escribí "NADA" en Producto 1. Si falta un producto en el desplegable, anotalo en Comentario.')
AYUDA = ('INSTRUCCIONES MELI: cada fila es una publicación (o variante de color) de Mercado Libre; en MeLi no hay opciones, cada publicación lleva siempre lo mismo. En Producto/Cant va lo que se descuenta del depósito cuando se vende UNA '
         '(mate, bombilla, caja de regalo, yerbera, "PERS-LAS-11017 · PERSONALIZADO" si va grabado…). Ya viene cargado lo que sugirió Claude: '
         'corregí lo que esté mal (elegí del desplegable) y tildá OK. Filas amarillas = Claude no estaba seguro. Si no descuenta nada, escribí "NADA" en Producto 1. '
         'Si falta un producto en el desplegable, anotalo en Comentario.')
prod_cols = [h for i in range(1, N + 1) for h in (f'Producto {i}', f'Cant {i}')]

def armar(t, filas_eq, encabezado, datos, ayuda=None):
    filas = [[ayuda or AYUDA], encabezado + prod_cols + ['OK', 'Comentario']]
    dud = []
    for i, e in enumerate(filas_eq):
        c = comps(e[3])[:N]
        celdas = [x for s, q in c for x in (opcion(s), q)] + [''] * (2 * (N - len(c)))
        filas.append(datos(e) + celdas + [False, ''])
        if e[6] == 'SI' or not e[3]: dud.append(i + 2)
    sid = nueva(t, filas, len(filas[1]))
    if sid is None: return
    nd = len(encabezado); tot = len(filas[1]); n = len(filas)
    req = [{'mergeCells': {'range': {'sheetId': sid, 'startRowIndex': 0, 'endRowIndex': 1, 'startColumnIndex': 0, 'endColumnIndex': tot}}},
           {'repeatCell': {'range': {'sheetId': sid, 'startRowIndex': 0, 'endRowIndex': 1}, 'cell': {'userEnteredFormat': {'wrapStrategy': 'WRAP', 'backgroundColor': {'red': .89, 'green': .94, 'blue': .9}}}, 'fields': 'userEnteredFormat(wrapStrategy,backgroundColor)'}},
           {'updateDimensionProperties': {'range': {'sheetId': sid, 'dimension': 'ROWS', 'startIndex': 0, 'endIndex': 1}, 'properties': {'pixelSize': 70}, 'fields': 'pixelSize'}},
           {'repeatCell': {'range': {'sheetId': sid, 'startRowIndex': 1, 'endRowIndex': 2}, 'cell': {'userEnteredFormat': {'textFormat': {'bold': True}}}, 'fields': 'userEnteredFormat.textFormat'}},
           {'setDataValidation': {'range': {'sheetId': sid, 'startRowIndex': 2, 'endRowIndex': n, 'startColumnIndex': tot - 2, 'endColumnIndex': tot - 1}, 'rule': {'condition': {'type': 'BOOLEAN'}}}}]
    for i in range(N):
        col = nd + 2 * i
        req.append({'setDataValidation': {'range': {'sheetId': sid, 'startRowIndex': 2, 'endRowIndex': n, 'startColumnIndex': col, 'endColumnIndex': col + 1},
                    'rule': {'condition': {'type': 'ONE_OF_RANGE', 'values': [{'userEnteredValue': "='Lista productos'!A3:A"}]}, 'strict': False, 'showCustomUi': True}}})
        req.append({'updateDimensionProperties': {'range': {'sheetId': sid, 'dimension': 'COLUMNS', 'startIndex': col, 'endIndex': col + 1}, 'properties': {'pixelSize': 230}, 'fields': 'pixelSize'}})
        req.append({'updateDimensionProperties': {'range': {'sheetId': sid, 'dimension': 'COLUMNS', 'startIndex': col + 1, 'endIndex': col + 2}, 'properties': {'pixelSize': 50}, 'fields': 'pixelSize'}})
    for r in dud:
        req.append({'repeatCell': {'range': {'sheetId': sid, 'startRowIndex': r, 'endRowIndex': r + 1, 'startColumnIndex': 0, 'endColumnIndex': nd}, 'cell': {'userEnteredFormat': {'backgroundColor': {'red': 1, 'green': .95, 'blue': .75}}}, 'fields': 'userEnteredFormat.backgroundColor'}})
    sh.batchUpdate(spreadsheetId=ST, body={'requests': req}).execute()
    return sid

# MeLi: foto | publicación | variante | link | vendidas 90 días | clave (no tocar)
fm = sorted([e for e in eq if e[0] == 'MeLi'], key=lambda e: -int(e[7] or 0))
def dm(e):
    x = meli.get(e[1], {})
    foto = e[8]
    return [f'=IMAGE("{foto}")' if foto else '', x.get('titulo', e[2]) + ('' if x.get('estado', 'active') == 'active' else ' [pausada]'), x.get('detalle', ''),
            f'=HYPERLINK("{e[9]}";"ver")' if e[9] else '', int(e[7] or 0), e[1]]
sid = armar('Revisar MeLi', fm, ['Foto', 'Publicación', 'Variante', 'Link', 'Vendidas 90 días', 'Código (no tocar)'], dm)
if sid is not None:
    sh.batchUpdate(spreadsheetId=ST, body={'requests': [
        {'updateDimensionProperties': {'range': {'sheetId': sid, 'dimension': 'ROWS', 'startIndex': 2, 'endIndex': len(fm) + 2}, 'properties': {'pixelSize': 60}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sid, 'dimension': 'COLUMNS', 'startIndex': 0, 'endIndex': 1}, 'properties': {'pixelSize': 70}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sid, 'dimension': 'COLUMNS', 'startIndex': 1, 'endIndex': 2}, 'properties': {'pixelSize': 380}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sid, 'dimension': 'COLUMNS', 'startIndex': 2, 'endIndex': 3}, 'properties': {'pixelSize': 220}, 'fields': 'pixelSize'}}]}).execute()

# Tienda: publicación | variante | vendidas 90 días | clave
ft = sorted([e for e in eq if e[0] == 'Tienda'], key=lambda e: -int(e[7] or 0))
import sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'cmv'))
from piezas_orden import clave, EXTRA
NOMBRE_OP = lambda k: 'Caja de regalo' if k.startswith('CAJA') else 'Bombilla' if k == 'BOMBILLA' else 'Bolsa' if k.startswith('BOLSA') else 'Personalizado (grabado)' if 'PERSONALIZAD' in k else k.title()
opciones = {}
for l in json.load(open(os.path.join(os.path.dirname(__file__), '..', 'tmp', 'emp-lineas.json'))):
    ks = opciones.setdefault(clave(l['n'], l['v']), set())
    for o in (l['v'] or '').split('|'):
        k = o.partition(':')[0].strip().upper()
        if k and EXTRA.search(k): ks.add(NOMBRE_OP(k))
def dt(e):
    n, _, v = e[2].partition(' — ')
    return [n, v, ', '.join(sorted(opciones.get(e[1], []))) or '—', int(e[7] or 0), e[1]]
sid = armar('Revisar Tienda', ft, ['Publicación', 'Variante', 'Opciones que elige el cliente (NO cargarlas)', 'Vendidas 90 días', 'Código (no tocar)'], dt, AYUDA_T)
if sid is not None:
    sh.batchUpdate(spreadsheetId=ST, body={'requests': [
        {'updateDimensionProperties': {'range': {'sheetId': sid, 'dimension': 'COLUMNS', 'startIndex': 0, 'endIndex': 1}, 'properties': {'pixelSize': 380}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {'range': {'sheetId': sid, 'dimension': 'COLUMNS', 'startIndex': 1, 'endIndex': 2}, 'properties': {'pixelSize': 220}, 'fields': 'pixelSize'}}]}).execute()
print('MeLi', len(fm), 'Tienda', len(ft), 'sheetIds', hojas.get('Revisar MeLi'), hojas.get('Revisar Tienda'))
