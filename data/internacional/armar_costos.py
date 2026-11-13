# Arma costos de productos de mateandoshop.com (Shopify internacional) desde el SKU maestro.
import json, csv, os
C = json.load(open(os.path.expanduser('~/Downloads/equivalencias/costos_shopify.json')))
B, P, CAJA, TMM = 'BOMB-ACE-12001', 'PERS-LAS-11017', 'PACK-CAJ-11003', 'TER-ACE-5009'
MEGA = [TMM, B, 'CANA-4x4-7006', 'YERB-CUE-8001']
M = {  # titulo -> (skus, duda o None)
 'BOLSO MATERO BALI': (['BOLS-BAL-7020'], None),
 'BOLSO MATERO IBIZA': (['BOLS-IBI-7021'], None),
 'BOLSO MATERO TULUM': (['BOLS-TUL-7022'], None),
 'BOMBILLA CINCELADA': (['BOMB-CIN-12014'], None),
 'BOMBILLA PICO LORO - acero': ([B], None),
 'BOMBILLON DE ALPACA CINCELADO': ([], 'No tengo costo del bombillón alpaca cincelado'),
 'BOMBILLON PICO REY': (['BOMB-ALP-12004'], None),
 'BOMBILLON RECTO DELUXE': (['BOMB-ALP-12006'], None),
 'CAJA DE REGALO': ([CAJA], None),
 'COMBO BOSTERO: CAMIONERO PERSONALIZADO': (['MATE-CAL-1001', P, B], None),
 'COMBO GALLINA: CAMIONERO PERSONALIZADO': (['MATE-CAL-1001', P, B], None),
 'COMBO MARADONA': ([], '¿Qué lleva el combo Maradona?'),
 'COMBO RACING CLUB + BOMBILLA DE REGALO': (['MATE-CAL-1001', P, B], None),
 'IMPERIAL DELUXE CROCO BLANCO + BOMBILLA DE REGALO': ([], '¿Qué mate es y cuánto cuesta? (no está en el maestro)'),
 'LATA YERBERA ALBA NUEVA BEIGE': ([], 'No tengo costo de la lata yerbera Alba Nueva'),
 'LATA YERBERA ALBA NUEVA VERDE': ([], 'No tengo costo de la lata yerbera Alba Nueva'),
 'MATE ACERO TÉRMICO + BOMBILLA DE REGALO': (['MATE-ACE-3002', B], 'Supuse Imperial Deluxe Acero ($10.000)'),
 'MATE ALGARROBO SOL DE MAYO ARGENTINO + BOMBILLA + CAJA DE REGALO': (['MATE-MAD-2016', B, CAJA], None),
 'MATE ARGENTINA CAMPEÓN DEL MUNDO': ([], '¿Qué mate es? (no está en el maestro)'),
 'MATE CAMIONERO DE ALGARROBO + BOMBILLA DE REGALO': (['MATE-MAD-2001', B], None),
 'MATE CAMIONERO DELUXE CROCO MARRON OSCURO': ([], 'No tengo costo del camionero deluxe croco'),
 'MATE CAMIONERO PREMIUM  MARRON SUELA + BOMBILLA DE REGALO': (['MATE-CAL-1002', B], None),
 'MATE CAMIONERO PREMIUM + BOMBILLA DE REGALO': (['MATE-CAL-1001', B], None),
 'MATE CAMIONERO PREMIUM - CAMINO A LA COPA DEL MUNDO': (['MATE-CAL-1001', P, B], None),
 'MATE CAMIONERO PREMIUM PERSONALIZADO + BOMBILLA DE REGALO': (['MATE-CAL-1001', P, B], None),
 'MATE DE ALGARROBO MUU + BOMBILLA PICO LORO': (['DISC-MUU-ORIG', B], None),
 'MATE DE CERÁMICA ESMALTADA': ([], 'No tengo costo del mate de cerámica esmaltada'),
 'MATE GALLETA CUERO CROCO PREMIUM + BOMBILLA DE REGALO': ([], 'No tengo costo del galleta croco'),
 'MATE IMPERIAL ALGARROBO ENCERADO + BOMBILLA DE REGALO': (['MATE-MAD-2010', B], None),
 'MATE IMPERIAL DELUXE LISO + BOMBILLA DE REGALO': (['MATE-ACE-3002', B], None),
 'MATE IMPERIAL DELUXE ROSA': (['MATE-ACE-3002'], 'Usé el costo del Imperial Deluxe negro ($10.000)'),
 'MATE IMPERIAL PREMIUM CINCELADO + BOMBILLA DE REGALO': ([], 'No tengo costo del imperial cincelado'),
 'MATE IMPERIAL PREMIUM LISO (GUARDA PAMPA) + BOMBILLA DE REGALO': (['MATE-CAL-1019', B], None),
 'MATE IMPERIAL PREMIUM PERSONALIZADO + BOMBILLA DE REGALO': (['MATE-CAL-1019', P, B], None),
 'MATE IMPERIAL SOL DE MAYO PREMIUM + BOMBILLA PICO DE LORO': ([], 'No tengo costo del Imperial Sol de Mayo cuero'),
 'MATE LISTO AUTOCEBANTE': (['AUTO-MAT-6001'], None),
 'MATE TORPEDO CROCO CINCELADO MARRÓN + BOMBILLA PICO LORO': (['MATE-CAL-1034', B], None),
 'MATE TORPEDO CROCO CINCELADO NEGRO + BOMBILLA PICO LORO': (['MATE-CAL-1033', B], None),
 'MATE TORPEDO PREMIUM + BOMBILLA PICO LORO': (['MATE-CAL-1004', B], None),
 'MATE VACA RANCHERO + BOMBILLA PICO LORO': (['MATE-MAD-2003', B], None),
 'MATE VACA RANCHERO 4.0 ROSE QUARTZ + BOMBILLA PICO LORO': (['MATE-MAD-2015', B], None),
 'MATERA DE CUERO GRUESO ALTA CALIDAD 4x4': (['CANA-4x4-7006'], None),
 'MOCHILA MATEANDO OUTDOOR': (['MOCHI-NEG-7012'], None),
 'Mate Imperial PREMIUM LISO (GUARDA ABSTRACTA) + BOMBILLA DE REGALO': (['MATE-CAL-1019', B], None),
 'PORTA MATE RUTERO': (['RUTE-NEG-7023'], None),
 'SET ALGARROBO: CAMIONERO + TERMO MEDIA MANIJA + BOMBILLA DE REGALO': (['MATE-MAD-2001', TMM, B], None),
 'SET DE MATE ACERO + TERMO MEDIA MANIJA': (['MATE-ACE-3002', TMM], None),
 'SET DE MATE IMPERIAL + TERMO MEDIA MANIJA + BOMBILLA DE REGALO': (['MATE-CAL-1019', TMM, B], None),
 'SET DE MATE TORPEDO + TERMO MEDIA MANIJA': (['MATE-CAL-1004', TMM, B], 'Supuse que lleva bombilla'),
 'SET MATE CAMIONERO + TERMO MEDIA MANIJA + BOMBILLA DE REGALO': (['MATE-CAL-1001', TMM, B], None),
 'SET MATERO ARGENTINO': ([], '¿Qué lleva el Set Matero Argentino?'),
 'SET MATERO MEGACOMPLETO MATEANDO - CON TORPEDO-': (['MATE-CAL-1004'] + MEGA, 'Supuse mate + termo MM + bombilla + canasta 4x4 + yerbera cuero'),
 'SET MATERO MEGACOMPLETO MATEANDO -CON CAMIONERO-': (['MATE-CAL-1001'] + MEGA, 'Ídem megacompleto'),
 'SET MATERO MEGACOMPLETO MATEANDO IMPERIAL': (['MATE-CAL-1019'] + MEGA, 'Ídem megacompleto'),
 'SET MEGACOMPLETO OUTDOOR - CON IMPERIAL -': ([], '¿Qué lleva el Set Megacompleto Outdoor?'),
 'SET MEGACOMPLETO OUTDOOR -CON CAMIONERO-': ([], '¿Qué lleva el Set Megacompleto Outdoor?'),
 'SET MEGACOMPLETO OUTDOOR -CON MATE ACÉRO TÉRMICO-': ([], '¿Qué lleva el Set Megacompleto Outdoor?'),
 'SET MEGACOMPLETO OUTDOOR -CON MATE ALGARROBO-': ([], '¿Qué lleva el Set Megacompleto Outdoor?'),
 'SET MEGACOMPLETO OUTDOOR -CON TORPEDO-': ([], '¿Qué lleva el Set Megacompleto Outdoor?'),
 'SET VACA RANCHERO 4.0 ROSE QUARTZ + TERMO MATEANDO 1 L + BOMBILLA': (['MATE-MAD-2015', 'TER-MAT-5002', B], None),
 'SUPERCOMBO BOSTERO: MATE, TERMO y BOMBILLA': (['MATE-CAL-1001', P, TMM, B], 'Supuse camionero grabado + termo MM + bombilla'),
 'TAPON CEBADOR STANLEY': ([], 'No tengo costo del tapón cebador Stanley'),
 'TERMO MATEANDO MEDIA MANIJA': ([TMM], None),
 'TERMO TERMOLAR REVOLUTION 1LT ACERO INOXIDABLE': ([], 'No tengo costo del Termolar Revolution'),
 'TORPEDO CINCELADO': (['MATE-CAL-1033'], None),
 'TOTE MATERA MATEANDO CAMPEONES DEL MUNDO': (['BOLS-TOT-7016'], None),
 'YERBA ALBA NUEVA SUAVE': (['ALBA-SUA-13014'], None),
 'YERBA ALBA NUEVA TRADICIONAL': (['ALBA-TRA-13013'], None),
 'YERBA CANARIAS 500gr.': (['CANA-TRA-13003'], None),
 'YERBA PLAYADITO 500 GR X 10 PAQUETES': ([], 'No tengo costo de Playadito x10'),
 'YERBA TARAGUI 500 GR X 10 PAQUETES': ([], 'No tengo costo de Taragüi x10'),
 'YERBERA PREMIUM CUERO': (['YERB-CUE-8001'], None),
 'YERBERA TAMBO': ([], 'No tengo costo de la yerbera Tambo'),
}
out = {}
for t, (skus, duda) in M.items():
    falta = [s for s in skus if s not in C]
    costo = sum(C.get(s, 0) for s in skus) if skus and not falta else None
    out[t] = {'skus': skus, 'costo_ars': round(costo) if costo else None, 'duda': duda}
json.dump(out, open(os.path.join(os.path.dirname(__file__), 'costos.json'), 'w'), ensure_ascii=False, indent=1)
ok = sum(1 for v in out.values() if v['costo_ars'] and not v['duda'])
sup = sum(1 for v in out.values() if v['costo_ars'] and v['duda'])
sin = sum(1 for v in out.values() if not v['costo_ars'])
print(f'seguros {ok} · supuestos {sup} · sin costo {sin}')
for t, v in out.items():
    if v['duda']: print(('SUPUESTO' if v['costo_ars'] else 'FALTA   '), t, '|', v['costo_ars'], '|', v['duda'])
