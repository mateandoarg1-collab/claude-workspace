// TikTok Ads: cambia el auth_code (lo da el "Advertiser authorization URL" de la app "Mateando Dashboard"
// en business-api.tiktok.com/portal) por el access token de largo plazo (no vence) y lo guarda en
// ~/.claude/.tiktok (fuera del repo). El auth_code vence a la hora y se usa una sola vez.
//
// Uso: node scripts/tiktok-auth.mjs <app_id> <secret> <auth_code o el link entero del redirect>

import { writeFileSync } from 'fs';
import { homedir } from 'os';

const [appId, secret, codeOLink] = process.argv.slice(2);
if (!appId || !secret || !codeOLink) {
  console.log('Uso: node scripts/tiktok-auth.mjs <app_id> <secret> <auth_code o link>');
  process.exit(1);
}
const authCode = codeOLink.includes('auth_code=') ? new URL(codeOLink).searchParams.get('auth_code') : codeOLink;

const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ app_id: appId, secret, auth_code: authCode }),
});
const j = await res.json();
if (j.code !== 0) {
  console.log('❌ TikTok:', j.message);
  process.exit(1);
}
const { access_token, advertiser_ids = [] } = j.data;
writeFileSync(
  `${homedir()}/.claude/.tiktok`,
  `# TikTok Ads (app "Mateando Dashboard"). Token de largo plazo, no vence.\nTIKTOK_APP_ID=${appId}\nTIKTOK_ACCESS_TOKEN=${access_token}\nTIKTOK_ADVERTISER_ID=${advertiser_ids[0] ?? ''}\n`,
  { mode: 0o600 },
);
console.log('✅ Token guardado en ~/.claude/.tiktok');
console.log('   Cuentas autorizadas:', advertiser_ids.join(', ') || '(ninguna)');
