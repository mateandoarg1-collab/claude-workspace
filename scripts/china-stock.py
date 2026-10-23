# Stock y ventas de los productos chinos (container sep-2026), todos los canales.
# Uso:
#   python3 scripts/china-stock.py <export-empretienda.xlsx> [otro-export.xlsx ...] [extra.json]
# (si se pasan varios Excel, se unen sin repetir pedidos: sirve cuando el último export no arranca el 1/9)
# - Empretienda (web) y Local ("Acordar") salen del Excel exportado de Empretienda.
# - MeLi y stock Full salen en vivo de la API (token vía ~/.claude/scripts/ml-token.sh).
# - Shopify (solo pagados) y Mayorista (planilla MATEANDO MAYORISTA 2026) van en extra.json:
#   {"Shop": {"Termo 1 L|Rosa": [sep, oct], ...}, "May": {...}}
# Los kits se desarman en piezas: Set 1 L = Termo 1 L + Mate; Set 750 = Termo 750 + Mate.
import collections, json, re, subprocess, sys, time, urllib.error, urllib.request
from datetime import datetime, timedelta, timezone

import openpyxl

LLEGARON = {
    ('Autocebante', 'Negro'): 4500, ('Autocebante', 'Rosa'): 1500, ('Autocebante', 'Blanco'): 500,
    ('Termo 1 L', 'Negro'): 500, ('Termo 1 L', 'Rosa'): 4500, ('Termo 1 L', 'Beige'): 1500, ('Termo 1 L', 'Blanco'): 500,
    ('Termo 750', 'Negro'): 1000, ('Termo 750', 'Rosa'): 1500, ('Termo 750', 'Beige'): 700, ('Termo 750', 'Blanco'): 500,
    ('Mate Acero 236', 'Negro'): 500, ('Mate Acero 236', 'Rosa'): 1000, ('Mate Acero 236', 'Beige'): 600, ('Mate Acero 236', 'Blanco'): 500,
}
FAMILIAS = {  # family_id de MeLi → piezas que lleva
    6990630313309266: ['Autocebante'], 1127462538336336: ['Mate Acero 236'],
    7376544667388880: ['Termo 1 L', 'Mate Acero 236'], 5506649408378769: ['Termo 750', 'Mate Acero 236'],
    6585242783220880: ['Termo 1 L'], 3923350767025297: ['Termo 750'],
}
FULL = {  # publicación de MeLi en Full por producto y color
    'Autocebante': {'Negro': 'MLA2562034074', 'Rosa': 'MLA3974929628', 'Blanco': 'MLA3974809178'},
    'Termo 1 L': {'Negro': 'MLA2562099492', 'Rosa': 'MLA2562190470', 'Beige': 'MLA4010391580', 'Blanco': 'MLA1580171259'},
    'Termo 750': {'Negro': 'MLA1580170603', 'Rosa': 'MLA1580183657', 'Beige': 'MLA2101246099', 'Blanco': 'MLA1580158225'},
    'Set 1 L': {'Negro': 'MLA2120704729', 'Rosa': 'MLA2120716985', 'Beige': 'MLA2120704727', 'Blanco': 'MLA2120693129'},
    'Set 750': {'Negro': 'MLA3988529826', 'Rosa': 'MLA3988388754', 'Beige': 'MLA3988542778', 'Blanco': 'MLA3988517444'},
    'Mate Acero 236': {'Negro': 'MLA2121021715', 'Rosa': 'MLA3988928818', 'Beige': 'MLA3988928820', 'Blanco': 'MLA2121021713'},
}
DESDE = '2026-09-01'


def color(s):
    for pat, c in [(r'ROS', 'Rosa'), (r'BEIGE', 'Beige'), (r'BLANC', 'Blanco'), (r'NEGR|BLACK', 'Negro')]:
        if re.search(pat, s or '', re.I):
            return c
    return '?'


