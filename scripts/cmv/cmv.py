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
    """Packaging de un envío: cada mate sin caja de regalo lleva el packaging general, y cada unidad una caja con cinta
    (el tamaño según el producto). El lector lo pasa a una caja por pedido."""
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
    # packaging = empaque (por mate) + despacho (cajas). El listado viene por producto: las cajas se cuentan por unidad
    # (despacho, despacho_u) y el lector las pasa a una por pedido con la cantidad de ventas de Métricas.
    out = {'facturacion': 0, 'cmv': 0, 'packaging': 0, 'empaque': 0, 'despacho': 0, 'despacho_u': 0, 'unidades': 0,
           'sin_regla': {}, 'sin_costo': {}, 'skus': {}}  # skus: unidades por SKU (kits desarmados) para el % de falla
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
        for s, c in comps:
            s = reglas.ALIAS.get(s, s)
            if not s.startswith(('PACK-', 'PERS-', 'DESP-')): out['skus'][s] = out['skus'].get(s, 0) + c * q
        for s, c in comps + despacho(nombre, comps):
            s = reglas.ALIAS.get(s, s)
            campo = 'despacho' if s.startswith('DESP-') else 'empaque' if s == 'PACK-CUR-11018' else 'cmv'
            if campo == 'despacho': out['despacho_u'] += c * q
            if s in costos: out[campo] += costos[s] * c * q
            else: out['sin_costo'][s] = out['sin_costo'].get(s, 0) + c * q
    out['packaging'] = out['empaque'] + out['despacho']
    for k in ('facturacion', 'cmv', 'packaging', 'empaque', 'despacho'): out[k] = round(out[k])
    return out


if __name__ == '__main__':
    costos = json.load(open(sys.argv[1]))
    print(json.dumps({a: calcular(costos, a) for a in sys.argv[2:]}, ensure_ascii=False))
