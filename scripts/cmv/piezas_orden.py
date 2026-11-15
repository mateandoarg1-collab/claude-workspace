"""Unidades por SKU maestro de cada venta de Empretienda (para el stock del depósito, scripts/stock-empretienda.mjs),
con las mismas reglas que cmv.py / cmv_orden.py.
Uso: python3 piezas_orden.py < entrada.json
entrada.json: {"ventas": [{"id", "dia", "local": bool, "productos": [{"n": nombre, "v": "Opción: valor | ...", "q": cant}]}],
               "eq": {"NOMBRE|VARIANTE BASE": [[sku, cant], ...]}}  (o solo la lista de ventas)
eq = equivalencias canal Tienda de la pestaña "Stock Equivalencias" (las revisa Juampi en mateando-stock): si la publicación
tiene una, manda sobre las reglas. La clave usa la variante sin las opciones que suman extras (bombilla, caja, bolsa, grabado).
Imprime {"piezas": [[dia, canal, sku, cant]], "revisar": [[canal, nombre, variante, cant, clave]]}.
No cuenta grabados (PERS-*: es un servicio) ni cajas de despacho (DESP-*).
"""
import json, re, sys
import reglas

EXTRA = re.compile(r'BOMBILLA|CAJA|BOLSA|PERSONALIZAD|GRABAD|NOMBRE|TEXTO|FRASE|DEDICATORIA')


def clave(nombre, variante):
    ops = [o.strip() for o in (variante or '').split('|') if o.strip()]
    base = ' | '.join(o for o in ops if not EXTRA.search(o.split(':')[0].upper()))
    return f'{nombre.strip().upper()}|{base.upper()}'


def main():
    piezas, revisar = {}, {}
    entrada = json.load(sys.stdin)
    ventas, eq = (entrada, {}) if isinstance(entrada, list) else (entrada['ventas'], entrada.get('eq') or {})
    for v in ventas:
        canal = 'Local' if v.get('local') else 'Tienda Online'
        for p in v['productos']:
            nombre, variante, q = str(p.get('n') or '').upper(), str(p.get('v') or '').upper(), p.get('q') or 0
            k_eq = clave(p.get('n') or '', p.get('v') or '')
            if k_eq in eq:
                base, estado = [tuple(x) for x in eq[k_eq]], 'eq'
            else:
                try:
                    base, estado = reglas.resolver(nombre, variante)
                except (TypeError, ValueError):
                    base, estado = None, 'FALTA'
            if base is None or estado == 'nuevo':
                k = (canal, p.get('n') or '', p.get('v') or '', k_eq)
                revisar[k] = revisar.get(k, 0) + q
                continue
            for s, c in base + reglas.extras(nombre, variante):
                s = reglas.ALIAS.get(s, s)
                if s.startswith('PERS-') or s.startswith('DESP-'):
                    continue
                k = (v['dia'], canal, s)
                piezas[k] = piezas.get(k, 0) + c * q
    print(json.dumps({'piezas': [[*k, n] for k, n in sorted(piezas.items())],
                      'revisar': [[*k, n] for k, n in revisar.items()]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
