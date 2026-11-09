// Publica en el perfil personal de LinkedIn usando el token de ~/.claude/.linkedin.
//
// Uso:
//   node scripts/linkedin-post.mjs texto.txt                 → solo texto
//   node scripts/linkedin-post.mjs texto.txt foto.jpg        → texto + imagen
//   node scripts/linkedin-post.mjs texto.txt carrusel.pdf    → texto + documento (carrusel)
//   Agregar --dry para ver qué se publicaría sin publicar.

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { basename } from 'path';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const [textoPath, mediaPath] = args.filter((a) => a !== '--dry');
if (!textoPath) {
  console.log('Uso: node scripts/linkedin-post.mjs texto.txt [imagen.jpg|carrusel.pdf] [--dry]');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(`${homedir()}/.claude/.linkedin`, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
if (new Date(env.LINKEDIN_TOKEN_VENCE) < new Date()) {
  console.log('❌ El token venció. Correr: node scripts/linkedin-auth.mjs ' + env.LINKEDIN_CLIENT_ID);
  process.exit(1);
}

const H = {
  Authorization: `Bearer ${env.LINKEDIN_ACCESS_TOKEN}`,
  'LinkedIn-Version': '202510',
  'X-Restli-Protocol-Version': '2.0.0',
};
// La API de posts usa "little text": hay que escapar estos caracteres o se corta el texto.
const escapar = (t) => t.replace(/[\\|{}@\[\]()<>#*_~]/g, (c) => '\\' + c);
const texto = readFileSync(textoPath, 'utf8').trim();

if (dry) {
  console.log('--- Se publicaría ---\n' + texto + (mediaPath ? `\n[adjunto: ${mediaPath}]` : ''));
  process.exit(0);
}

async function subir(path) {
  const esPdf = path.toLowerCase().endsWith('.pdf');
  const tipo = esPdf ? 'documents' : 'images';
  const init = await fetch(`https://api.linkedin.com/rest/${tipo}?action=initializeUpload`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ initializeUploadRequest: { owner: env.LINKEDIN_PERSON_URN } }),
  });
  const j = await init.json();
  if (!j.value) throw new Error('initializeUpload: ' + JSON.stringify(j));
  const up = await fetch(j.value.uploadUrl, {
    method: 'PUT',
    headers: { Authorization: H.Authorization },
    body: readFileSync(path),
  });
  if (!up.ok) throw new Error(`upload ${up.status}: ${await up.text()}`);
  const id = j.value.image || j.value.document;
  return esPdf
    ? { media: { id, title: basename(path, '.pdf') } }
    : { media: { id } };
}

const body = {
  author: env.LINKEDIN_PERSON_URN,
  commentary: escapar(texto),
  visibility: 'PUBLIC',
  distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
  lifecycleState: 'PUBLISHED',
  isReshareDisabledByAuthor: false,
};
if (mediaPath) body.content = await subir(mediaPath);

const res = await fetch('https://api.linkedin.com/rest/posts', {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (res.status !== 201) {
  console.log(`❌ LinkedIn ${res.status}:`, await res.text());
  process.exit(1);
}
const urn = res.headers.get('x-restli-id');
console.log(`✅ Publicado: https://www.linkedin.com/feed/update/${urn}/`);
