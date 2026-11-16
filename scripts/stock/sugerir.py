"""Sugiere qué SKUs maestros incluye una publicación de cualquier canal (MeLi, Shopify, Mayorista, Tienda) leyendo su
título y variante. Solo sirve para PRECARGAR la equivalencia: Juampi la revisa una por una en mateando-stock.vercel.app
(pestaña Equivalencias). Devuelve (["SKU", "SKU*2", ...], dudoso) — dudoso=True cuando adivina algo (color, modelo).
"""
import re
import unicodedata

BOMB, CAJA, CAJA_G, PERS = 'BOMB-ACE-12001', 'PACK-CAJ-11003', 'PACK-CAJ-11004', 'PERS-LAS-11017'


def norm(t):
    t = unicodedata.normalize('NFD', str(t or '')).encode('ascii', 'ignore').decode().upper()
    return re.sub(r'\s+', ' ', t)


def color(t, opciones, defecto=None):
    """opciones: [(regex, sku)] en orden; la primera que aparece gana."""
    for rx, sku in opciones:
        if re.search(rx, t):
            return sku, False
    return defecto, True


NEG, BLA, ROS, BEI = r'NEGR|BLACK', r'BLANC|WHITE', r'ROS[AE]|QUARTZ|RQ\b', r'BEIGE|CREMA|CREAM'
MARR_CL = r'MARRON CLARO|SUELA|CRUDO'

# (regex del producto, resolvedor(t) -> (skus, dudoso))
def _cal(neg, mar, sue):
    return lambda t: color(t, [(MARR_CL, sue), (NEG, neg), (r'MARRON|BORD|BORRAVINO', mar)], neg)


def _guarda(pampa, abstracta):
    return lambda t: (abstracta, False) if 'ABSTRACT' in t else (pampa, False)  # la guarda no importa (Juampi): por defecto Pampa


def _termo_mateando(t):
    litro = not re.search(r'750|SLIM', t)
    base = ['TER-MAT-5001', 'TER-MAT-5002', 'TER-MAT-5003', 'TER-MAT-5004'] if litro else ['TER-MAT-5005', 'TER-MAT-5006', 'TER-MAT-5007', 'TER-MAT-5008']
    return color(t, [(ROS, base[1]), (BEI, base[3]), (BLA, base[2]), (NEG, base[0])], base[0])


def _flow(t):
    return color(t, [(ROS, 'MATE-ACE-3008'), (BEI, 'MATE-ACE-3009'), (BLA, 'MATE-ACE-3017'), (NEG, 'MATE-ACE-3007')], 'MATE-ACE-3007')


def _gota(t):
    return color(t, [(ROS, 'MATE-ACE-3014'), (BLA, 'MATE-ACE-3013'), (NEG, 'MATE-ACE-3006')], 'MATE-ACE-3006')


def _vaso(t):
    return color(t, [(ROS, 'MATE-ACE-3016'), (BLA, 'MATE-ACE-3015'), (NEG, 'MATE-ACE-3005')], 'MATE-ACE-3005')


def _deluxe(t):
    if 'CROCO' in t:
        return color(t, [(BLA, 'MATE-ACE-3011')], 'MATE-ACE-3010')
    if 'FLEJE' in t:
        return 'MATE-ACE-3012', False
    return color(t, [(BLA, 'MATE-ACE-3003'), (r'MARRON|SUELA', 'MATE-ACE-3004'), (NEG, 'MATE-ACE-3002')], 'MATE-ACE-3002')


def _ranchero(t):
    if re.search(ROS, t):
        return 'MATE-MAD-2020', False
    return color(t, [(r'TODO NEGRO|BLACK', 'MATE-MAD-2007'), (BLA, 'MATE-MAD-2003'), (NEG, 'MATE-MAD-2004'), (r'SUELA|MARRON CLARO', 'MATE-MAD-2006'), (r'MARRON|CHOCOLATE', 'MATE-MAD-2005')], 'MATE-MAD-2004')


