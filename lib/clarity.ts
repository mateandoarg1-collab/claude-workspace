// Cliente de Microsoft Clarity Data Export API.
// Solo da métricas agregadas de los últimos 1-3 días (límite de la API, no nuestro).

type ClarityMetric = { metricName: string; information: Record<string, unknown>[] };

export type ClarityInsights = {
  days: number;
  traffic: { sessions: number; users: number; botSessions: number; pagesPerSession: number };
  engagement: { totalTimeSec: number; activeTimeSec: number; avgScrollDepth: number };
  issues: {
    deadClick: { pct: number; count: number };
    rageClick: { pct: number; count: number };
    scriptError: { pct: number; count: number };
    quickback: { pct: number; count: number };
  };
  topPages: { url: string; visits: number }[];
  pageTitles: { name: string; sessions: number }[];
  devices: { name: string; sessions: number }[];
  os: { name: string; sessions: number }[];
  browsers: { name: string; sessions: number }[];
  referrers: { name: string; sessions: number }[];
};

function metricOf(data: ClarityMetric[], name: string) {
  return data.find((m) => m.metricName === name)?.information ?? [];
}

export async function getClarityInsights(days: 1 | 2 | 3 = 3): Promise<ClarityInsights> {
  const token = process.env.CLARITY_API_TOKEN;
  if (!token) throw new Error('Falta CLARITY_API_TOKEN');

  const url = new URL('https://www.clarity.ms/export-data/api/v1/project-live-insights');
  url.searchParams.set('numOfDays', String(days));

  // Clarity limita a ~10 consultas/día por proyecto. Cacheamos cada ventana (1/2/3 días)
  // por separado, así el equipo puede entrar todo el día sin agotar la cuota.
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 28800 } });
  if (res.status === 429) {
    throw new Error('Se alcanzó el límite diario de consultas a Clarity (~10/día). Los datos vuelven a actualizarse mañana; mientras tanto se puede ver todo en clarity.microsoft.com.');
  }
  if (!res.ok) throw new Error(`Clarity API ${res.status}: ${await res.text()}`);

  const data: ClarityMetric[] = await res.json();

  const traffic = metricOf(data, 'Traffic')[0] as Record<string, number> | undefined;
  const engagement = metricOf(data, 'EngagementTime')[0] as Record<string, number> | undefined;
  const scroll = metricOf(data, 'ScrollDepth')[0] as Record<string, number> | undefined;

  const issue = (name: string) => {
    const row = metricOf(data, name)[0] as Record<string, number> | undefined;
    return { pct: row?.sessionsWithMetricPercentage ?? 0, count: row?.subTotal ?? 0 };
  };

  return {
    days,
    traffic: {
      sessions: traffic?.totalSessionCount ?? 0,
      users: traffic?.distinctUserCount ?? 0,
      botSessions: traffic?.totalBotSessionCount ?? 0,
      pagesPerSession: traffic?.pagesPerSessionPercentage ?? 0,
    },
    engagement: {
      totalTimeSec: engagement?.totalTime ?? 0,
      activeTimeSec: engagement?.activeTime ?? 0,
      avgScrollDepth: scroll?.averageScrollDepth ?? 0,
    },
    issues: {
      deadClick: issue('DeadClickCount'),
      rageClick: issue('RageClickCount'),
      scriptError: issue('ScriptErrorCount'),
      quickback: issue('QuickbackClick'),
    },
    topPages: (metricOf(data, 'PopularPages') as { url: string; visitsCount: number }[]).map((p) => ({
      url: p.url,
      visits: p.visitsCount,
    })),
    pageTitles: (metricOf(data, 'PageTitle') as { name: string; sessionsCount: number }[]).map((p) => ({
      name: p.name,
      sessions: p.sessionsCount,
    })),
    devices: (metricOf(data, 'Device') as { name: string; sessionsCount: number }[]).map((d) => ({
      name: d.name,
      sessions: d.sessionsCount,
    })),
    os: (metricOf(data, 'OS') as { name: string; sessionsCount: number }[]).map((d) => ({
      name: d.name,
      sessions: d.sessionsCount,
    })),
    browsers: (metricOf(data, 'Browser') as { name: string; sessionsCount: number }[]).map((d) => ({
      name: d.name,
      sessions: d.sessionsCount,
    })),
    referrers: (metricOf(data, 'ReferrerUrl') as { name: string | null; sessionsCount: number }[])
      .filter((r) => r.name)
      .map((r) => ({ name: r.name as string, sessions: r.sessionsCount })),
  };
}
