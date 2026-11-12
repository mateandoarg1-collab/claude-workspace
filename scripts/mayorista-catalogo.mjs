// Deja "App Productos" con el catálogo mayorista 2026 (CATALOGO_MAYORISTA_Y_CORPORATIVO_2026): los productos del
// catálogo quedan activos con precio, colores y foto (recortada del PDF, servida por mateando-mayorista.vercel.app/fotos);
// todo lo demás se oculta (activo = NO) y, si es una forma vieja de escribir un producto del catálogo, se anota en la
// columna "es" para que la app sume sus ventas a ese producto. No borra nada. Uso: node scripts/mayorista-catalogo.mjs [--dry]
import { google } from 'googleapis';

const ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const FOTO = (p) => `https://mateando-mayorista.vercel.app/fotos/p${p}.jpg`;
// [nombre, precio neto, costo sin IVA (de scripts/cmv/costos_base.json, el mismo de la rentabilidad de tienda y MeLi), colores, página del PDF]
const CAT = [
  ['Mate autocebante 750 ml', 45500, 16000, 'Negro,Blanco,Rosa', '04'],
  ['Kit matero corporativo', 29900, 0, '', '05'],
  ['Kit matero corporativo System', 31900, 0, '', '06'],
  ['Kit matero completo corporativo', 44900, 0, '', '07'],
  ['Mate Mateando con base de silicona', 27500, 0, 'Negro,Blanco,Rosa,Crema', '08'],
  ['Termo Mateando 1 L', 53900, 18000, 'Negro,Blanco,Rosa,Crema', '09'],
  ['Termo Mateando 750 ml', 41900, 15965, 'Negro,Blanco,Rosa,Crema', '10'],
  ['Mate gota', 10000, 3400, 'Negro,Rojo,Blanco,Rosa,Amarillo', '11'],
  ['Camionero de algarrobo', 14990, 7500, 'Natural,Oscuro', '12'],
  ['Camionero de algarrobo encerado', 14990, 7500, '', '13'],
  ['Imperial algarrobo rústico', 23990, 12000, '', '14'],
  ['Imperial premium', 28990, 17000, 'Guarda pampa,Guarda abstracta', '15'],
  ['Camionero calabaza', 19490, 13500, 'Negro,Marrón', '16'],
  ['Mate de acero inoxidable', 11990, 3400, 'Negro,Rojo,Blanco,Rosa,Amarillo', '17'],
  ['Ranchero', 24990, 19700, 'Natural,Negro,Marrón,Negro y natural,Blanco y natural', '18'],
  ['Imperial algarrobo encerado', 23990, 10900, '', '19'],
  ['Bombilla pico loro', 4990, 1288, 'Corta,Larga', '20'],
  ['Termo media manija negro', 19990, 8917, '', '21'],
  ['Termo media manija plateado', 18990, 8700, '', '22'],
  ['Yerbera de gamuza', 8900, 2800, 'Marrón,Negra', '23'],
  ['Matera de eco cuero', 13500, 5300, 'Negro,Blanco,Marrón,Fucsia', '24'],
  ['Matera de cuero 2x2', 23990, 24925, 'Negro,Marrón,Suela', '25'],
  ['Matera de cuero 4x4', 26900, 29325, 'Negro,Marrón,Suela', '26'],
  ['Mochila matera', 44700, 36300, '', '27'],
  ['Caja de presentación mediana', 6990, 4000, '', '28'],
  ['Caja de presentación XL', 8990, 8500, '', '29'],
  ['Termo Stanley', 0, 0, '', '30'],
  ['Personalización (grabado láser)', 2250, 1100, '', '31'],
];
// nombres viejos del Excel → producto del catálogo (la primera regla que coincide gana; sin regla = queda oculto suelto)
const ES = [
  [/^personaliz/, 'Personalización (grabado láser)'],
  [/caja.*(grande|xl|termo)/, 'Caja de presentación XL'],
  [/caja.*(chica|bombilla)/, 'Caja de presentación mediana'],
  [/stanley/, 'Termo Stanley'],
  [/autoceb/, 'Mate autocebante 750 ml'],
  [/media manija platead/, 'Termo media manija plateado'],
  [/media manija/, 'Termo media manija negro'],
  [/termo.*750|750.*termo/, 'Termo Mateando 750 ml'],
  [/termo.*(1 ?l|litro)|classic manija/, 'Termo Mateando 1 L'],
  [/bombilla/, 'Bombilla pico loro'],
  [/imperial.*encerado/, 'Imperial algarrobo encerado'],
  [/imperial.*rustico/, 'Imperial algarrobo rústico'],
  [/imperial/, 'Imperial premium'],
  [/mate mateando|base (de )?silicona/, 'Mate Mateando con base de silicona'],
  [/gota/, 'Mate gota'],
  [/acero|simil|vasito/, 'Mate de acero inoxidable'],
  [/camio.*encerado/, 'Camionero de algarrobo encerado'],
  [/camio.*(calabaza|premium)/, 'Camionero calabaza'],
  [/camio/, 'Camionero de algarrobo'],
  [/ranchero|rachero|vaquita/, 'Ranchero'],
  [/gamuza/, 'Yerbera de gamuza'],
  [/no cuerina/, 'Matera de cuero 4x4'],
  [/eco ?cuero|cuerina/, 'Matera de eco cuero'],
  [/2x2/, 'Matera de cuero 2x2'],
  [/4x4/, 'Matera de cuero 4x4'],
  [/mochila/, 'Mochila matera'],
];
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\bimpe\b/g, 'imperial');