def _muu(t):
    return color(t, [(r'ORGANICO', 'MATE-MAD-2014'), (r'BLANC|CREMA|GRIS', 'MATE-MAD-2012'), (NEG, 'MATE-MAD-2013')], 'MATE-MAD-2012')


def _imp_algarrobo(t):
    if re.search(r'FORRADO|CUERO', t) and not re.search(r'CANASTA', t):
        return 'MATE-MAD-2019', 'ALPACA' in t
    if 'SOL DE MAYO' in t:
        return 'MATE-MAD-2016', False
    if 'ENCERADO' in t:
        return _guarda('MATE-MAD-2010', 'MATE-MAD-2011')(t)
    return _guarda('MATE-MAD-2008', 'MATE-MAD-2009')(t)


def _imp_calabaza(t):
    if 'FLEJE' in t:
        return 'MATE-CAL-1038', not re.search(NEG, t)
    if 'REPUJADO' in t:
        return ('MATE-CAL-1041', False) if 'MANO' in t else color(t, [(r'MARRON', 'MATE-CAL-1028')], 'MATE-CAL-1027')
    if 'ROMA' in t:
        if 'ALPACA' in t:
            return ('MATE-CAL-1043', False) if 'CINCEL' in t else ('MATE-CAL-1042', False)
        return _cal('MATE-CAL-1013', 'MATE-CAL-1014', 'MATE-CAL-1015')(t)
    if 'SOL DE MAYO' in t:
        sk = ['MATE-CAL-1010', 'MATE-CAL-1011', 'MATE-CAL-1012'] if 'CROCO' in t else ['MATE-CAL-1007', 'MATE-CAL-1008', 'MATE-CAL-1009']
        return _cal(*sk)(t)
    if 'ANIMAL' in t or 'PRINT' in t:
        return ('MATE-CAL-1036', False) if 'CINCEL' in t else _guarda('MATE-CAL-1025', 'MATE-CAL-1026')(t)
    if 'DOBLE CALADO' in t:
        return 'MATE-CAL-1044', False
    if 'CINCEL' in t or 'ALPACA' in t:
        return 'MATE-CAL-1035', True
    abs_ = 'ABSTRACT' in t or re.search(r'\bGA\b|-GA\b', t)
    if re.search(BLA, t):
        return ('MATE-CAL-1023' if abs_ else 'MATE-CAL-1024'), False
    if re.search(r'MARRON|BORD|BORRAVINO|-MA-', t):
        return ('MATE-CAL-1022' if abs_ else 'MATE-CAL-1020'), not re.search(r'MARRON', t)
    return ('MATE-CAL-1021' if abs_ else 'MATE-CAL-1019'), False


def _torpedo(t):
    if re.search(r'ALGARROBO|MADERA', t):
        return ('MATE-MAD-2018', False) if 'CINCEL' in t else ('MATE-MAD-2017', False)
    if 'CRIOLLO' in t:
        return ('MATE-CAL-1031', False) if 'VIROLA' in t and 'SIN' not in t else ('MATE-CAL-1032', True)
    if 'ANIMAL' in t:
        return 'MATE-CAL-1037', False
    if 'IMPERIAL' in t and 'CINCEL' in t:
        return 'MATE-CAL-1039', False
    if 'ROMA' in t:
        return _cal('MATE-CAL-1016', 'MATE-CAL-1017', 'MATE-CAL-1018')(t)
    if 'DOBLE CALADO' in t:
        return 'MATE-CAL-1045', False
    if 'CRUDO' in t or ('ALPACA' in t and 'CINCEL' in t and 'BASE' in t):
        return 'MATE-CAL-1040', False
    if 'CINCEL' in t or 'CROCO' in t:
        return color(t, [(r'MARRON|BORD', 'MATE-CAL-1034'), (NEG, 'MATE-CAL-1033')], 'MATE-CAL-1033')[0], True
    if 'DELUXE' in t:
        return 'MATE-ACE-3001', False
    return _cal('MATE-CAL-1004', 'MATE-CAL-1005', 'MATE-CAL-1006')(t)


