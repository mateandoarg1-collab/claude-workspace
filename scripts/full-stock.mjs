// Monitor de stock en Mercado Libre Full.
// Lee el stock en los depósitos de Full, calcula el ritmo de venta de los
// últimos N días y arma un reporte (mail + PDF) de qué hay que reponer.
//
// Uso:
//   node scripts/full-stock.mjs              → solo reporte en consola
//   node scripts/full-stock.mjs --mail       → PDF en ~/Downloads/Stock Full + mail a mail_to
//   node scripts/full-stock.mjs --pdf x.pdf  → solo genera el PDF
//   node scripts/full-stock.mjs --whatsapp   → manda el resumen al grupo vía bot/wa.mjs
//
// Config: data/full-config.json. Credenciales: ~/.claude/.mercadolibre (vía
// ml-token.sh), ~/.claude/.gmail-smtp y ~/.claude/.wa-bot-auth — nunca en el repo.

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = homedir();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'data/full-config.json'), 'utf8'));
const MAIL = process.argv.includes('--mail');
const WHATSAPP = process.argv.includes('--whatsapp');
const argVal = (flag) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : null);
const HTML_OUT = argVal('--html');
const PDF_OUT = argVal('--pdf'); // PDF para reenviar al grupo de WhatsApp

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

const pic = (id) => (id ? `https://http2.mlstatic.com/D_${id}-O.jpg` : '');

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
      `/items?ids=${chunk}&attributes=id,title,status,sub_status,inventory_id,user_product_id,shipping,variations,permalink,thumbnail_id`,
    );
    for (const { body: it } of rows) {
      if (it?.shipping?.logistic_type !== 'fulfillment') continue;
      if (it.variations?.length) {
        for (const v of it.variations) {
          if (!v.inventory_id) continue;
          const name = (v.attribute_combinations ?? []).map((a) => a.value_name).join(' / ');
          const thumb = pic(v.picture_ids?.[0] ?? it.thumbnail_id);
          units.push({ item_id: it.id, variation_id: v.id, inventory_id: v.inventory_id, user_product_id: v.user_product_id, title: it.title, variant: name, status: it.status, sub_status: it.sub_status, permalink: it.permalink, thumbnail: thumb });
        }
      } else if (it.inventory_id) {
        units.push({ item_id: it.id, variation_id: null, inventory_id: it.inventory_id, user_product_id: it.user_product_id, title: it.title, variant: '', status: it.status, sub_status: it.sub_status, permalink: it.permalink, thumbnail: pic(it.thumbnail_id) });
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
  if (u.available === 0 && u.sold > 0) level = 'sin_stock';
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
    ['sin_stock', '⛔ *Quebró stock en Full*'],
    ['rojo', `🔴 *Mandar YA* (≤${cfg.dias_reposicion} días)`],
    ['amarillo', `🟡 *Preparar envío* (≤${cfg.dias_alerta} días)`],
  ];
  for (const [lvl, head] of sections) {
    const list = by(lvl);
    if (!list.length) continue;
    out.push('', head);
    for (const r of list) {
      out.push(`• ${name(r)}\n   Full ${r.available} · vende ${r.perDay.toFixed(1)}/día · ${fmtDays(r.days)} → mandar *${r.suggest}*`);
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

// --- 4b. Mail HTML para depósito: foto + MLA por publicación, agrupado por urgencia ---
function buildHtml(rows, cfg) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const td = 'style="padding:6px 8px;border-bottom:1px solid #eee;vertical-align:middle"';
  const th = 'style="padding:6px 8px;background:#f4f4f4;text-align:left;font-size:12px"';
  const row = (r, extra) => `<tr>
<td ${td}><a href="${r.permalink}"><img src="${r.thumbnail}" width="64" height="64" style="object-fit:contain;border:1px solid #ddd;border-radius:4px"></a></td>
<td ${td}><a href="${r.permalink}" style="color:#3483fa;font-weight:bold;text-decoration:none">${r.item_id}</a><br>${esc(r.title)}${r.variant ? `<br><b>${esc(r.variant)}</b>` : ''}</td>
${extra}</tr>`;
  const num = (v, bold) => `<td ${td} align="center">${bold ? `<b style="font-size:16px">${v}</b>` : v}</td>`;
  const table = (list, head, cells) =>
    `<table cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px"><tr><th ${th}>Foto</th><th ${th}>Publicación</th>${head.map((h) => `<th ${th}>${h}</th>`).join('')}</tr>${list.map((r) => row(r, cells(r))).join('')}</table>`;
  const section = (color, title, sub, list, head, cells) =>
    list.length
      ? `<h3 style="color:${color};margin:24px 0 2px">${title} (${list.length})</h3><p style="color:#666;margin:0 0 8px;font-size:12px">${sub}</p>${table(list, head, cells)}`
      : '';
  const byDays = (a, b) => a.days - b.days || b.perDay - a.perDay;

  const quebro = rows.filter((r) => r.level === 'sin_stock').sort((a, b) => b.perDay - a.perDay);
  const rojo = rows.filter((r) => r.level === 'rojo').sort(byDays);
  const amarillo = rows.filter((r) => r.level === 'amarillo').sort(byDays);
  const ok = rows.filter((r) => r.level === 'ok').sort(byDays);
  const aMandar = [...quebro, ...rojo, ...amarillo];
  const totalUnidades = aMandar.reduce((a, r) => a + r.suggest, 0);
  const stuck = rows.filter((r) => Object.keys(r.notAvail).length);
  const urgentCells = (r) => num(r.available) + num(r.perDay.toFixed(1)) + num(r.suggest, true) + `<td ${td} align="center" style="font-size:18px">☐</td>`;
  const urgentHead = ['Full', 'Vende/día', `Mandar (${cfg.dias_cobertura} días)`, 'Armado'];
  const daysCells = (r) => num(r.available) + num(Math.floor(r.days)) + num(r.perDay.toFixed(1)) + num(r.suggest, true) + `<td ${td} align="center" style="font-size:18px">☐</td>`;
  const daysHead = ['Full', 'Días', 'Vende/día', `Mandar (${cfg.dias_cobertura} días)`, 'Armado'];

  return `<div style="font-family:Arial,sans-serif;color:#222;max-width:760px">
<h2 style="margin:0">📦 Stock en Full — ${new Date().toLocaleDateString('es-AR')}</h2>
<p style="color:#555;margin:6px 0 0">A armar: <b>${aMandar.length} publicaciones · ${totalUnidades} unidades</b> · ${ok.length} OK.<br>
<span style="font-size:12px;color:#888">"Mandar" = unidades para tener ${cfg.dias_cobertura} días de venta en Full (ritmo de los últimos ${cfg.dias_ventas} días, descontando lo que ya hay en Full). Tocá la foto o el MLA para abrir la publicación.</span></p>
${section('#b00020', '⛔ Quebró stock en Full', 'Sin unidades en Full y con ventas en los últimos días.', quebro, urgentHead, urgentCells)}
${section('#c0392b', '🔴 Por quebrar — mandar YA', `Menos de ${cfg.dias_reposicion} días de stock en Full.`, rojo, daysHead, daysCells)}
${section('#b7950b', '🟡 Próximo a quebrar — preparar', `Entre ${cfg.dias_reposicion} y ${cfg.dias_alerta} días de stock en Full.`, amarillo, daysHead, daysCells)}
${section('#27ae60', '✅ Está bien', `Más de ${cfg.dias_alerta} días de stock en Full.`, ok, ['Full', 'Días', 'Vende/día'], (r) => num(r.available) + num(r.days === Infinity ? 'sin ventas' : Math.floor(r.days)) + num(r.perDay.toFixed(1)))}
${stuck.length ? `<h3 style="margin:24px 0 6px">⚠️ Unidades no disponibles en Full (reclamar en ML)</h3><ul style="font-size:13px">${stuck.map((r) => `<li><a href="${r.permalink}">${r.item_id}</a> ${esc(r.title)} — ${Object.entries(r.notAvail).map(([k, v]) => `${k}: ${v}`).join(', ')}</li>`).join('')}</ul>` : ''}
</div>`;
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
  const k = `${u.item_id}|${u.variation_id ?? ''}`;
  rows.push(classify({ ...u, ...s, sold: sold.get(k) ?? 0 }, CONFIG));
}

const msg = buildMessage(rows, CONFIG);
console.log(msg);
console.log(`\n(${rows.length} unidades en Full revisadas)`);
if (HTML_OUT) {
  writeFileSync(HTML_OUT, buildHtml(rows, CONFIG));
  console.log(`HTML guardado en ${HTML_OUT}`);
}

function makePdf(path) {
  const tmp = `${path}.html`;
  writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:12mm} body{margin:0} tr{page-break-inside:avoid}</style>${buildHtml(rows, CONFIG)}`);
  execSync(`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --no-pdf-header-footer --virtual-time-budget=15000 --print-to-pdf="${path}" "file://${tmp}"`, { stdio: 'ignore' });
  unlinkSync(tmp);
  console.log(`PDF guardado en ${path}`);
}

// Mail con el reporte en el cuerpo + PDF adjunto (para reenviar al grupo de WhatsApp).
// Sale por SMTP de Gmail con contraseña de aplicación guardada en ~/.claude/.gmail-smtp.
function sendMail(pdfPath, cfg) {
  const creds = Object.fromEntries(
    readFileSync(join(HOME, '.claude/.gmail-smtp'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
  const b64 = (t) => Buffer.from(t).toString('base64');
  const wrap = (t) => t.replace(/.{1,76}/g, '$&\r\n');
  const boundary = `mateando-${Date.now()}`;
  const fecha = new Date().toLocaleDateString('es-AR');
  const mime = [
    `From: Stock Full MATEANDO <${creds.GMAIL_USER}>`,
    `To: ${cfg.mail_to.join(', ')}`,
    `Subject: =?UTF-8?B?${b64(`📦 Stock Full MATEANDO — ${fecha}`)}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(buildHtml(rows, cfg))),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${basename(pdfPath)}"`,
    `Content-Disposition: attachment; filename="${basename(pdfPath)}"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap(readFileSync(pdfPath).toString('base64')),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  const mimePath = `${pdfPath}.eml`;
  writeFileSync(mimePath, mime);
  // credenciales por stdin (-K -) para que no queden a la vista en la lista de procesos
  const curlCfg = [
    `url = "smtps://smtp.gmail.com:465"`,
    `user = "${creds.GMAIL_USER}:${creds.GMAIL_APP_PASSWORD.replace(/\s/g, '')}"`,
    `mail-from = "${creds.GMAIL_USER}"`,
    ...cfg.mail_to.map((r) => `mail-rcpt = "${r}"`),
    `upload-file = "${mimePath}"`,
    'ssl-reqd',
    'silent',
    'show-error',
  ].join('\n');
  try {
    execSync('curl -K -', { input: curlCfg, stdio: ['pipe', 'inherit', 'inherit'] });
    console.log(`Mail enviado a ${cfg.mail_to.join(', ')}`);
  } finally {
    unlinkSync(mimePath);
  }
}

if (PDF_OUT) makePdf(PDF_OUT);

if (MAIL) {
  const dir = join(HOME, 'Downloads/Stock Full');
  mkdirSync(dir, { recursive: true });
  const d = new Date();
  const pdf = join(dir, `Stock-Full-Mateando-${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}.pdf`);
  makePdf(pdf);
  sendMail(pdf, CONFIG);
}

if (WHATSAPP && CONFIG.whatsapp_group_id) sendWhatsApp(msg, CONFIG);
