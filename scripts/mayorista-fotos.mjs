// Pone foto (columna E de "App Productos") a los productos mayoristas, tomándola de las fotos de Shopify por reglas de
// nombre. Solo completa los que no tienen foto (las subidas a mano desde la app no se pisan). Uso: node scripts/mayorista-fotos.mjs [--dry]
import { google } from 'googleapis';

const ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const CDN = 'https://cdn.shopify.com/s/files/1/0667/1443/5655/files/';
// [regla sobre el nombre (sin acentos, minúsculas), foto]. La primera que coincide gana.
const REGLAS = [
  [/caja de regalo/, 'cajaDeRegalo_da7e8660-1641-4018-8d6f-cf0bcebf8f0b.jpg?v=1782321892'],
  [/bombillon/, 'bombillondeluxe-bombillapicoloro-bombilla.jpg?v=1780360758'],
  [/bombilla/, 'bombillapicoloro-bombilla-bombilla1.jpg?v=1779929982'],
  [/autocebante/, 'autocebante-mateando-2.jpg?v=1783483588'],
  [/simil|gota|acero mateando|mate acero|acero termico/, 'MateSIMILnegroacero_2.jpg?v=1789144472'],
  [/flow/, 'DSC02924_2.jpg?v=1789153849'],
  [/stanley|mate system|pico cebador/, 'picocebador2.jpg?v=1777920836'],
  [/media manija/, 'termomediamanija-termo-2.jpg?v=1779927061'],
  [/termo.*750|750.*termo/, 'TERMOMATEANDO-TERMO750MLTEMRONEGOR.jpg?v=1780012838'],
  [/termo/, 'TERMOMATEANDO-TERMO1LT-TERMOPICOCEBADOR-TERMO1LT.jpg?v=1780013318'],
  [/camionero.*encerado/, 'matedealgarrobo-encerado-mate2.jpg?v=1779908828'],
  [/camionero.*(premium|calabaza)/, 'mateacamionero-matecalabaza-matecuero.jpg?v=1780017265'],
  [/camionero.*ceramica/, 'Matecamionero-mateceramica-mateando.jpg?v=1780016218'],
  [/camionero/, 'matedealgarrobo-matealgarrobo.jpg?v=1779904661'],
  [/imperial.*(forrado|cuero)/, 'imperial-algarrobo-mateimperial.jpg?v=1779943604'],
  [/imperial.*encerado/, 'IMPERIAL-MADERA-ABAS.jpg?v=1779906539'],
  [/imperial.*(premium|calabaza|pampa|abstracta)/, 'IMPERIALPAMPA-MATEIMPERIAL-MATE.jpg?v=1780026732'],
  [/imperial.*acero|imperial.*deluxe/, 'IMPERIALACERO-MATEANDO-MATE.jpg?v=1780009574'],
  [/imperial/, 'mateimperial-matemadera-mateimperialalgarrobo.jpg?v=1779905933'],
  [/torpedo/, 'torpedoalgarrobo-mateandotorpedo.jpg?v=1782778963'],
  [/ranchero|vaca|muu/, 'matevacaranchero-matemuu-matevaca.jpg?v=1779907926'],
  [/criollo/, 'matecriollo-mateando-mates-mate.jpg?v=1779930685'],
  [/sol de mayo/, 'MATESOLDEMAYO-MATEANDO-MATES-23.jpg?v=1779942870'],
  [/mochila.*camufl/, 'mochilacamuflada-mateando.jpg?v=1783384271'],
  [/mochila/, 'mochilmatera-mate-mochilamateando-matera-mochila-2-2.png?v=1779921967'],
  [/2x2/, 'matera2x2-mateando-mates.jpg?v=1780454078'],
  [/matera.*eco|eco ?cuero/, 'materaecocuero-matera-mateando.jpg?v=1779905427'],
  [/capri/, 'bolsomaterocapri-mateando.jpg?v=1779910084'],
  [/tote/, 'totematera-mateandotote.jpg?v=1779909557'],
  [/matera|canasta/, 'materacuero-negro.jpg?v=1780452183'],
  [/set.*(yerbera|lata)|azucarera|lata/, 'setyerbera-matenado-mate.jpg?v=1780430100'],
  [/yerbera.*gamuza|gamuza/, 'yerbera-yerbergamuza-yerbera.jpg?v=1778125116'],
  [/yerbera.*lona/, 'yerberalona-yerbera-yerberamateando.jpg?v=1780362606'],
  [/yerbera/, 'YERBERACUERO-MATEANDO-MATES.jpg?v=1780008344'],
  [/canarias.*serena/, 'yerbacanarias-yerbaserena-yerba.jpg?v=1780373307'],
  [/canarias.*500/, 'canarias-500gr-yerbacanarias.jpg?v=1783381387'],
  [/canarias/, 'yerba1kg-canarias.jpg?v=1780364967'],
  [/tapa ?mate|tapa ?bombi/, 'KITAPAMATEYBOMBI-TAPAMATE.jpg?v=1780009335'],
  [/luz/, 'LUZMATE-MATE-LUZMATE.jpg?v=1779935682'],
  [/despolvillador/, 'despolvillador-mateando-mate.jpg?v=1782784152'],
  [/limpia/, 'LIMPIABOMBILLA-MATEANDO-MATE-1_ce5e6f5c-5fae-4307-bbb6-72b6d3b43b9c.jpg?v=1779943343'],
  [/almohad/, 'almhoadamatera-mateando-almohadon.jpg?v=1779937941'],
  [/portamate|rutero/, 'portamatenegro-portamateruteronegro.jpg?v=1780366414'],
];
// sin acentos + abreviaturas del Excel (impe, camio, vaquita…)
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\bimpe\b/g, 'imperial').replace(/\bcamio\b/g, 'camionero').replace(/vaquita|rachero/g, 'ranchero')
  .replace(/system \d+/g, 'mate system').replace(/^caja (chica|xl)/, 'caja de regalo').replace(/serena|te verde/g, 'canarias serena');

const auth = new google.auth.GoogleAuth({ keyFile: `${process.env.HOME}/.claude/.mateando-credentials.json`, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sh = google.sheets({ version: 'v4', auth });
const filas = (await sh.spreadsheets.values.get({ spreadsheetId: ID, range: `'App Productos'!A1:E` })).data.values ?? [];
if (filas[0]?.[4] !== 'foto') filas[0] = ['nombre', 'precio', 'costo', 'activo', 'foto'];
let puestas = 0, sin = [];
const col = filas.map((f, i) => {
  if (i === 0) return ['foto'];
  if (f[4]) return [f[4]];
  const r = REGLAS.find(([re]) => re.test(norm(f[0])));
  if (r) { puestas++; return [CDN + r[1]]; }
  sin.push(f[0]); return [''];
});
console.log(`Con foto nueva: ${puestas} · sin foto: ${sin.length}`);
console.log('Sin foto:', sin.join(' | '));
if (!process.argv.includes('--dry')) {
  await sh.spreadsheets.values.update({ spreadsheetId: ID, range: `'App Productos'!E1:E${col.length}`, valueInputOption: 'RAW', requestBody: { values: col } });
  console.log('✔ guardado');
}