def _camionero(t):
    if 'CERAMICA' in t:
        return color(t, [(r'MARRON', 'MATE-CER-4002'), (NEG, 'MATE-CER-4001')], 'MATE-CER-4001')
    if 'CRIOLLO' in t:
        return ('MATE-CAL-1030', False) if 'SIN VIROLA' in t else ('MATE-CAL-1029', 'VIROLA' not in t)
    if re.search(r'ALGARROBO|MADERA', t):
        return ('MATE-MAD-2002', False) if 'ENCERADO' in t else ('MATE-MAD-2001', False)
    return _cal('MATE-CAL-1001', 'MATE-CAL-1002', 'MATE-CAL-1003')(t)


def _ceramica(t):
    return color(t, [(r'CREMA|BLANC', 'MATE-CER-4004'), (r'VERDE', 'MATE-CER-4005'), (r'ROJO', 'MATE-CER-4006'), (NEG, 'MATE-CER-4003')], 'MATE-CER-4003')


def _autocebante(t):
    if re.search(r'MATEJUSTO|\bPRO\b|PLATEADO', t):
        return color(t, [(BLA, 'AUTO-MJ-6006'), (r'PLATEAD', 'AUTO-MJ-6007'), (NEG, 'AUTO-MJ-6005')], 'AUTO-MJ-6005')
    return color(t, [(ROS, 'AUTO-MAT-6002'), (BEI, 'AUTO-MAT-6003'), (BLA, 'AUTO-MAT-6004'), (NEG, 'AUTO-MAT-6001')], 'AUTO-MAT-6001')


def _media_manija(t):
    return color(t, [(r'PLATEAD|ACERO\b(?!.*NEGR)', 'TER-ACE-5009'), (BLA, 'TER-ACE-5011'), (NEG, 'TER-ACE-5010')], 'TER-ACE-5010')


def _canasta(t):
    if re.search(r'CUERINA|ECOCUERO|ECO CUERO|ECONOMICA', t) and not re.search(r'2X2|4X4(?!.*CUERINA)', t):
        return color(t, [(ROS, 'CANA-ECO-7005'), (BLA, 'CANA-ECO-7003'), (r'SUELA|MARRON CLARO', 'CANA-ECO-7004'), (r'MARRON', 'CANA-ECO-7002'), (NEG, 'CANA-ECO-7001')], 'CANA-ECO-7001')
    if '2X2' in t:
        return color(t, [(r'SUELA|MARRON CLARO', 'CANA-2X2-7011'), (r'MARRON', 'CANA-2X2-7010'), (NEG, 'CANA-2X2-7009')], 'CANA-2X2-7009')
    if 'CAMPESTRE' in t:
        return color(t, [(r'SUELA|MARRON CLARO', 'BOLS-CUE-7019'), (r'MARRON', 'BOLS-CUE-7018'), (NEG, 'BOLS-CUE-7017')], 'BOLS-CUE-7017')
    if 'TIENTO' in t:
        return 'CANA-TIE-7015', False
    if 'CAPRI' in t:
        return 'CANA-CAP-7014', False
    if 'BENJA' in t or ('REFORZADA' in t and 'PREMIUM' in t):
        return color(t, [(r'MARRON|SUELA', 'CANA-BEN-7027'), (NEG, 'CANA-BEN-7026')], 'CANA-BEN-7026')
    return color(t, [(r'SUELA|MARRON CLARO', 'CANA-4X4-7008'), (r'MARRON', 'CANA-4X4-7007'), (NEG, 'CANA-4X4-7006')], 'CANA-4X4-7006')


