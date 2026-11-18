"""Costo por unidad de cada producto de Empretienda según las reglas (para /rentabilidad-tienda/costos).
Uso: python3 costo_productos.py costos.json < productos.json
productos.json: [{"n": nombre, "variantes": ["Color: Rojo | Bombilla: Si", ...]}] (sin variantes vendidas: [""])
Imprime [{"n", "costos": {variante: costo o null}}]: costo sin IVA del producto con lo que suma la variante (bombilla,
caja o bolsa de regalo), sin el packaging general ni la caja de despacho. null = sin regla o con algún SKU sin costo.
No mira los costos cargados a mano (costos["_productos"]): esos los muestra la página aparte.
"""
import json, sys
import reglas
from cmv import EMPAQUE
from cmv_orden import mayusculas
from piezas_orden import clave


def costo(costos, nombre, variante):
    k = clave(nombre, variante)
    if k in costos.get('_eq', {}):  # equivalencia de mateando-stock (lo que lleva la publicación)
        base, estado = [tuple(x) for x in costos['_eq'][k]], 'eq'
    else:
        try:  # algunas reglas necesitan el color de la variante: sin eso (producto sin ventas) no se puede saber
            base, estado = reglas.resolver(nombre, variante)
        except (TypeError, ValueError):
            return None
    if estado == 'nuevo' or base is None:
        return None
    total = 0
    ex = reglas.extras(nombre, variante)
    if estado == 'eq':
        ya = {x for x, _ in base}
        ex = [(x, c) for x, c in ex if x not in ya or x == reglas.CAJA]
    for s, c in base + ex:
        s = reglas.ALIAS.get(s, s).upper()
        if s.startswith('DESP-') or s in EMPAQUE:
            continue
        if s not in costos:
            return None
        total += costos[s] * c
    return round(total, 2)


if __name__ == '__main__':
    costos = mayusculas(json.load(open(sys.argv[1])))
    out = []
    for p in json.load(sys.stdin):
        nombre = str(p['n'] or '').upper()
        out.append({'n': p['n'], 'costos': {v: costo(costos, nombre, str(v or '').upper()) for v in (p.get('variantes') or [''])}})
    print(json.dumps(out, ensure_ascii=False))
