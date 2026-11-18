"""CMV de un export "Listado de productos" de Métricas de Empretienda.

Uso: python3 cmv.py costos.json listado.xlsx [listado2.xlsx ...]
Imprime un JSON por archivo: facturación de productos, CMV de productos, packaging de despacho
(cartulina por mate + caja de despacho, sin cinta) y lo que no se pudo costear.
Reglas de equivalencia en reglas.py; costos por SKU en el JSON que arma empretienda-metricas.mjs.
"""
import json, re, sys
import openpyxl
import reglas

DESP = {'2X1': 'DESP-2X1', 'SET': 'DESP-SET', 'TERMO': 'DESP-TERMO', 'SIMPLE': 'DESP-SIMPLE'}
ES_MATE = ('MATE', 'DISC-MUU', 'DISC-COQ', 'DISC-IMP', 'DISC-GAL')
# Packaging (Juampi, 18-nov-2026), costos del Excel Costos JP, sin cinta:
#  - cada mate sin caja de regalo lleva la cartulina; con caja de regalo (o BOX) va la caja y no la cartulina.
#  - una caja de cartón corrugado por pedido (Empretienda y MeLi), del tamaño que pida lo que lleva.
#  - una calco por pedido en todos los canales. Local: bolsa chica, o grande si lleva kit, matera, mochila o termo.
CARTULINA, CALCO, BOLSA_CHICA, BOLSA_GRANDE = 'PACK-PAC-11006', 'PACK-CAL-11015', 'PACK-BOL-11002', 'PACK-BOL-11001'
CAJA_DESPACHO = {'DESP-SIMPLE': 'PACK-CAR-11009', 'DESP-2X1': 'PACK-CAR-11010', 'DESP-TERMO': 'PACK-CAR-11011', 'DESP-SET': 'PACK-CAR-11011'}
EMPAQUE = (CARTULINA, CALCO, 'PACK-CUR-11018')
GRANDE = ('CANA-', 'BOLS-', 'MOCHI-', 'TER-', 'STAN-', 'MATE-KIT', 'AUTO-', 'PAVA-')


def packaging_excel(costos):
    """Las cajas de despacho valen lo que dice el Excel (PACK-CAR-*), sin cinta."""
    for desp, caja in CAJA_DESPACHO.items():
        c = costos.get(caja, costos.get(caja.upper()))
        if c: costos[desp] = c
    return costos


def bolsa_local(comps):
    return BOLSA_GRANDE if any(str(s).upper().startswith(GRANDE) for s, _ in comps) else BOLSA_CHICA


def despacho(nombre, comps):
    """Packaging de un envío: cada mate sin caja de regalo lleva la cartulina, y cada unidad una caja de despacho
    (el tamaño según el producto). El lector lo pasa a una caja por pedido."""
    mates = sum(c for s, c in comps if s.startswith(ES_MATE))
    caja_regalo = any(s == reglas.CAJA for s, _ in comps)
    ex = [(CARTULINA, mates)] if mates and not caja_regalo else []
    termo = any(s.startswith('TER') for s, _ in comps)
    if nombre.startswith('2X1'): caja = '2X1'
    elif any(s.startswith('MATE-KIT') for s, _ in comps) or (termo and (mates or len(comps) > 2)): caja = 'SET'
    elif termo: caja = 'TERMO'
    elif caja_regalo or mates > 1: caja = '2X1'  # la caja de regalo entra en la caja de 2x1
    else: caja = 'SIMPLE'
    return ex + [(DESP[caja], 1)]


def calcular(costos, archivo):
    filas = list(openpyxl.load_workbook(archivo, read_only=True, data_only=True).active.iter_rows(values_only=True))[1:]
    # packaging = empaque (por mate) + despacho (cajas). El listado viene por producto: las cajas se cuentan por unidad
    # (despacho, despacho_u) y el lector las pasa a una por pedido con la cantidad de ventas de Métricas.
    out = {'facturacion': 0, 'cmv': 0, 'packaging': 0, 'empaque': 0, 'despacho': 0, 'despacho_u': 0, 'unidades': 0,
           'sin_regla': {}, 'sin_costo': {}, 'skus': {}}  # skus: unidades por SKU (kits desarmados) para el % de falla
    # costo a mano por producto (/rentabilidad-tienda/costos): reemplaza el de sus SKUs; variante y packaging se suman igual
    manuales = costos.get('_productos', {})
    for fila in filas:
        p, _sku, var, q, vol = (list(fila) + [None] * 5)[:5]
        if not p or not q: continue
        nombre = re.sub(r'\s+', ' ', str(p).strip().upper())
        variante = str(var or '').upper()
        if nombre in manuales:
            try:
                base, _ = reglas.resolver(nombre, variante)
            except (TypeError, ValueError):
                base = None
            extras = reglas.extras(nombre, variante)
            out['facturacion'] += float(vol or 0)
            out['unidades'] += q
            out['cmv'] += manuales[nombre] * q
            for s, c in extras + (despacho(nombre, (base or []) + extras) if base else [('DESP-SIMPLE', 1)]):
                s = reglas.ALIAS.get(s, s)
                campo = 'despacho' if s.startswith('DESP-') else 'empaque' if s in EMPAQUE else 'cmv'
                if campo == 'despacho': out['despacho_u'] += c * q
                out[campo] += costos.get(s, 0) * c * q
            continue
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
            campo = 'despacho' if s.startswith('DESP-') else 'empaque' if s in EMPAQUE else 'cmv'
            if campo == 'despacho': out['despacho_u'] += c * q
            if s in costos: out[campo] += costos[s] * c * q
            else: out['sin_costo'][s] = out['sin_costo'].get(s, 0) + c * q
    out['packaging'] = out['empaque'] + out['despacho']
    for k in ('facturacion', 'cmv', 'packaging', 'empaque', 'despacho'): out[k] = round(out[k])
    return out


if __name__ == '__main__':
    costos = packaging_excel(json.load(open(sys.argv[1])))
    print(json.dumps({a: calcular(costos, a) for a in sys.argv[2:]}, ensure_ascii=False))
