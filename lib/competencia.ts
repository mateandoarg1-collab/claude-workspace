import { google } from 'googleapis';
import { mlFetch } from '@/lib/ml';
import { getAuth } from '@/lib/sheets';
import competenciaConfig from '@/data/competencia.json';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const TAB = 'competencia_historial';

export type CompetenciaItemConfig = {
  vendedor: string;
  item_id: string;
  propio?: boolean;
  // Publicaciones ajenas a veces no se pueden leer con GET /items/{id} (ML
  // bloquea el detalle de items que no son propios). Si el item pertenece a
  // un producto de catálogo (buy box), se puede leer el precio vía
  // /products/{catalog_product_id}/items en su lugar.
  catalog_product_id?: string;
  url?: string;
};

export type CompetenciaGrupo = {
  grupo: string;
  items: CompetenciaItemConfig[];
};

export function loadConfig(): CompetenciaGrupo[] {
  return competenciaConfig as CompetenciaGrupo[];
}

type MLItem = {
  id: string;
  title: string;
  price: number;
  original_price: number | null;
  available_quantity: number;
  permalink: string;
};

type MLCatalogItem = {
  item_id: string;
  seller_id: number;
  price: number;
  original_price: number | null;
};

type MLCatalogItemsResponse = { results: MLCatalogItem[] };

export type CompetenciaSnapshotRow = {
  fecha: string;
  grupo: string;
  vendedor: string;
  item_id: string;
  precio: number;
  precio_original: number | null;
  disponible: number;
  titulo: string;
  permalink: string;
};

export type CompetenciaSnapshotError = {
  grupo: string;
  vendedor: string;
  item_id: string;
  error: string;
};

async function fetchOne(
  grupo: string,
  fecha: string,
  it: CompetenciaItemConfig,
): Promise<CompetenciaSnapshotRow> {
  if (it.catalog_product_id) {
    const data = await mlFetch<MLCatalogItemsResponse>(`/products/${it.catalog_product_id}/items`);
    const match = data.results.find((r) => r.item_id === it.item_id);
    if (!match) throw new Error(`item_id ${it.item_id} no está entre los vendedores del producto ${it.catalog_product_id}`);
    return {
      fecha,
      grupo,
      vendedor: it.vendedor,
      item_id: it.item_id,
      precio: match.price,
      precio_original: match.original_price ?? null,
      disponible: -1,
      titulo: `${grupo} (${it.vendedor})`,
      permalink: it.url ?? '',
    };
  }

  const data = await mlFetch<MLItem>(`/items/${it.item_id}`);
  return {
    fecha,
    grupo,
    vendedor: it.vendedor,
    item_id: it.item_id,
    precio: data.price,
    precio_original: data.original_price ?? null,
    disponible: data.available_quantity,
    titulo: data.title,
    permalink: data.permalink,
  };
}

export async function fetchSnapshot(): Promise<{
  rows: CompetenciaSnapshotRow[];
  errors: CompetenciaSnapshotError[];
}> {
  const fecha = new Date().toISOString().slice(0, 10);
  const grupos = loadConfig();
  const rows: CompetenciaSnapshotRow[] = [];
  const errors: CompetenciaSnapshotError[] = [];

  for (const g of grupos) {
    for (const it of g.items) {
      try {
        rows.push(await fetchOne(g.grupo, fecha, it));
      } catch (e: unknown) {
        errors.push({
          grupo: g.grupo,
          vendedor: it.vendedor,
          item_id: it.item_id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return { rows, errors };
}

export async function appendSnapshot(rows: CompetenciaSnapshotRow[]) {
  if (rows.length === 0) return;
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB}'!A1:I1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: rows.map((r) => [
        r.fecha,
        r.grupo,
        r.vendedor,
        r.item_id,
        r.precio,
        r.precio_original ?? '',
        r.disponible,
        r.titulo,
        r.permalink,
      ]),
    },
  });
}

export async function getHistory(): Promise<CompetenciaSnapshotRow[]> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB}'!A2:I100000`,
  });
  const values = res.data.values ?? [];
  return values
    .filter((r) => r[0])
    .map((r) => ({
      fecha: r[0],
      grupo: r[1],
      vendedor: r[2],
      item_id: r[3],
      precio: Number(r[4]) || 0,
      precio_original: r[5] ? Number(r[5]) : null,
      disponible: Number(r[6]) || 0,
      titulo: r[7] ?? '',
      permalink: r[8] ?? '',
    }));
}
