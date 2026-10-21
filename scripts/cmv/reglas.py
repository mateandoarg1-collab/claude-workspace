"""Reglas Empretienda -> SKU maestro: cada publicación + variante se traduce a lista de (SKU, cantidad).
Armado con JP en sept/oct 2026 (ver scripts/cmv/README.md)."""
import re

BOMB = 'BOMB-ACE-12001'; CAJA = 'PACK-CAJ-11003'; BOLSA = 'PACK-BOL-11001'; PERS = 'PERS-LAS-11017'
# SKUs que para el conteo son el mismo producto (mismo costo). Se aplica también a Shopify/ML.
ALIAS = {'BOMB-ACE-12002': 'BOMB-ACE-12001'}

def color(txt, opciones):
    for k, v in opciones.items():
        if re.search(k, txt): return v
    return None

# Reglas por nombre de publicación: (regex, función(nombre+variante) -> lista de (sku, cant), estado)
def R(*skus): return [(s, 1) if isinstance(s, str) else s for s in skus]
RANCH = {'NEGR|BLACK': 'MATE-MAD-2004', 'MARR': 'MATE-MAD-2005', 'ROS': 'MATE-MAD-2015', 'BLANC': 'MATE-MAD-2003'}
MM = {'NEGR': 'TER-ACE-5010', 'PLATE|ACERO|MATEANDO': 'TER-ACE-5009'}
CAL_CAM = {'NEGR': 'MATE-CAL-1001', 'MARR': 'MATE-CAL-1002', 'SUELA': 'MATE-CAL-1003'}
CAL_TOR = {'NEGR': 'MATE-CAL-1004', 'MARR': 'MATE-CAL-1005', 'SUELA': 'MATE-CAL-1006'}
CAL_IMP = {'NEGR': 'MATE-CAL-1019', 'MARR': 'MATE-CAL-1020', 'BLANC': 'MATE-CAL-1023'}

def set_matero(t, mates):
    c = color(t, {'NEGR': 'N', 'MARR': 'M', 'SUELA': 'S'}) or 'N'
    mate = color({'N': 'NEGR', 'M': 'MARR', 'S': 'SUELA'}[c], mates)
    return R(mate, 'TER-ACE-5009', BOMB, {'N': 'CANA-4x4-7006', 'M': 'CANA-4x4-7007', 'S': 'CANA-4x4-7008'}[c],
             {'N': 'YERB-CUE-8001', 'M': 'YERB-CUE-8002', 'S': 'YERB-CUE-8003'}[c])

