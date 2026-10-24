import { google } from 'googleapis';

// GA4 de la tienda Empretienda (cuenta MATEANDOARG, propiedad "MATEANDOARG"). La cuenta de servicio es Lector.
// En la misma propiedad cae algo de tráfico de Shopify (/collections…): se filtra por dominio.
const PROPERTY = 'properties/274384165';
const HOSTS = ['www.mateandoarg.com', 'mateandoarg.com'];

function auth() {
  const scopes = ['https://www.googleapis.com/auth/analytics.readonly'];
  return process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    ? new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY), scopes })
    : new google.auth.GoogleAuth({ keyFile: '/Users/jpcipolletta/.claude/.mateando-credentials.json', scopes });
}

type Filtro = Record<string, unknown>; // FilterExpression de GA4 (filter, notExpression…)
const host: Filtro = { filter: { fieldName: 'hostName', inListFilter: { values: HOSTS } } };
export const evento = (nombre: string): Filtro => ({ filter: { fieldName: 'eventName', stringFilter: { value: nombre } } });
export const pagina = (regex: string): Filtro => ({ filter: { fieldName: 'pagePath', stringFilter: { matchType: 'FULL_REGEXP', value: regex } } });

export type Fila = { dims: string[]; vals: number[] };

// runReport con el filtro de dominio siempre puesto. Fechas YYYY-MM-DD (hora AR, que es la zona de la propiedad).
export async function reporte(opts: {
  desde: string;
  hasta: string;
  dims?: string[];
  metricas: string[];
  filtros?: Filtro[];
  orden?: { dim?: string; metrica?: string; desc?: boolean };
  limite?: number;
}): Promise<Fila[]> {
  const ga = google.analyticsdata({ version: 'v1beta', auth: auth() });
  const { orden } = opts;
  const r = await ga.properties.runReport({
    property: PROPERTY,
    requestBody: {
      dateRanges: [{ startDate: opts.desde, endDate: opts.hasta }],
      dimensions: (opts.dims ?? []).map((name) => ({ name })),
      metrics: opts.metricas.map((name) => ({ name })),
      dimensionFilter: { andGroup: { expressions: [host, ...(opts.filtros ?? [])] } },
      orderBys: orden
        ? [orden.dim ? { dimension: { dimensionName: orden.dim }, desc: orden.desc } : { metric: { metricName: orden.metrica }, desc: orden.desc ?? true }]
        : undefined,
      limit: String(opts.limite ?? 1000),
    },
  });
  return (r.data.rows ?? []).map((row) => ({
    dims: (row.dimensionValues ?? []).map((d) => d.value ?? ''),
    vals: (row.metricValues ?? []).map((m) => Number(m.value) || 0),
  }));
}