def _yerbera(t):
    if 'STANLEY' in t:
        return color(t, [(ROS, 'STAN-YER-14028'), (r'VERDE', 'STAN-YER-14029')], 'STAN-YER-14027')
    if 'AZUCARERA' in t:
        if 'ECOCUERO' in t:
            return 'YERB-KIT-8013', False
        if 'CUERO' in t:
            return color(t, [(r'SUELA', 'YERB-KIT-8007'), (r'MARRON', 'YERB-KIT-8006'), (NEG, 'YERB-KIT-8005')], 'YERB-KIT-8005')
        return 'YERB-LAT-8012', True
    if 'GAMUZ' in t:
        return color(t, [(NEG, 'YERB-GAM-8011'), (r'MARRON', 'YERB-GAM-8008')], 'YERB-GAM-8008')
    if 'TAMBO' in t:
        return 'YERB-LAT-8004', False
    if 'CAPRI' in t:
        return 'YERB-CAP-8009', False
    if 'LONA' in t or 'TOTE' in t:
        return 'YERB-TOT-8010', False
    return color(t, [(r'SUELA', 'YERB-CUE-8003'), (r'MARRON', 'YERB-CUE-8002'), (NEG, 'YERB-CUE-8001')], 'YERB-CUE-8001')


def _bombilla(t):
    if 'STANLEY' in t:
        return color(t, [(r'VERDE', 'STAN-BOM-14002')], 'STAN-BOM-14001')
    if 'GAUCHITO' in t:
        return 'BOMB-GAU-12007', True
    if 'PICO REY' in t or 'PICO DE REY' in t:
        return ('BOMB-CIN-12016', False) if 'DORADO' in t else ('BOMB-ALP-12006', True)
    if 'DORAD' in t:
        return 'BOMB-CIN-12014', False
    if 'BOMBILLON' in t:
        if 'ALPACA' in t:
            return ('BOMB-ALP-12004', False) if 'CINCEL' in t else ('BOMB-ALP-12003', True)
        if 'DELUXE' in t:
            return ('BOMB-ALP-12005', 'CINCEL' not in t) if 'LORO' in t else ('BOMB-ALP-12012', True)
        return 'BOMB-DEL-12015', False
    if 'ALPACA' in t:
        return ('BOMB-ALP-12016', False) if 'CINCEL' in t else ('BOMB-ALP-12011', False)
    return BOMB, False


def _stanley(t):
    if 'YERBERA' in t:
        return color(t, [(ROS, 'STAN-YER-14028'), (r'VERDE', 'STAN-YER-14029')], 'STAN-YER-14027')
    if 'QUENCHER' in t or 'VASO' in t or 'TUMBLER' in t:
        return ('STAN-QUE-14026', False) if '887' in t else ('STAN-QUE-14025', False)
    if 'POLAR' in t:
        return 'STAN-POL-14024', False
    if 'CLASSIC' in t or '950' in t:
        return color(t, [(ROS, 'STAN-CLA-14008'), (r'VERDE', 'STAN-CLA-14009')], 'STAN-CLA-14007')
    if re.search(r'\bMATE\b(?! SYSTEM)', t) and 'TERMO' not in t and 'SYSTEM' not in t:
        return color(t, [(BEI, 'STAN-MAT-14003'), (ROS, 'STAN-MAT-14005'), (r'VERDE', 'STAN-MAT-14006')], 'STAN-MAT-14004')
    chico = '800' in t
    tabla = {'COBRE': ('14013', '14012'), 'CREAM': ('14015', '14014'), 'TOASTY': ('14021', '14020'), 'ROS': ('14019', '14018'), 'VERDE': ('14023', '14022')}
    for k, (a, b) in tabla.items():
        if k in t:
            return f'STAN-SYS-{a if chico else b}', False
    return f"STAN-SYS-{'14017' if chico else '14016'}", True