REGLAS = [
    # --- octubre 2026 (publicaciones nuevas, definidas con JP el 21-oct) ---
    (r'^NUEVO! MATE RANCHERO ROS', lambda t: R('MATE-MAD-2020'), 'ok'),
    (r'^BOX MAM. [1-4] - MATE RANCHERO BLANCO|^BOX MAM. 2', lambda t: R('MATE-MAD-2003', BOMB), 'ok'),
    (r'^BOX MAM. 3', lambda t: R('MATE-MAD-2020', BOMB), 'ok'),
    (r'SET IMPERIAL ROSE QUARTZ \+ TERMO MATEANDO 1 L', lambda t: R('MATE-ACE-RQ', 'TER-MAT-5002', BOMB), 'ok'),
    (r'^BOX MAM. 4|IMPERIAL ACERO ROSE QUARTZ', lambda t: R('MATE-ACE-RQ', BOMB), 'ok'),
    (r'^BOX MAM. 1|IMPERIAL RUSTICO - MAM', lambda t: R('MATE-MAD-2008', BOMB), 'ok'),
    (r'KIT MATERO MATEANDO - TERMO 1 L MATE (ROSA|BEIGE|NEGRO|BLANCO)', lambda t: R('MATE-KIT-1L'), 'ok'),
    (r'KIT MATERO MATEANDO - TERMO 750 ML MATE (ROSA|BEIGE|NEGRO|BLANCO)', lambda t: R('MATE-KIT-750'), 'ok'),
    (r'SET VACA RANCHERO \+ TERMO MATEANDO BEIGE 1 L', lambda t: R('MATE-MAD-2003', 'TER-MAT-5004', BOMB), 'ok'),
    (r'SET MATE VACA RANCHERO ROSA \+ TERMO .*750', lambda t: R('MATE-MAD-2020', 'TER-MAT-5006', BOMB), 'ok'),
    (r'SET MATE VACA RANCHERO BLACK \+ TERMO .*750', lambda t: R('MATE-MAD-2004', 'TER-MAT-5005', BOMB), 'ok'),
    (r'SET MATE VACA RANCHERO \+ TERMO MATEANDO BEIGE 750', lambda t: R('MATE-MAD-2003', 'TER-MAT-5008', BOMB), 'ok'),
    (r'IMPERIAL PREMIUM CON PIEL', lambda t: R('MATE-PIEL'), 'ok'),
    (r'KIT MATERO TOTE TERMO Y MATE ROSE QUARTZ', lambda t: R('BOLS-TOT-7016', 'TER-MAT-5002', 'MATE-MAD-2020', 'YERB-GAM-8008', BOMB), 'revisar'),
    (r'TOTE MATERA ROSE QUARTZ', lambda t: R('BOLS-TOT-7016'), 'revisar'),
    (r'IMPERIAL PREMIUM DOBLE CALADO', lambda t: R('MATE-CAL-1044'), 'ok'),
    (r'IMPERIAL PREMIUM - BASE ALPACA', lambda t: R('MATE-CAL-1042'), 'revisar'),
    (r'MATE AFA', lambda t: R('MATE-AFA'), 'revisar'),
    (r'KIT: TAPAMATE Y TAPABOMBI', lambda t: R('ACCE-KIT-10009'), 'ok'),
    (r'MATE TORPEDO CROCO CINCELADO (NEGRO|MARR)', lambda t: R('MATE-CAL-1033' if 'NEGRO' in t else 'MATE-CAL-1034'), 'ok'),
    # --- respuestas del usuario sobre productos que no estaban en Shopify ---
    (r'BOMBILLA DE ALPACA CINCELADA PICO DE LORO', lambda t: R('BOMB-ALP-12016'), 'ok'),
    (r'BOMBILLA PICO LORO DESARMABLE', lambda t: R('BOMB-DES-12017'), 'ok'),
    (r'BOMBILLON DE ALPACA CINCELADO', lambda t: R('BOMB-ALP-12004'), 'ok'),
    (r'^TAPABOMBI$|^TAPAMATE$', lambda t: R('ACCE-KIT-10009'), 'ok'),
    (r'IMPERIAL PREMIUM CUERO REPUJADO A MANO', lambda t: R('MATE-CAL-1041'), 'ok'),
    (r'MATE VACA MUU ORIGINAL', lambda t: R('DISC-MUU-ORIG'), 'discontinuado'),
    (r'MATE IMPERIAL DE CERAMICA', lambda t: R('DISC-IMP-CERAMICA'), 'discontinuado'),
    (r'MATE COQUITO', lambda t: R('DISC-COQUITO'), 'discontinuado'),
    (r'MATE GALLETA CUERO CROCO', lambda t: R('DISC-GALLETA-CROCO'), 'discontinuado'),
    (r'PICO CEBADOR STANLEY', lambda t: R('DISC-PICO-STANLEY'), 'discontinuado'),
    (r'ALGARROBO MUU BLACK', lambda t: R('DISC-MUU-BLACK'), 'discontinuado'),
    (r'YERBA COSMICO', lambda t: R('DISC-YERBA-COSMICO'), 'discontinuado'),
    (r'MATE MUU 2\.0', lambda t: R('DISC-MUU-2'), 'discontinuado'),
    # --- kits / combos ---
    # Set Matero con X: mate calabaza + termo media manija + bombilla + canasta 4x4 + yerbera cuero; el color cambia mate, matera y yerbera
    (r'SET MATERO CON CAMIONERO$', lambda t: set_matero(t, CAL_CAM), 'ok'),
    (r'SET MATERO CON (IMPERIAL|TORPEDO)$', lambda t: set_matero(t, CAL_IMP if 'IMPERIAL' in t else CAL_TOR), 'revisar'),
    (r'BOX \d DIA DEL MAESTRO', lambda t: [], 'ignorado'),
    (r'SET MATERO RÚSTICO', lambda t: R('MATE-MAD-2008', 'TER-ACE-5009', BOMB), 'ok'),
    (r'SET YERBERA Y AZUCARERA ECOCUERO', lambda t: R('YERB-KIT-8013'), 'ok'),  # aún no publicado en Shopify
    (r'3X1.*RANCHERO BLACK', lambda t: R('MATE-MAD-2004', BOMB, 'YERB-GAM-8011'), 'ok'),
    (r'3X1.*RANCHERO', lambda t: R(color(t, RANCH) or 'MATE-MAD-2003', BOMB, 'YERB-GAM-8011' if color(t, RANCH) == 'MATE-MAD-2004' else 'YERB-GAM-8008'), 'ok'),  # yerbera acompaña el color del mate
    (r'3X1.*IMPERIAL', lambda t: R('MATE-MAD-2008', BOMB, 'YERB-GAM-8008'), 'ok'),
    (r'4X1 - CAMIONERO', lambda t: R('MATE-MAD-2001', PERS, BOMB, 'YERB-GAM-8008'), 'ok'),
    (r'KIT MATERO CAPRI', lambda t: R('MATE-MAD-2015', 'TER-MAT-5002', 'CANA-CAP-7014', 'YERB-GAM-8008', BOMB), 'ok'),
    (r'SET ROSA - MATE RANCHERO', lambda t: R('MATE-MAD-2015', 'TER-MAT-5002', 'YERB-LAT-8012'), 'revisar'),
    (r'SET .*RANCHERO.*(4\.0|ROSE QUARTZ RANCHERO).*750', lambda t: R('MATE-MAD-2015', 'TER-MAT-5006', BOMB), 'revisar'),
    (r'SET .*RANCHERO.*(4\.0|ROSE QUARTZ RANCHERO)', lambda t: R('MATE-MAD-2015', 'TER-MAT-5002', BOMB), 'ok'),
    (r'SET VACA ROSE QUARTZ RANCHERO', lambda t: R('MATE-MAD-2020', 'TER-MAT-5002', BOMB), 'ok'),  # = BUNDLE-B024
    (r'SET .*RANCHERO.*1 L BLANCO', lambda t: R('MATE-MAD-2003', 'TER-MAT-5003', BOMB), 'ok'),
    (r'SET .*RANCHERO.*ROS[AE] QUARTZ 1 L', lambda t: R('MATE-MAD-2003', 'TER-MAT-5002', BOMB), 'ok'),
    (r'SET .*RANCHERO.*750', lambda t: R('MATE-MAD-2003', 'TER-MAT-5006', BOMB), 'revisar'),
    (r'SET ENCERADO', lambda t: R('MATE-MAD-2010', color(t.split(' | ')[0], MM) or 'TER-ACE-5009', BOMB), 'ok'),
    (r'SET DE MATE TORPEDO PREMIUM', lambda t: R(color(t, CAL_TOR) or 'MATE-CAL-1004', color(t.split(' | ')[0], MM) or 'TER-ACE-5009', BOMB), 'ok'),
    (r'SET (MATE )?CAMIONERO.*TERMO MEDIA MANIJA', lambda t: R('MATE-MAD-2001', color(t.split(' | ')[0], MM) or 'TER-ACE-5009', BOMB), 'ok'),  # sin color = plateado
    (r'SET DE MATE IMPERIAL \+ BOMBILLA', lambda t: R('MATE-MAD-2008', color(t.split(' | ')[0], MM) or 'TER-ACE-5009', BOMB), 'ok'),
    (r'SET DE MATE ACERO', lambda t: R('MATE-ACE-3006', 'TER-ACE-5010'), 'revisar'),
    (r'MATE ACERO TERMICO \+ TERMO.*ROSA', lambda t: R('MATE-ACE-3014', 'TER-MAT-5006'), 'ok'),
    (r'MATE ACERO TERMICO \+ TERMO', lambda t: R('MATE-ACE-3006', 'TER-MAT-5005'), 'ok'),
    (r'KIT MATERO MATEANDO - TERMO 1 L MATE BEIGE', lambda t: R('MATE-ACE-3009', 'TER-MAT-5004', BOMB), 'ok'),
    (r'KIT MATERO MATEANDO - TERMO 750 ML MATE NEGRO', lambda t: R('MATE-ACE-3007', 'TER-MAT-5005', BOMB), 'ok'),
    (r'SET BOLSO MATERO CAPRI', lambda t: R('CANA-CAP-7014', 'YERB-CAP-8009'), 'ok'),
    (r'TOTE MATERA MATEANDO \+ YERBERA', lambda t: R('BOLS-TOT-7016', 'YERB-TOT-8010'), 'ok'),
    (r'TERMO MATE SYSTEM', lambda t: R('TER-SYS-5012', BOMB), 'ok'),
    (r'SET DE LATAS YERBERA Y AZUCARERA FORRADAS EN CUERO MARRON', lambda t: R('YERB-KIT-8006'), 'ok'),
    # --- 2x1 / 4x3 ---
    (r'2X1 MATE CAMIONERO DE ALGARROBO ENCERADO', lambda t: R(('MATE-MAD-2002', 2)), 'ok'),
    (r'2X1 MATE CAMIONERO DE ALGARROBO', lambda t: R(('MATE-MAD-2001', 2)), 'ok'),
    (r'2X1 MATE CAMIONERO DE CALABAZA', lambda t: R((color(t, CAL_CAM) or 'MATE-CAL-1001', 2)), 'ok'),
    (r'2X1 MATE VACA RANCHERO', lambda t: R((color(t, RANCH) or 'MATE-MAD-2003', 2)), 'ok'),
    (r'2X1 MATE IMPERIAL PREMIUM', lambda t: R((color(t, CAL_IMP) or 'MATE-CAL-1019', 2)), 'ok'),
    (r'4X3 YERBA CANARIAS SERENA', lambda t: R(('CANA-SER-13005', 4)), 'revisar'),
    (r'YERBA CANARIAS 4X3', lambda t: R(('CANA-TRA-13003', 4)), 'revisar'),
    # --- mates ---
    (r'RANCHERO 4\.0', lambda t: R('MATE-MAD-2015'), 'ok'),
    (r'RANCHERO ROSE QUARTZ', lambda t: R('MATE-MAD-2020'), 'ok'),  # 'Nuevo! Mate Ranchero Rose Quartz', distinto del 4.0
    (r'MATE VACA RANCHERO', lambda t: R(color(t, RANCH) or 'MATE-MAD-2003'), 'ok'),  # sin color = blanco
    (r'IMPERIAL (DE )?ALGARROBO ENCERADO', lambda t: R('MATE-MAD-2010'), 'ok'),
    (r'IMPERIAL PREMIUM ALGARROBO|IMPERIAL DE ALGARROBO', lambda t: R('MATE-MAD-2008'), 'ok'),
    (r'IMPERIAL SOL DE MAYO.*CROCO', lambda t: R({'NEGR': 'MATE-CAL-1010', 'MARR': 'MATE-CAL-1011', 'SUELA': 'MATE-CAL-1012'}[next(k for k in ['NEGR','SUELA','MARR'] if k in t)]), 'ok'),
    (r'IMPERIAL SOL DE MAYO', lambda t: R(color(t, {'NEGR': 'MATE-CAL-1007', 'SUELA': 'MATE-CAL-1009', 'MARR': 'MATE-CAL-1008'})), 'ok'),
    (r'ALGARROBO SOL DE MAYO', lambda t: R('MATE-MAD-2016'), 'ok'),
    (r'IMPERIAL ANIMAL PRINT', lambda t: R('MATE-CAL-1025'), 'ok'),
    (r'IMPERIAL DELUXE', lambda t: R(color(t, {'NEGR': 'MATE-ACE-3002', 'BLANC': 'MATE-ACE-3003', 'MARR': 'MATE-ACE-3004'})), 'ok'),
    (r'MATE IMPERIAL PREMIUM( PERSONALIZADO| \(GUARDA)', lambda t: R(color(t, CAL_IMP) or 'MATE-CAL-1019'), 'ok'),
    (r'TORPEDO PREMIUM$', lambda t: R(color(t, CAL_TOR) or 'MATE-CAL-1004'), 'ok'),
    (r'TORPEDO DE ALGARROBO', lambda t: R('MATE-MAD-2017'), 'ok'),
    (r'TORPEDO CINCELADO CRUDO', lambda t: R('MATE-CAL-1040'), 'ok'),
    (r'TORPEDO (CROCO )?CINCELADO', lambda t: R(color(t, {'NEGR': 'MATE-CAL-1033', 'MARR': 'MATE-CAL-1034'})), 'ok'),  # = Torpedo Cincelado Exclusivo de Shopify
    (r'CAMIONERO (DE )?ALGARROBO ENCERADO', lambda t: R('MATE-MAD-2002'), 'ok'),
    (r'CAMIONERO (DE )?ALGARROBO|ALGARROBO PERSONALIZADO TINI', lambda t: R('MATE-MAD-2001'), 'ok'),
    (r'INTERIOR DE CERÁMICA', lambda t: R(color(t, {'NEGR': 'MATE-CER-4001', 'MARR': 'MATE-CER-4002'}) or 'MATE-CER-4001'), 'ok'),
    (r'CAMIONERO (URUGUAYO )?PREMIUM|RACING CLUB', lambda t: R(color(t, CAL_CAM) or 'MATE-CAL-1001'), 'ok'),
    (r'CRIOLLO CON BASE CUERO', lambda t: R('MATE-CAL-1030'), 'ok'),
    (r'^MATE CRIOLLO$', lambda t: R('MATE-CAL-1029'), 'revisar'),
    (r'FLOW', lambda t: R(color(t, {'BEIGE': 'MATE-ACE-3009', 'ROSA': 'MATE-ACE-3008', 'BLANC': 'MATE-ACE-3017', 'NEGR': 'MATE-ACE-3007'})), 'ok'),
    (r'MATE ACERO MATEANDO', lambda t: R(color(t, {'NEGR': 'MATE-ACE-3006', 'BLANC': 'MATE-ACE-3013'})), 'revisar'),
    (r'AUTOCEBANTE.*PLATEADO', lambda t: [], 'ignorado'),
    (r'AUTOCEBANTE', lambda t: R(color(t, {'NEGR': 'AUTO-MAT-6001', 'ROSA': 'AUTO-MAT-6002', 'BLANC': 'AUTO-MAT-6004'})), 'ok'),
    # --- termos ---
    (r'TERMO MATEANDO CLASSIC', lambda t: R(color(t, {'ROSA': 'TER-MAT-5002', 'NEGR': 'TER-MAT-5001', 'BLANC': 'TER-MAT-5003', 'BEIGE': 'TER-MAT-5004'})), 'ok'),
    (r'TERMO MATEANDO SLIM', lambda t: R(color(t, {'ROSA': 'TER-MAT-5006', 'NEGR': 'TER-MAT-5005', 'BLANC': 'TER-MAT-5007', 'BEIGE': 'TER-MAT-5008'})), 'ok'),
    (r'TERMO MEDIA MANIJA (NEGRO|BOCA|AFA)|TERMO NEGRO INDEPENDIENTE', lambda t: R('TER-ACE-5010'), 'ok'),
    (r'TERMO MEDIA MANIJA', lambda t: R('TER-ACE-5009'), 'ok'),
    # --- materas / bolsos ---
    (r'CANASTA MATERA +ECOCUERO.*NEGRO', lambda t: R('CANA-ECO-7001'), 'ok'),
    (r'PORTA TERMO.*MARRON', lambda t: R('CANA-BEN-7027'), 'ok'),
    (r'PORTA TERMO.*NEGRO', lambda t: R('CANA-BEN-7026'), 'ok'),
    (r'4X4', lambda t: R(color(t, {'SUELA': 'CANA-4x4-7008', 'MARR': 'CANA-4x4-7007', 'NEGR': 'CANA-4x4-7006'}) or 'CANA-4x4-7007'), 'ok'),  # 'marrón suela' = suela
    (r'2X2', lambda t: R(color(t, {'SUELA': 'CANA-2x2-7011', 'MARR': 'CANA-2x2-7010', 'NEGR': 'CANA-2x2-7009'}) or 'CANA-2x2-7010'), 'revisar'),
    (r'^MATERA CAPRI$', lambda t: R('CANA-CAP-7014'), 'ok'),
    (r'MOCHILA.*CAMUFLADA', lambda t: R('MOCHI-CAM-7013'), 'ok'),
    (r'MOCHILA', lambda t: R('MOCHI-NEG-7012'), 'ok'),
    (r'^TOTE MATERA', lambda t: R('BOLS-TOT-7016'), 'ok'),
    (r'BOLSO MATERO BALI', lambda t: R('BOLS-BAL-7020'), 'ok'),
    (r'BOLSO MATERO IBIZA', lambda t: R('BOLS-IBI-7021'), 'ok'),
    (r'BOLSO MATERO TULUM', lambda t: R('BOLS-TUL-7022'), 'ok'),
    (r'PORTAMATE RUTERO', lambda t: R(color(t, {'NEGR': 'RUTE-NEG-7023', 'MARR': 'RUTE-MAR-7024', 'SUELA': 'RUTE-SUE-7025'})), 'ok'),
    # --- yerberas ---
    (r'YERBERA GAMUZA - NEGRA', lambda t: R('YERB-GAM-8011'), 'ok'),
    (r'YERBERA GAMUZA', lambda t: R('YERB-GAM-8008'), 'ok'),
    (r'YERBERA PREMIUM CUERO', lambda t: R(color(t, {'SUELA': 'YERB-CUE-8003', 'MARR': 'YERB-CUE-8002', 'NEGR': 'YERB-CUE-8001'}) or 'YERB-CUE-8001'), 'ok'),  # sin color = negro
    (r'^YERBERA CAPRI', lambda t: R('YERB-CAP-8009'), 'ok'),
    (r'^YERBERA LONA', lambda t: R('YERB-TOT-8010'), 'ok'),
    # --- bombillas ---
    (r'BOMBILLON +DELUXE PICO DE LORO', lambda t: R('BOMB-ALP-12005'), 'ok'),
    (r'BOMBILLON RECTO DELUXE', lambda t: R('BOMB-ALP-12006'), 'ok'),
    (r'PICO DE REY', lambda t: R('BOMB-ALP-12004'), 'ok'),
    (r'BOMBILLON ACERO INOX', lambda t: R('BOMB-DEL-12015'), 'ok'),
    (r'PICOLORO ACERO INOX MINI', lambda t: R('BOMB-ACE-12002'), 'ok'),
    (r'PICOLORO ACERO INOX LARGA', lambda t: R('BOMB-ACE-12001'), 'ok'),
    (r'BOMBILLA PICO LORO - ACERO - PERSONALIZADO', lambda t: R('BOMB-ACE-12001', PERS), 'ok'),
    (r'PICO LORO ACERO PICO DORADO', lambda t: R('BOMB-CIN-12014'), 'ok'),
    # --- accesorios / yerbas ---
    (r'PICO CEBADOR MATE SYSTEM', lambda t: R('ACCE-PIC-10003'), 'ok'),
    (r'LUZ MATE', lambda t: R('ACCE-LUZ-10007'), 'ok'),
    (r'DESPOLVILLADOR', lambda t: R('ACCE-DES-10006'), 'ok'),
    (r'LIMPIA BOMBILLA', lambda t: R('ACCE-LIM-10008'), 'ok'),
    (r'ALMOHADA', lambda t: R('ACCE-ALM-10008'), 'ok'),
    (r'^CAJA DE REGALO$', lambda t: R(CAJA), 'ok'),
    (r'CANARIAS SERENA CON HIERBAS 500', lambda t: R('CANA-SER-13005'), 'revisar'),
    (r'CANARIAS SERENA 1KG', lambda t: R('CANA-SER-13006'), 'ok'),
    (r'CANARIAS 500', lambda t: R('CANA-TRA-13003'), 'ok'),
    (r'CANARIAS 1KG', lambda t: R('CANA-TRA-13004'), 'ok'),
    (r'ALBA NUEVA TRADICIONAL', lambda t: R('ALBA-TRA-13013'), 'ok'),
    (r'ALBA NUEVA SUAVE', lambda t: R('ALBA-SUA-13014'), 'ok'),
    (r'GIFT CARD', lambda t: [], 'ok'),
]