const auth = new google.auth.GoogleAuth({ keyFile: `${process.env.HOME}/.claude/.mateando-credentials.json`, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sh = google.sheets({ version: 'v4', auth });
const filas = ((await sh.spreadsheets.values.get({ spreadsheetId: ID, range: `'App Productos'!A2:G`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [])
  .map((f) => Array.from({ length: 7 }, (_, i) => (f[i] == null ? '' : f[i])));
const enCat = new Map(CAT.map((c) => [c[0].toLowerCase(), c]));
const salida = [];
const agrupados = {};
for (const f of filas) {
  if (!f[0] || enCat.has(String(f[0]).toLowerCase())) continue;
  const r = ES.find(([re]) => re.test(norm(f[0])));
  if (r) (agrupados[r[1]] ||= []).push(f[0]);
  salida.push([f[0], f[1], f[2], 'NO', f[4], f[5], r ? r[1] : '']);
}
for (const [nombre, precio, costo, colores, pag] of CAT) {
  const viejo = filas.find((f) => String(f[0]).toLowerCase() === nombre.toLowerCase());
  salida.push([nombre, precio, costo || (viejo ? viejo[2] : 0) || 0, 'SI', FOTO(pag), colores, '']);
}
for (const [n, l] of Object.entries(agrupados)) console.log(`${n} ← ${l.length}: ${l.slice(0, 6).join(' | ')}${l.length > 6 ? ' …' : ''}`);
console.log(`Activos: ${CAT.length} · ocultos: ${salida.length - CAT.length} (${Object.values(agrupados).flat().length} agrupados en el catálogo)`);
if (!process.argv.includes('--dry')) {
  await sh.spreadsheets.values.update({ spreadsheetId: ID, range: `'App Productos'!A1:G1`, valueInputOption: 'RAW', requestBody: { values: [['nombre', 'precio', 'costo', 'activo', 'foto', 'colores', 'es']] } });
  await sh.spreadsheets.values.clear({ spreadsheetId: ID, range: `'App Productos'!A2:G` });
  await sh.spreadsheets.values.update({ spreadsheetId: ID, range: `'App Productos'!A2`, valueInputOption: 'RAW', requestBody: { values: salida } });
  console.log('✔ guardado');
}
