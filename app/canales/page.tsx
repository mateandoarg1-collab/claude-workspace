'use client';

import { Fragment, useEffect, useState } from 'react';
import AppHeader from '../components/AppHeader';
import { EmpretiendaManual, fetchEmpretiendaManual } from '@/lib/manual';

const fmt = (n: number) => '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });

export default function Canales() {
  const [ml, setMl] = useState<{ orders: number; amount: number } | null>(null);
  const [mlErr, setMlErr] = useState('');
  const [mayorista, setMayorista] = useState<{ orders: number; amount: number; tab: string } | null>(null);
  const [mayoristaErr, setMayoristaErr] = useState('');
  const [shopify, setShopify] = useState<{ orders: number; amount: number } | null>(null);
  const [shopifyErr, setShopifyErr] = useState('');
  const [mp, setMp] = useState<{ orders: number; amount: number } | null>(null);
  const [mpErr, setMpErr] = useState('');
  const [comprobantes, setComprobantes] = useState<{ orders: number; amount: number } | null>(null);
  const [comprobantesErr, setComprobantesErr] = useState('');
  const [local, setLocal] = useState<{ orders: number; amount: number } | null>(null);
  const [localErr, setLocalErr] = useState('');
  const [manual, setManual] = useState<EmpretiendaManual | null>(null);

  useEffect(() => {
    fetch('/api/ml/sales', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setMl(d.month_to_date))
      .catch((e) => setMlErr(String(e)));

    fetch('/api/shopify', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.error ? setShopifyErr(d.error) : setShopify(d)))
      .catch((e) => setShopifyErr(String(e)));
    fetch('/api/mayorista', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.error ? setMayoristaErr(d.error) : setMayorista(d)))
      .catch((e) => setMayoristaErr(String(e)));

    fetch('/api/mercadopago/sales', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.error ? setMpErr(d.error) : setMp(d.month_to_date)))
      .catch((e) => setMpErr(String(e)));

    fetch('/api/comprobantes', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.error ? setComprobantesErr(d.error) : setComprobantes(d)))
      .catch((e) => setComprobantesErr(String(e)));

    fetch('/api/local', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.error ? setLocalErr(d.error) : setLocal(d)))
      .catch((e) => setLocalErr(String(e)));

    fetchEmpretiendaManual().then(setManual);
  }, []);

  const mpMonto = mp?.amount ?? 0;
  const mpCant = mp?.orders ?? 0;
  const compMonto = comprobantes?.amount ?? 0;
  const compCant = comprobantes?.orders ?? 0;
  const gocuotasMonto = manual?.gocuotasMonto ?? 0;
  const gocuotasCant = manual?.gocuotasCant ?? 0;

  const onlineMonto = mpMonto + compMonto + gocuotasMonto;
  const onlineCant = mpCant + compCant + gocuotasCant;

  // Si mateandobot ya subió Métricas de Empretienda de este mes: Acordar = Local, el resto = Online.
  const hoyAR = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const emp = manual?.metricas && manual.metricas.mes === hoyAR.slice(0, 7) ? manual.metricas : null;
  const empFuente = emp ? `Empretienda Métricas · ${new Date(emp.updatedAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '';

  const canales = emp ? [
    { nombre: 'Tienda Online (.com)', monto: emp.totalMonto - emp.acordarMonto, cantidad: emp.totalCant - emp.acordarCant, fuente: `${empFuente} (total − Acordar)` },
    { nombre: 'Mercado Libre', monto: ml?.amount ?? 0, cantidad: ml?.orders ?? 0, fuente: mlErr ? `Error: ${mlErr}` : 'API en vivo' },
    { nombre: 'Local Físico', monto: emp.acordarMonto, cantidad: emp.acordarCant, fuente: `${empFuente} (Acordar)` },
    { nombre: 'Shopify (mateando.com)', monto: shopify?.amount ?? 0, cantidad: shopify?.orders ?? 0, fuente: shopifyErr ? `Error: ${shopifyErr}` : 'API en vivo · pedidos pagados (subtotal con IVA)' },
    { nombre: 'Mayorista', monto: mayorista?.amount ?? 0, cantidad: mayorista?.orders ?? 0, fuente: mayoristaErr ? `Error: ${mayoristaErr}` : `Google Sheets (${mayorista?.tab ?? '—'})` },
  ] : [
    {
      nombre: 'Tienda Online (.com)', monto: onlineMonto, cantidad: onlineCant, fuente: 'MP + Transferencias + GOcuotas',
      sub: [
        { nombre: 'Mercado Pago', monto: mpMonto, cantidad: mpCant, fuente: mpErr ? `Error: ${mpErr}` : 'API en vivo' },
        { nombre: 'Transferencias (comprobantes)', monto: compMonto, cantidad: compCant, fuente: comprobantesErr ? `Error: ${comprobantesErr}` : 'Google Sheets en vivo' },
        { nombre: 'GOcuotas', monto: gocuotasMonto, cantidad: gocuotasCant, fuente: 'manual' },
      ],
    },
    { nombre: 'Mercado Libre', monto: ml?.amount ?? 0, cantidad: ml?.orders ?? 0, fuente: mlErr ? `Error: ${mlErr}` : 'API en vivo' },
    { nombre: 'Local Físico', monto: local?.amount ?? 0, cantidad: local?.orders ?? 0, fuente: localErr ? `Error: ${localErr}` : 'Cargado en /caja — en vivo' },
    { nombre: 'Shopify (mateando.com)', monto: shopify?.amount ?? 0, cantidad: shopify?.orders ?? 0, fuente: shopifyErr ? `Error: ${shopifyErr}` : 'API en vivo · pedidos pagados (subtotal con IVA)' },
    { nombre: 'Mayorista', monto: mayorista?.amount ?? 0, cantidad: mayorista?.orders ?? 0, fuente: mayoristaErr ? `Error: ${mayoristaErr}` : `Google Sheets (${mayorista?.tab ?? '—'})` },
  ];

  const totalGeneral = canales.reduce((s, c) => s + c.monto, 0);
  const totalVentas = canales.reduce((s, c) => s + c.cantidad, 0);

  return (
    <div className="min-h-screen bg-slate-950">
      <AppHeader title="Ventas por canal" width="5xl" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
          <h2 className="text-lg font-semibold mb-4">Mes en curso</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="py-2">Canal</th>
                <th className="text-right">Facturación</th>
                <th className="text-right">Ventas</th>
                <th className="hidden sm:table-cell text-right pl-4">Fuente</th>
              </tr>
            </thead>
            <tbody>
              {canales.map((c) => (
                <Fragment key={c.nombre}>
                  <tr className="border-t border-slate-900">
                    <td className="py-3 font-medium">
                      <span className="inline-flex items-center gap-2">
                        <img src={logoCanal(c.nombre)} alt="" className={`w-5 h-5 rounded object-contain p-0.5 ${logoCanal(c.nombre) === '/mate-logo.png' ? 'bg-emerald-700' : 'bg-white/90'}`} />
                        {c.nombre}
                      </span>
                      {c.fuente.startsWith('Error') && <div className="sm:hidden text-xs font-normal text-red-400">{c.fuente}</div>}
                    </td>
                    <td className="text-right tabular-nums">{fmt(c.monto)}</td>
                    <td className="text-right tabular-nums">{c.cantidad}</td>
                    <td className="hidden sm:table-cell text-right text-xs text-slate-500 pl-4">{c.fuente}</td>
                  </tr>
                  {c.sub?.map((s) => (
                    <tr key={c.nombre + '-' + s.nombre} className="text-slate-400">
                      <td className="py-1.5 pl-3 sm:pl-6 text-xs">
                        └ {s.nombre}
                        {s.fuente.startsWith('Error') && <div className="sm:hidden text-red-400">{s.fuente}</div>}
                      </td>
                      <td className="text-right tabular-nums text-xs">{fmt(s.monto)}</td>
                      <td className="text-right tabular-nums text-xs">{s.cantidad}</td>
                      <td className="hidden sm:table-cell text-right text-xs text-slate-500 pl-4">{s.fuente}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="border-t-2 border-slate-700 font-bold">
                <td className="py-3">Total</td>
                <td className="text-right tabular-nums">{fmt(totalGeneral)}</td>
                <td className="text-right tabular-nums">{totalVentas}</td>
                <td className="hidden sm:table-cell"></td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-slate-500 mt-3">
            Tienda Online y Local Físico salen de Métricas de Empretienda (Local = Acordar); las sube mateandobot solo, cada 30 min como mucho.
          </p>
        </section>
      </main>
    </div>
  );
}

function logoCanal(nombre: string) {
  if (nombre.startsWith('Tienda Online')) return '/canales/empretienda.png';
  if (nombre.startsWith('Shopify')) return '/canales/shopify.png';
  if (nombre.startsWith('Mercado Libre')) return '/canales/mercadolibre.png';
  return '/mate-logo.png';
}