def empretienda(paths, ventas):
    por_pedido = {}
    for path in paths:
        for r in list(openpyxl.load_workbook(path, read_only=True).active.iter_rows(values_only=True))[1:]:
            por_pedido[r[0]] = r
    rows = sorted(por_pedido.values(), key=lambda r: datetime.strptime(r[1], '%d/%m/%y %H:%M'), reverse=True)
    revisar = collections.Counter()
    for r in rows:
        canal = 'Local' if r[7] == 'Acordar' else 'Empre'
        mes = r[1][3:5]
        for it in re.split(r',(?=\d+x )', r[38] or ''):
            m = re.match(r'(\d+)x (.+?)(?: \(([^()]*)\))? \(SKU: [^)]*\)\s*$', it.strip())
            if not m:
                continue
            q, n, var = int(m.group(1)), m.group(2).upper(), (m.group(3) or '').upper()
            vc = re.search(r'COLOR: (\w+)', var)
            vc = color(vc.group(1)) if vc else '?'
            out = []
            if 'AUTOCEBANTE' in n:
                out = [('Autocebante', color(n))]
            elif re.match(r'KIT MATERO MATEANDO - TERMO (1 L|750)', n):
                c = color(n)
                out = [('Termo 1 L' if '1 L' in n else 'Termo 750', c), ('Mate Acero 236', c)]
            elif re.search(r'KIT MATERO (CAPRI|TOTE) TERMO Y MATE (ACERO )?BEIGE', n):
                out = [('Termo 1 L', 'Beige'), ('Mate Acero 236', 'Beige')]
            elif re.search(r'KIT MATERO (CAPRI|TOTE) TERMO Y MATE ROSE', n):
                out = [('Termo 1 L', 'Rosa')]  # el mate es ranchero, no chino
            elif re.search(r'TERMO (\w+ )?MATEANDO', n) and 'SET' in n:  # sets con mate ranchero: solo el termo
                tam = 'Termo 750' if '750' in n else 'Termo 1 L'
                if 'VACA RANCHERO BLACK' in n:
                    c = 'Negro'
                else:
                    c = color(re.search(r'TERMO (.*)', n).group(1))
                    if c == '?':
                        c = color(n)
                    if c == '?' and tam == 'Termo 750' and 'BOMBILLA PICO LORO' in n:
                        c = 'Blanco'
                out = [(tam, c)]
            elif 'TERMO MATEANDO CLASSIC 1' in n:
                out = [('Termo 1 L', color(n))]
            elif 'TERMO MATEANDO SLIM 750' in n:
                out = [('Termo 750', color(n))]
            elif 'FLOW DE ACERO TERMICO 236' in n:
                out = [('Mate Acero 236', color(n) if color(n) != '?' else vc)]
            for k in out:
                ventas[k][(canal, mes)] += q
            if not out and re.search(r'TERMO|KIT MATERO|AUTOCEB|FLOW', n) and not re.search(
                    r'MEDIA MANIJA|SYSTEM|INDEPENDIENTE|TAPAMATE|CANASTA|RÚSTICO', n):
                revisar[n] += q
    return rows[-1][1], rows[0][1], revisar


def ml_get(token, path):
    req = urllib.request.Request('https://api.mercadolibre.com' + path, headers={'Authorization': 'Bearer ' + token})
    for intento in range(6):
        try:
            return json.load(urllib.request.urlopen(req))
        except urllib.error.HTTPError as e:
            if e.code != 429 or intento == 5:
                raise
            time.sleep(2 ** intento)  # MeLi limita pedidos por minuto: esperar y reintentar


