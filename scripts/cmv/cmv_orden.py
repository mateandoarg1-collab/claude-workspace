"""CMV y packaging por venta de Empretienda (para scripts/tienda-rentabilidad.mjs), con las mismas reglas que cmv.py.
Uso: python3 cmv_orden.py costos.json < ventas.json
ventas.json: [{"id": ..., "local": bool, "productos": [{"n": nombre, "v": "Opción: valor | ...", "q": cant}]}]
Imprime [{"id", "cmv", "empaque", "despacho", "sin_costo": unidades, "sin_regla": [nombres]}].
Packaging (README): online, cada mate sin caja de regalo lleva el packaging general y la venta lleva UNA caja de
despacho (la más cara de las que pedirían sus productos); local (retiro), una bolsa por venta y sin caja.
"""
import json, sys
import reglas
from cmv import despacho

BOLSA_LOCAL = 'PACK-BOL-11001'


def calcular(costos, v):
    out = {'id': v['id'], 'cmv': 0, 'empaque': 0, 'despacho': 0, 'sin_costo': 0, 'sin_regla': []}
    cajas = []
    for p in v['productos']:
        nombre, variante, q = str(p['n'] or '').upper(), str(p['v'] or '').upper(), p['q'] or 0
        base, estado = reglas.resolver(nombre, variante)
        comps = (base or []) + reglas.extras(nombre, variante)
        if estado == 'nuevo' or base is None:
            out['sin_regla'].append(p['n'])
            out['sin_costo'] += q
            continue
        for s, c in comps + ([] if v['local'] else despacho(nombre, comps)):
            s = reglas.ALIAS.get(s, s)
            if s.startswith('DESP-'):
                cajas.append(s)
                continue
            if s not in costos:
                out['sin_costo'] += c * q
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