def _yerba(t):
    kg = bool(re.search(r'1 ?KG|1 KILO|1000', t))
    if 'BALDO' in t:
        return ('BALD-KIL-13011' if kg else 'BALD-MED-13012'), False
    if 'ALBA' in t:
        return ('ALBA-SUA-13014' if 'SUAVE' in t else 'ALBA-TRA-13013'), False
    if 'COSMICO' in t:
        return 'ALBA-CLA-13015', False
    if 'SERENA' in t:
        return ('CANA-SER-13006' if kg else 'CANA-SER-13005'), False
    if 'ESPECIAL' in t:
        return ('CANA-ESP-13008' if kg else 'CANA-ESP-13007'), False
    if 'JENGIBRE' in t:
        return ('CANA-TEJ-13010' if kg else 'CANA-TEJ-13009'), False
    if re.search(r'\b100 ?G', t):
        return 'CANA-TRA-13001', False
    if re.search(r'\b250', t):
        return 'CANA-TRA-13002', False
    return ('CANA-TRA-13004' if kg else 'CANA-TRA-13003'), not re.search(r'500|1 ?KG', t)


def _pava(t):
    return color(t, [(r'CREMA', 'PAVA-ELE-9002'), (r'ROJ', 'PAVA-ELE-9003')], 'PAVA-ELE-9001')


def _rutero(t):
    return color(t, [(r'MARRON CLARO|SUELA', 'RUTE-SUE-7025'), (r'MARRON', 'RUTE-MAR-7024'), (NEG, 'RUTE-NEG-7023')], 'RUTE-NEG-7023')


# Accesorios sueltos: (regex, sku)
FIJOS = [
    (r'LUZ (PARA )?MATE', 'ACCE-LUZ-10007'), (r'LIMPIA ?BOMBILLA|CEPILLO', 'ACCE-LIM-10008'), (r'DESPOLVILLADOR|TAMIZ', 'ACCE-DES-10006'),
    (r'ALMOHADA', 'ACCE-ALM-10009'), (r'TAPA ?MATE.*TAPA ?BOMBI|KIT TAPA', 'ACCE-KIT-10010'), (r'TAPA ?BOMBI', 'ACCE-TAB-10005'), (r'TAPA ?MATE', 'ACCE-TAM-10004'),
    (r'^PICO.*(SYSTEM|PRECISION)', 'ACCE-PIC-10003'), (r'^PICO.*VERDE', 'ACCE-PIC-10002'), (r'^PICO( TAPON)? CEBADOR', 'ACCE-PIC-10001'),
    (r'MOCHILA.*(CAMUFLAD|VERDE MILITAR)', 'MOCHI-CAM-7013'), (r'MOCHILA (MATEANDO|OUTDOOR)|OUTDOOR', 'MOCHI-NEG-7012'),
    (r'TULUM', 'BOLS-TUL-7022'), (r'IBIZA', 'BOLS-IBI-7021'), (r'BALI\b', 'BOLS-BAL-7020'), (r'TOTE', 'BOLS-TOT-7016'),
    (r'^CAJA (DE REGALO )?(GRANDE|XL|TERMO)', CAJA_G), (r'^CAJA (DE REGALO )?(PARA )?BOMBILLA', 'PACK-CAJ-11005'), (r'^CAJA', CAJA),
    (r'BOLSA', 'PACK-BOL-11001'), (r'PACKAGING', 'PACK-PAC-11006'), (r'PERSONALIZACION|PERSONALIZADO LASER', PERS),
    (r'SYSTEM GENERICO|TERMO GENERICO|PRECISION 1', 'TER-SYS-5012'), (r'MATE CON PIEL|\bPIEL\b', 'MATE-PIEL'),
]