def meli(token, ventas):
    hoy = datetime.now(timezone(timedelta(hours=-3))).date()
    orders, a = [], datetime.fromisoformat(DESDE).date()
    while a <= hoy:  # tramos de 10 días para no pasar el límite de offset
        b = min(a + timedelta(days=9), hoy)
        off = 0
        while True:
            d = ml_get(token, f'/orders/search?seller=1136055893&order.date_created.from={a}T00:00:00.000-03:00'
                              f'&order.date_created.to={b}T23:59:59.999-03:00&sort=date_desc&limit=50&offset={off}')
            orders += d['results']
            if len(d['results']) < 50:
                break
            off += 50
        a = b + timedelta(days=1)
    orders = [o for o in orders if o['status'] in ('paid', 'confirmed')]
    ids = sorted({it['item']['id'] for o in orders for it in o['order_items']})
    meta = {}
    for i in range(0, len(ids), 20):
        for r in ml_get(token, '/items?ids=' + ','.join(ids[i:i + 20]) + '&attributes=id,family_id,attributes'):
            b = r.get('body') or {}
            meta[b.get('id')] = (b.get('family_id'), next((x['value_name'] for x in b.get('attributes') or [] if x['id'] == 'COLOR'), None))
    for o in orders:
        for it in o['order_items']:
            fam, c = meta.get(it['item']['id'], (None, None))
            if fam not in FAMILIAS:
                continue
            vc = next((x['value_name'] for x in it['item'].get('variation_attributes') or [] if x['id'] == 'COLOR'), None) or c
            for p in FAMILIAS[fam]:
                ventas[(p, color(vc))][('MeLi', o['date_created'][5:7])] += it['quantity']


def stock_full(token):
    ids = [i for d in FULL.values() for i in d.values()]
    inv = {}
    for k in range(0, len(ids), 20):
        for r in ml_get(token, '/items?ids=' + ','.join(ids[k:k + 20]) + '&attributes=id,inventory_id'):
            inv[r['body']['id']] = r['body']['inventory_id']
    crudo = {(p, c): ml_get(token, f'/inventories/{inv[i]}/stock/fulfillment')['available_quantity']
             for p, d in FULL.items() for c, i in d.items()}
    piezas = collections.Counter()
    for (p, c), q in crudo.items():
        if p == 'Set 1 L':
            piezas[('Termo 1 L', c)] += q; piezas[('Mate Acero 236', c)] += q
        elif p == 'Set 750':
            piezas[('Termo 750', c)] += q; piezas[('Mate Acero 236', c)] += q
        else:
            piezas[(p, c)] += q
    return crudo, piezas


def main():
    ventas = collections.defaultdict(collections.Counter)
    excels = [a for a in sys.argv[1:] if a.endswith('.xlsx')]
    extras = [a for a in sys.argv[1:] if a.endswith('.json')]
    desde, hasta, revisar = empretienda(excels, ventas)
    for extra in extras:
        for canal, items in json.load(open(extra)).items():
            for k, (sep, oct_) in items.items():
                p, c = k.split('|')
                ventas[(p, c)][(canal, '09')] += sep
                ventas[(p, c)][(canal, '10')] += oct_
    token = subprocess.check_output(['bash', f"{__import__('os').path.expanduser('~')}/.claude/scripts/ml-token.sh"], text=True).strip()
    meli(token, ventas)
    crudo, full = stock_full(token)

    hoy = datetime.now(timezone(timedelta(hours=-3)))
    dias_oct = hoy.day
    canales = collections.Counter()
    for v in ventas.values():
        for (canal, _), q in v.items():
            canales[canal] += q
    oct_total = sum(q for v in ventas.values() for (_, m), q in v.items() if m == '10')
    print(f'Empretienda {desde} -> {hasta} | revisar: {revisar.most_common(5)}')
    print(json.dumps({'canales': canales, 'total': sum(canales.values()), 'por_dia_oct': round(oct_total / dias_oct, 1)}))
    print('item|color|vendidos|quedan|full|deposito|por_dia_oct')
    for k in sorted(LLEGARON, key=lambda k: -sum(ventas[k].values())):
        t = sum(ventas[k].values())
        o = sum(q for (_, m), q in ventas[k].items() if m == '10')
        q = LLEGARON[k] - t
        print(f'{k[0]}|{k[1]}|{t}|{q}|{full[k]}|{q - full[k]}|{o / dias_oct:.1f}')
    sin_color = {k: sum(v.values()) for k, v in ventas.items() if k[1] == '?'}
    print('sin color:', sin_color)
    print('full crudo:', {f'{p} {c}': q for (p, c), q in crudo.items()})


if __name__ == '__main__':
    main()
