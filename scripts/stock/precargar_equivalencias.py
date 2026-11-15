"""Precarga (una vez, 15-nov-2026) la pestaña "Stock Equivalencias" de Costos JP con TODAS las publicaciones de cada canal
y el SKU que sugiere sugerir.py (o las reglas del CMV para Tienda/Local). Juampi las revisa una por una en
mateando-stock.vercel.app → Equivalencias. No pisa filas que ya existen (las cargadas a mano se marcan revisadas).
Entradas en scripts/tmp/: meli-items.json, mayo-pedidos.json, emp-lineas.json, shopify-variantes.json, catalogo.json.
"""
import json, os, re, sys, datetime, collections
sys.path.insert(0, os.path.dirname(__file__)); sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'cmv'))
from sugerir import sugerir, norm
import reglas
from google.oauth2 import service_account
from googleapiclient.discovery import build

T = lambda f: os.path.join(os.path.dirname(__file__), '..', 'tmp', f)
ST = '1VP12eqQsJpZdOA6crIUMZccqpPobVZzxc8jev2iUkF8'
TAB = 'Stock Equivalencias'
COLS = ['canal', 'clave', 'descripcion', 'skus', 'actualizado', 'revisado', 'dudoso', 'ventas90', 'foto', 'link']
HOY = datetime.date(2026, 11, 15)
DESDE = (HOY - datetime.timedelta(days=90)).isoformat()
cat = {s for s, _ in json.load(open(T('catalogo.json')))}
ALIAS = {'BOMB-ACE-12002': 'BOMB-ACE-12001', 'ACCE-ALM-10008': 'ACCE-ALM-10009', 'ACCE-KIT-10009': 'ACCE-KIT-10010'}
filas = []


def fila(canal, clave, desc, skus, dudoso, ventas, foto='', link=''):
    skus = [s for s in skus if s]
    ok = all(re.sub(r'\*\d+$', '', s) in cat or s == '-' for s in skus)
    filas.append([canal, clave, desc, ' + '.join(skus) if ok else '', '', '', 'SI' if (dudoso or not skus or not ok) else '', ventas, foto, link])


# MeLi: activas + las que vendieron en 90 días (sin Full: Full no sale del depósito)
for x in json.load(open(T('meli-items.json'))):
    if x['estado'] != 'active' and not x['v90']:
        continue
    s, d = sugerir(x['titulo'], x['detalle'])
    desc = x['titulo'] + (f" — {x['detalle']}" if x['detalle'] else '') + ('' if x['estado'] == 'active' else ' [pausada]')
    fila('MeLi', x['k'], desc, s, d, x['v90'], x['foto'].replace('http://', 'https://'), x['link'])

# Tienda (Empretienda online + local): nombre | variante sin las opciones que suman extras (bombilla, caja, bolsa, grabado)
EXTRA = re.compile(r'BOMBILLA|CAJA|BOLSA|PERSONALIZAD|GRABAD|NOMBRE|TEXTO|FRASE|DEDICATORIA')
def var_base(v):
    ops = [o.strip() for o in (v or '').split('|') if o.strip()]
    return ' | '.join(o for o in ops if not EXTRA.search(o.split(':')[0].upper()))
tienda = collections.OrderedDict()
for l in json.load(open(T('emp-lineas.json'))):
    k = f"{l['n'].strip().upper()}|{var_base(l['v']).upper()}"
    e = tienda.setdefault(k, {'n': l['n'], 'v': l['v'], 'vb': var_base(l['v']), 'q': 0})
    if l['dia'] >= DESDE: e['q'] += l['q']
for k, e in tienda.items():
    try:
        base, estado = reglas.resolver(e['n'].upper(), e['vb'].upper())
    except Exception:
        base, estado = None, 'FALTA'
    if base and estado != 'nuevo':
        s = [ALIAS.get(a, a) + (f'*{c}' if c != 1 else '') for a, c in base if not a.startswith(('PERS-', 'DESP-'))]
        d = False
    else:
        s, d = sugerir(e['n'], e['vb'])
        s = [x for x in s if not x.startswith(('PERS-', 'PACK-CAJ-11003'))]  # caja/grabado los suma la variante
    fila('Tienda', k, e['n'] + (f" — {e['vb']}" if e['vb'] else ''), s, d, e['q'])

# Shopify: combos y variantes sin SKU del catálogo (los SKU sueltos ya se traducen solos)
for sku, titulo, var in json.load(open(T('shopify-variantes.json'))):
    desc = titulo + (f' — {var}' if var else '')
    s, d = sugerir(titulo, var)
    fila('Shopify', sku or desc, desc, s, d, 0)

# Mayorista: lo pedido en 90 días (App Pedidos ya trae lo migrado del Excel)
mayo = collections.Counter()
for f in json.load(open(T('mayo-pedidos.json'))):
    if len(f) < 6 or not f[0] or str(f[2])[:10] < DESDE or (len(f) > 19 and f[19] == 'SI') or (len(f) > 13 and f[13] == 'Presupuesto'):
        continue
    try: items = json.loads(f[5] or '[]')
    except Exception: continue
    for it in items:
        mayo[' | '.join(x for x in [it.get('nombre'), it.get('color')] if x)] += int(it.get('cant') or 0)
for k, q in mayo.most_common():
    if not k.strip(): continue
    s, d = sugerir(k)
    fila('Mayorista', k, k, s, d, q)

cred = service_account.Credentials.from_service_account_file(os.path.expanduser('~/.claude/.mateando-credentials.json'), scopes=['https://www.googleapis.com/auth/spreadsheets'])
sh = build('sheets', 'v4', credentials=cred).spreadsheets()
prev = sh.values().get(spreadsheetId=ST, range=f"'{TAB}'!A2:J").execute().get('values', [])
hechas = {}
for r in prev:
    r = (r + [''] * 10)[:10]
    if not r[5]: r[5] = f'Juampi {r[4]}'  # cargadas a mano antes de la revisión
    hechas[f'{r[0]}|{r[1]}'] = r
nuevas = [f for f in filas if f'{f[0]}|{f[1]}' not in hechas]
# completar ventas/foto de las ya cargadas
idx = {f'{f[0]}|{f[1]}': f for f in filas}
for k, r in hechas.items():
    if k in idx:
        r[7], r[8], r[9] = idx[k][7], idx[k][8], idx[k][9]
todas = list(hechas.values()) + sorted(nuevas, key=lambda f: (['MeLi', 'Tienda', 'Shopify', 'Mayorista'].index(f[0]), -int(f[7] or 0)))
if '--dry' in sys.argv:
    c = collections.Counter((f[0], bool(f[3]), f[6]) for f in todas); print(c); sys.exit()
sh.values().update(spreadsheetId=ST, range=f"'{TAB}'!A1", valueInputOption='RAW', body={'values': [COLS] + todas}).execute()
print('filas', len(todas), collections.Counter(f[0] for f in todas), 'sin sugerencia', sum(1 for f in todas if not f[3]), 'dudosas', sum(1 for f in todas if f[6]))