def principal(t):
    """Producto principal de un título (sin los agregados de bombilla/caja/grabado)."""
    if 'STANLEY' in t and 'COMPATIBLE' not in t:
        return _stanley(t)
    if re.search(r'^(BOMBILLA|BOMBILLON)|^BOMBILLAS?\b', t) or (re.search(r'BOMBILL', t) and not re.search(r'\bMATE\b|TERMO|SET|KIT', t)):
        return _bombilla(t)
    if re.search(r'YERBA (MATE )?(CANARIAS|BALDO|ALBA)|^(CANARIAS|YERBA CANARIAS)|COSMICO', t):
        return _yerba(t)
    if 'PAVA' in t:
        return _pava(t)
    if 'RUTERO' in t or 'PORTAMATE AUTO' in t:
        return _rutero(t)
    if re.search(r'AUTOCEBANTE|AUTOMATE|MATE ?JUSTO', t):
        return _autocebante(t)
    if re.search(r'YERBERA|AZUCARERA', t) and not re.search(r'^(SET|KIT) MATE\b|\bMATE (IMPERIAL|CAMIONERO|VACA)', t):
        return _yerbera(t)
    if re.search(r'CANASTA|MATERA\b|PORTA ?TERMO|BOLSO MATERO CANASTA', t) and not re.search(r'^(SET|KIT)', t) and not re.search(r'^MATE ', t):
        return _canasta(t)
    for rx, sku in FIJOS:
        if re.search(rx, t):
            return sku, False
    if re.search(r'MEDIA MANIJA|TERMO MATE 1 LITRO ACERO INOXIDABLE MANIJA', t):
        return _media_manija(t)
    if re.search(r'TERMO', t) and not re.search(r'\bMATE (IMPERIAL|CAMIONERO|VACA|ACERO|DE )|^MATE\b', t):
        if 'PERSONALIZADO' in t and 'MATEANDO' not in t:
            return None, True
        return _termo_mateando(t)
    if re.search(r'FLOW|236', t):
        return _flow(t)
    if re.search(r'GOTA|SIMIL', t):
        return _gota(t)
    if re.search(r'MATE IMPERIAL ACERO ROSE|IMPERIAL ACERO RQ', t):
        return 'MATE-ACE-RQ', False
    if 'DELUXE' in t and not re.search(r'BOMBILLON', t.split('+')[0]):
        return _deluxe(t)
    if re.search(r'IMPERIAL ACERO|ACERO.*IMPERIAL|IMPE DELUXE|IMPERIAL DE ACERO', t):
        return _deluxe(t)
    if re.search(r'TERMICO|VASO|VASITO|DOBLE (CAPA|PARED)|ACERO MATEANDO|MATE (DE )?ACERO', t):
        return _vaso(t)
    if 'CERAMICA' in t and 'CAMIONERO' not in t:
        return _ceramica(t)
    if re.search(r'RANCHERO|VAQUITA|4 PUNTAS|VACA', t) and 'MUU' not in t:
        return (('MATE-MAD-2015', False) if '4 PUNTAS' in t or '4.0' in t else _ranchero(t))
    if 'MUU' in t:
        return _muu(t)
    if 'TORPEDO' in t:
        return _torpedo(t)
    if 'CAMIONERO' in t or re.search(r'\bCAMIO\b', t):
        return _camionero(t)
    if re.search(r'IMPERIAL|IMPE\b', t) or 'DIA DE LA MADRE' in t or 'DIA DEL PADRE' in t:
        if re.search(r'ALGARROBO|MADERA|RUSTICO|ENCERADO', t) or 'DIA DE' in t or 'DIA DEL' in t:
            return _imp_algarrobo(t)
        return _imp_calabaza(t)
    if 'SOL DE MAYO' in t:
        return ('MATE-MAD-2016', False) if 'ALGARROBO' in t else ('MATE-CAL-1007', True)
    if 'CRIOLLO' in t:
        return 'MATE-CAL-1030', True
    if 'COQUITO' in t or 'GALLETA' in t:
        return None, True
    if 'ALGARROBO' in t:
        return 'MATE-MAD-2001', True
    return None, True


def es_mate(sku):
    return bool(sku) and (sku.startswith('MATE-') and not sku.startswith('MATE-KIT'))


