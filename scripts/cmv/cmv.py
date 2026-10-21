"""CMV de un export "Listado de productos" de Métricas de Empretienda.

Uso: python3 cmv.py costos.json listado.xlsx [listado2.xlsx ...]
Imprime un JSON por archivo: facturación de productos, CMV de productos, packaging de despacho
(cartulina/packaging general + caja + cinta) y lo que no se pudo costear.
Reglas de equivalencia en reglas.py; costos por SKU en el JSON que arma empretienda-metricas.mjs.
"""
import json, re, sys
import openpyxl
import reglas

DESP = {'2X1': 'DESP-2X1', 'SET': 'DESP-SET', 'TERMO': 'DESP-TERMO', 'SIMPLE': 'DESP-SIMPLE'}
ES_MATE = ('MATE', 'DISC-MUU', 'DISC-COQ', 'DISC-IMP', 'DISC-GAL')


def despacho(nombre, comps):
    """Packaging de un envío: cada mate sin caja de regalo lleva el packaging general, y cada unidad una caja con cinta.
    El export viene por producto, no por pedido: se cuenta una caja por unidad (da un poco más alto que el real)."""
    mates = sum(c for s, c in comps if s.startswith(ES_MATE))
    caja_regalo = any(s == reglas.CAJA for s, _ in comps)
    ex = [('PACK-CUR-11018', mates)] if mates and not caja_regalo else []
    termo = any(s.startswith('TER') for s, _ in comps)
    if nombre.startswith('2X1'): caja = '2X1'
    elif any(s.startswith('MATE-KIT') for s, _ in comps) or (termo and (mates or len(comps) > 2)): caja = 'SET'
    elif termo: caja = 'TERMO'
    else: caja = 'SIMPLE'
    return ex + [(DESP[caja], 1)]


def calcular(costos, archivo):
    filas = list(openpyxl.load_workbook(archivo, read_only=True, data_only=True).active.iter_rows(values_only=True))[1:]
    out = {'facturacion': 0, 'cmv': 0, 'packaging': 0, 'unidades': 0, 'sin_regla': {}, 'sin_costo': {}}
    for fila in filas:
        p, _sku, var, q, vol = (list(fila) + [None] * 5)[:5]
        if not p or not q: continue
        nombre = re.sub(r'\s+', ' ', str(p).strip().upper())
        variante = str(var or '').upper()
        base, estado = reglas.resolver(nombre, variante)
        comps = (base or []) + reglas.extras(nombre, variante)
        out['facturacion'] += float(vol or 0)
        out['unidades'] += q
        if estado == 'nuevo':
            out['sin_regla'][nombre] = out['sin_regla'].get(nombre, 0) + q
        for lista, campo in ((comps, 'cmv'), (despacho(nombre, comps), 'packaging')):
            for s, c in lista:
                s = reglas.ALIAS.get(s, s)
                if s in costos: out[campo] += costos[s] * c * q
                else: out['sin_costo'][s] = out['sin_costo'].get(s, 0) + c * q
    for k in ('facturacion', 'cmv', 'packaging'): out[k] = round(out[k])
    return out


if __name__ == '__main__':
    costos = json.load(open(sys.argv[1]))
    print(json.dumps({a: calcular(costos, a) for a in sys.argv[2:]}, ensure_ascii=False))
