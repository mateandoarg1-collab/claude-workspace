// Monitor de stock en Mercado Libre Full.
// Lee el stock en los depósitos de Full, calcula el ritmo de venta de los
// últimos N días y avisa al grupo de WhatsApp (vía bot/wa.mjs) qué hay que reponer.
//
// Uso:
//   node scripts/full-stock.mjs            → reporte en consola + WhatsApp
//   node scripts/full-stock.mjs --dry      → solo consola, no manda nada
//
// Config: data/full-config.json. Credenciales: ~/.claude/.mercadolibre (vía
// ml-token.sh) y la sesión del bot en ~/.claude/.wa-bot-auth — nunca en el repo.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = homedir();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'data/full-config.json'), 'utf8'));
const DRY = process.argv.includes('--dry');

const ML_TOKEN = execSync(`bash ${HOME}/.claude/scripts/ml-token.sh`).toString().trim();
const ML_USER = '1136055893';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ml(path, tries = 4) {
  const res = await fetch(`https://api.mercadolibre.com${path}`, {
    headers: { Authorization: `Bearer ${ML_TOKEN}` },
  });
  if (res.status === 429 && tries > 0) {
    await sleep(2000);
    return ml(path, tries - 1);
  }
  if (!res.ok) throw new Error(`ML ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// --- 1. Publicaciones en Full (activas + pausadas: una pausada por falta de stock es la peor) ---
async function fullListings() {
  const ids = [];
  for (const status of ['active', 'paused']) {
    let scrollId = null;
    for (;;) {
      const q = scrollId ? `&scroll_id=${scrollId}` : '';
      const r = await ml(`/users/${ML_USER}/items/search?status=${status}&search_type=scan&limit=100${q}`);
      if (!r.results.length) break;
      ids.push(...r.results);
      scrollId = r.scroll_id;
    }
  }

  const units = []; // una fila por inventory_id (publicación o variante)
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20).join(',');
    const rows = await ml(
      `/items?ids=${chunk}&attributes=id,title,status,sub_status,inventory_id,user_product_id,shipping,variations,permalink`,
    );
    for (const { body: it } of rows) {
      if (it?.shipping?.logistic_type !== 'fulfillment') continue;
      if (it.variations?.length) {
        for (const v of it.variations) {
          if (!v.inventory_id) continue;
          const name = (v.attribute_combinations ?? []).map((a) => a.value_name).join(' / ');
          units.push({ item_id: it.id, variation_id: v.id, inventory_id: v.inventory_id, user_product_id: v.user_product_id, title: it.title, variant: name, status: it.status, sub_status: it.sub_status });
        }
      } else if (it.inventory_id) {
        units.push({ item_id: it.id, variation_id: null, inventory_id: it.inventory_id, user_product_id: it.user_product_id, title: it.title, variant: '', status: it.status, sub_status: it.sub_status });
      }
    }
  }
  return units;
}

// --- 2. Stock en Full por inventory_id ---
async function fullStock(inventoryId) {
  const s = await ml(`/inventories/${inventoryId}/stock/fulfillment`);
  const notAvail = Object.fromEntries((s.not_available_detail ?? []).map((d) => [d.status, d.quantity]));
  return { available: s.available_quantity ?? 0, total: s.total ?? 0, notAvail };
}

// Stock propio (depósito del vendedor, vende por Flex/ME2) para publicaciones híbridas
async function ownStock(userProductId) {
  if (!userProductId) return 0;
  try {
    const s = await ml(`/user-products/${userProductId}/stock`);
    return (s.locations ?? []).filter((l) => l.type === 'selling_address').reduce((a, l) => a + l.quantity, 0);
  } catch {
    return 0;
  }
}

// --- 3. Ventas de los últimos N días, contadas por item/variante ---
async function salesByUnit(days) {
  const from = new Date(Date.now() - days * 864e5).toISOString().replace('Z', '-00:00');
  const sold = new Map();
  let offset = 0;
  for (;;) {
    const r = await ml(
      `/orders/search?seller=${ML_USER}&order.status=paid&order.date_created.from=${encodeURIComponent(from)}&sort=date_desc&limit=50&offset=${offset}`,
    );
    for (const o of r.results) {
      for (const oi of o.order_items) {
        const k = `${oi.item.id}|${oi.item.variation_id ?? ''}`;
        sold.set(k, (sold.get(k) ?? 0) + oi.quantity);
      }
    }
    offset += 50;
    if (offset >= r.paging.total || offset >= 10000) break;
  }
  return sold;
}

// --- 4. Clasificación ---
function classify(u, cfg) {
  const perDay = u.sold / cfg.dias_ventas;
  const days = perDay > 0 ? u.available / perDay : Infinity;
  const suggest = Math.max(0, Math.ceil(perDay * cfg.dias_cobertura - u.available));
  let level;
  if (u.available === 0 && u.sold > 0) level = u.own > 0 ? 'full_vacio' : 'sin_stock';
  else if (days <= cfg.dias_reposicion) level = 'rojo';
  else if (days <= cfg.dias_alerta) level = 'amarillo';
  else level = 'ok';
  return { ...u, perDay, days, suggest, level };
}

function fmtDays(d) {
  return d === Infinity ? '∞' : `${Math.floor(d)}d`;
}

function buildMessage(rows, cfg) {
  const name = (r) => `${r.title.slice(0, 60)}${r.variant ? ` (${r.variant})` : ''}`;
  const by = (lvl) => rows.filter((r) => r.level === lvl).sort((a, b) => a.days - b.days);
  const out = [`📦 *Stock Full MATEANDO* — ${new Date().toLocaleDateString('es-AR')}`];

  const sections = [
    ['sin_stock', '⛔ *CORTADO* (0 en Full y 0 en depósito)'],
    ['full_vacio', '🟠 *Full en 0* (vende desde depósito propio, sin envío Full)'],
    ['rojo', `🔴 *Mandar YA* (≤${cfg.dias_reposicion} días)`],
    ['amarillo', `🟡 *Preparar envío* (≤${cfg.dias_alerta} días)`],
  ];
  for (const [lvl, head] of sections) {
    const list = by(lvl);
    if (!list.length) continue;
    out.push('', head);
    for (const r of list) {
      const own = r.own ? ` (+${r.own} depósito)` : '';
      out.push(`• ${name(r)}\n   Full ${r.available}${own} · vende ${r.perDay.toFixed(1)}/día · ${fmtDays(r.days)} → mandar *${r.suggest}*`);
    }
  }

  const stuck = rows.filter((r) => Object.keys(r.notAvail).length);
  if (stuck.length) {
    out.push('', '⚠️ *Stock no disponible en Full*');
    for (const r of stuck) {
      const det = Object.entries(r.notAvail).map(([k, v]) => `${k}: ${v}`).join(', ');
      out.push(`• ${name(r)} — ${det}`);
    }
  }

  const ok = by('ok').length;
  if (out.length === 1) out.push('', `✅ Todo OK: ${ok} publicaciones en Full con más de ${cfg.dias_alerta} días de stock.`);
  else out.push('', `✅ ${ok} publicaciones OK`);
  return out.join('\n');
}

// --- 5. WhatsApp: el bot (número propio, bot/wa.mjs) lo manda al grupo ---
function sendWhatsApp(text, cfg) {
  execSync(`node ${join(ROOT, 'bot/wa.mjs')} send ${cfg.whatsapp_group_id}`, { input: text, stdio: ['pipe', 'inherit', 'inherit'] });
}

// --- main ---
const units = await fullListings();
const sold = await salesByUnit(CONFIG.dias_ventas);
const rows = [];
for (const u of units) {
  const s = await fullStock(u.inventory_id);
  s.own = await ownStock(u.user_product_id);
  const k = `${u.item_id}|${u.variation_id ?? ''}`;
  rows.push(classify({ ...u, ...s, sold: sold.get(k) ?? 0 }, CONFIG));
}

const msg = buildMessage(rows, CONFIG);
console.log(msg);
console.log(`\n(${rows.length} unidades en Full revisadas)`);

if (!DRY && CONFIG.whatsapp_group_id) sendWhatsApp(msg, CONFIG);
else if (!DRY) console.log('\nSin whatsapp_group_id en data/full-config.json — no se envió nada.');
