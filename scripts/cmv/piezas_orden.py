"""Unidades por SKU maestro de cada venta de Empretienda (para el stock del depósito, scripts/stock-empretienda.mjs),
con las mismas reglas que cmv.py / cmv_orden.py.
Uso: python3 piezas_orden.py < ventas.json
ventas.json: [{"id", "dia", "local": bool, "productos": [{"n": nombre, "v": "Opción: valor | ...", "q": cant}]}]
Imprime {"piezas": [[dia, canal, sku, cant]], "revisar": [[canal, nombre, variante, cant]]}.
No cuenta grabados (PERS-*: es un servicio) ni cajas de despacho (DESP-*).
"""
import json, sys
import reglas


def main():
    piezas, revisar = {}, {}
    for v in json.load(sys.stdin):
        canal = 'Local' if v.get('local') else 'Tienda Online'
        for p in v['productos']:
            nombre, variante, q = str(p.get('n') or '').upper(), str(p.get('v') or '').upper(), p.get('q') or 0
            try:
                base, estado = reglas.resolver(nombre, variante)
            except (TypeError, ValueError):
                base, estado = None, 'FALTA'
            if base is None or estado == 'nuevo':
                k = (canal, p.get('n') or '', p.get('v') or '')
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