def sugerir(*partes):
    t = norm(' '.join(str(p) for p in partes if p))
    if re.search(r'GIFT ?CARD|TARJETA DE REGALO|ENVIO\b|SEGURO|ADELANTO', t):
        return ['-'], False
    # Sets / kits: se arman por componentes
    if re.search(r'^(SET|KIT|BOX|PACK|COMBO|\d ?X ?1)\b|^MATE PARA MAMA|SAN VALENTIN.*TERMO', t) and not re.search(r'^SET (YERBERA|DE YERBERA|MATERO YERBERA)|^KIT (TAPA|CUCHILLO)|^PACK YERBA', t):
        return set_(t)
    p, dudoso = principal(t)
    if p is None:
        return [], True
    skus = [p]
    if es_mate(p):
        if re.search(r'BOMBILL|PICO (DE )?LORO', t) and not re.search(r'SIN BOMBILLA', t):
            skus.append(BOMB)
        if re.search(r'CAJA (PREMIUM|DE REGALO)', t):
            skus.append(CAJA)
        if re.search(r'PERSONALIZAD|GRABADO|DIA DE LA MADRE|DIA DEL PADRE|CLUBES|BANDAS|SAN VALENTIN|SELECCION|CAMPEON', t):
            skus.append(PERS)
    m = re.search(r'X ?(\d+) ?UNIDADES', t)
    if m:
        skus = [f'{p}*{m.group(1)}']
    return skus, dudoso


def set_(t):
    """Sets: busca cada componente por palabras."""
    out, dudoso = [], False
    mates = t
    if re.search(r'TERMO', t):
        if re.search(r'MEDIA MANIJA', t):
            s, d = _media_manija(t)
        elif re.search(r'PRECISION|1\.2', t):
            s, d = 'TER-SYS-5012', False
        else:
            s, d = _termo_mateando(t)
        out.append(s); dudoso |= d
        mates = re.sub(r'TERMO( MATEANDO| DE PRECISION| MEDIA MANIJA)?( ACERO INOX)?( \d[\d.,]* ?(CC|ML|LT?S?|LITROS?)\b)?', ' ', t)
    if re.search(r'MATE|IMPERIAL|CAMIONERO|RANCHERO|VACA|TORPEDO|GOTA', mates):
        if re.search(r'MATE ACERO INOX|MATE ACERO TERMICO|MATE IMPERIAL ACERO TERMICO|ACERO DOBLE CAPA', mates) and 'ROSE' not in mates:
            s, d = (_flow(t) if re.search(r'MATEANDO|SET MATERO -|KIT MATERO TERMO', t) and 'IMPERIAL' not in t else _deluxe(t))
        else:
            s, d = principal(re.sub(r'^(SET|KIT|BOX|PACK|COMBO)( MATERO)?( MATEANDO)?|^\d ?X ?1 ?-?', 'MATE ', mates))
            if s and not es_mate(s):
                s, d = None, True
        if s:
            out.append(s); dudoso |= d
        else:
            dudoso = True
    if re.search(r'BOMBILL', t):
        out.append(BOMB)
    if re.search(r'YERBERA', t):
        out.append(_yerbera(t)[0] if 'AZUCARERA' in t or 'GAMUZ' in t else _yerbera(t)[0]); dudoso |= 'GAMUZ' not in t and 'AZUCARERA' not in t
    if re.search(r'CANASTA|MATERA\b(?! ?MATEANDO)|BOLSO\b', t):
        out.append(_canasta(t)[0] if 'BOLSO' not in t else 'BOLS-TOT-7016'); dudoso = True
    if re.search(r'TOTE', t) and 'BOLS-TOT-7016' not in out:
        out.append('BOLS-TOT-7016')
    if re.search(r'CAJA (PREMIUM|DE REGALO)|^BOX', t):
        out.append(CAJA)
    if re.search(r'PERSONALIZAD|GRABADO|^BOX MAMA', t):
        out.append(PERS)
    if re.search(r'^(\d) ?X ?1', t) is None and len(out) < 2:
        dudoso = True
    return out, dudoso


if __name__ == '__main__':
    import json, sys
    for x in json.load(sys.stdin):
        print(json.dumps([x, *sugerir(x)], ensure_ascii=False))