def resolver(nombre, variante):
    t = f'{nombre} | {variante}'
    for rx, fn, estado in REGLAS:
        if re.search(rx, nombre):
            if fn is None: return None, estado
            comps = fn(t)
            if any(s is None for s, _ in comps): return None, 'FALTA'
            return comps, estado
    return [], 'nuevo'  # publicación sin regla: va a la pestaña cmv_revisar para agregarla

def extras(nombre, variante):
    """Componentes que agregan las opciones de variante y palabras del título."""
    ex = []
    opts = {k.strip().upper(): v.strip().upper() for k, _, v in (o.partition(':') for o in (variante or '').split('|'))}
    if opts.get('BOMBILLA') == 'SI': ex.append((BOMB, 1))
    if any(k.startswith('CAJA') and v == 'SI' for k, v in opts.items()): ex.append((CAJA, 1))
    if opts.get('BOLSA DE REGALO') == 'SI': ex.append((BOLSA, 1))
    # cada opción "... Personalizado: SI" es un grabado (mate y termo personalizados = 2)
    grabados = sum(1 for k, v in opts.items() if 'PERSONALIZADO' in k and v == 'SI')
    if grabados: ex.append((PERS, grabados))
    elif re.search(r'PERSONALIZADO|BOCA JUNIORS|RIVER|INDEPENDIENTE|RACING|SAN LORENZO|AFA|DISNEY|HARRY POTTER|AIRBAG|TINI|BAD BUNNY', nombre) and not re.search(r'4X1|BOMBILLA PICO LORO - ACERO', nombre):
        ex.append((PERS, 1))
    # en los 2x1 cada opción elegida va por 2 (2 bombillas, 2 grabados, 2 cajas...)
    mult = 2 if nombre.startswith('2X1') else 1
    return [(sku, c * mult) for sku, c in ex]

