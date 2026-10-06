import { readFileSync } from 'fs';
import { homedir } from 'os';

const raw = readFileSync(`${homedir()}/.claude/.mercadopago`, 'utf-8');
const token = raw.match(/MERCADOPAGO_ACCESS_TOKEN=(.+)/)?.[1]?.trim();

if (!token) {
  console.error('❌ No se encontró MERCADOPAGO_ACCESS_TOKEN en ~/.claude/.mercadopago');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${token}` };

const me = await fetch('https://api.mercadopago.com/users/me', { headers });
if (!me.ok) {
  console.error(`❌ Mercado Pago API error ${me.status}:`, await me.text());
  process.exit(1);
}
const user = await me.json();
console.log(`✅ Mercado Pago OK — cuenta ${user.nickname} (id ${user.id})\n`);

const url = new URL('https://api.mercadopago.com/v1/payments/search');
url.searchParams.set('sort', 'date_created');
url.searchParams.set('criteria', 'desc');
url.searchParams.set('limit', '10');

const res = await fetch(url, { headers });
if (!res.ok) {
  console.error(`❌ payments/search error ${res.status}:`, await res.text());
  process.exit(1);
}

const { results } = await res.json();
console.log('Últimos 10 pagos:');
for (const p of results) {
  console.log(`  ${p.date_created.slice(0, 16)}  ${p.operation_type.padEnd(16)} ${p.status.padEnd(10)} $${p.transaction_amount}`);
}
