"""CMV y packaging por venta de Empretienda (para scripts/tienda-rentabilidad.mjs), con las mismas reglas que cmv.py.
Uso: python3 cmv_orden.py costos.json < ventas.json
ventas.json: [{"id": ..., "local": bool, "productos": [{"n": nombre, "v": "Opción: valor | ...", "q": cant}]}]
Imprime [{"id", "cmv", "empaque", "despacho", "sin_costo": unidades, "sin_regla": [nombres], "sin_costo_n": [nombres]}].
Costos cargados a mano por producto (/rentabilidad-tienda/costos): costos["_productos"] = {NOMBRE: costo sin IVA}. Reemplazan
el costo de los SKUs del producto, pero se siguen sumando lo que agrega la variante (bombilla, caja o bolsa de regalo) y el
packaging (con los componentes de la regla si la hay; si no, una caja de despacho simple).
Packaging (README): online, cada mate sin caja de regalo lleva el packaging general y la venta lleva UNA caja de
despacho (la más cara de las que pedirían sus productos); local (retiro), una bolsa por venta y sin caja.
"""
import json, re, sys
import reglas
from cmv import despacho

BOLSA_LOCAL = 'PACK-BOL-11001'


def calcular(costos, v):
    out = {'id': v['id'], 'cmv': 0, 'empaque': 0, 'despacho': 0, 'sin_costo': 0, 'sin_regla': [], 'sin_costo_n': []}
    cajas = []
    manuales = costos.get('_productos', {})
    for p in v['productos']:
        nombre, variante, q = str(p['n'] or '').upper(), str(p['v'] or '').upper(), p['q'] or 0
        manual = manuales.get(re.sub(r'\s+', ' ', nombre).strip())
        try:
            base, estado = reglas.resolver(nombre, variante)
        except (TypeError, ValueError):  # regla que necesita el color y la variante no lo dice
            base, estado = None, 'FALTA'
        extras = reglas.extras(nombre, variante)
        comps = (base or []) + extras
        if manual is not None:
            out['cmv'] += manual * q
            pack = despacho(nombre, comps) if base else [('DESP-SIMPLE', 1)]
            for s, c in extras + ([] if v['local'] else pack):
                s = reglas.ALIAS.get(s, s)
                if s.startswith('DESP-'):
                    cajas.append(s)
                elif s in costos:
                    out['empaque' if s == 'PACK-CUR-11018' else 'cmv'] += costos[s] * c * q
            continue
        if estado == 'nuevo' or base is None:
            out['sin_regla'].append(p['n'])
            out['sin_costo_n'].append(p['n'])
            out['sin_costo'] += q
            continue
        for s, c in comps + ([] if v['local'] else despacho(nombre, comps)):
            s = reglas.ALIAS.get(s, s)
            if s.startswith('DESP-'):
                cajas.append(s)
                continue
            if s not in costos:
                out['sin_costo'] += c * q
                if p['n'] not in out['sin_costo_n']:
                    out['sin_costo_n'].append(p['n'])
                continue
            out['empaque' if s == 'PACK-CUR-11018' else 'cmv'] += costos[s] * c * q
    if v['local']:
        out['despacho'] = costos.get(BOLSA_LOCAL, 0)
    elif cajas:
        out['despacho'] = max(costos.get(s, 0) for s in cajas)
    for k in ('cmv', 'empaque', 'despacho'):
        out[k] = round(out[k], 2)
    return out


if __name__ == '__main__':
    costos = json.load(open(sys.argv[1]))
    print(json.dumps([calcular(costos, v) for v in json.load(sys.stdin)], ensure_ascii=False))
