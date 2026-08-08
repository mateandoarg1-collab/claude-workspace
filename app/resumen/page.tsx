'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchEmpretiendaManual, splitEmpretienda } from '@/lib/manual';

const fmtM = (n: number) => {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'K';
  return '$' + n.toFixed(0);
};
const fmtFull = (n: number) => '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
type Sum = { orders: number; amount: number };

export default function Resumen() {
  const [ml, setMl] = useState<{ month_to_date: Sum } | null>(null);
  const [mayorista, setMayorista] = useState<{ orders: number; amount: number } | null>(null);
  const [mp, setMp] = useState({ orders: 0, amount: 0 });
  const [comprobantes, setComprobantes] = useState({ orders: 0, amount: 0 });
  const [online, setOnline] = useState({ monto: 0, cant: 0 });
  const [local, setLocal] = useState({ monto: 0, cant: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/ml/sales', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/mayorista', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/mercadopago/sales', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/comprobantes', { cache: 'no-store' }).then((r) => r.json()),
      fetchEmpretiendaManual(),
    ]).then(([mlData, mayoristaData, mpData, compData, manual]) => {
      setMl(mlData);
      if (!mayoristaData.error) setMayorista(mayoristaData);
      if (!mpData.error) setMp(mpData.month_to_date);
      if (!compData.error) setComprobantes(compData);
      const s = splitEmpretienda(manual);
      setOnline({ monto: s.onlineMonto, cant: s.onlineCant });
      setLocal({ monto: s.localMonto, cant: s.localCant });
      setLoading(false);
    });
  }, []);

  if (loading || !ml) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        Cargando…
      </div>
    );
  }

  const diasTranscurridos = new Date().getDate();
  const totalMes = online.monto + ml.month_to_date.amount + local.monto + (mayorista?.amount ?? 0);
  const ventasMes = online.cant + ml.month_to_date.orders + local.cant + (mayorista?.orders ?? 0);
  const promedioDiario = totalMes / diasTranscurridos;

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      <div className="max-w-sm mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <Link href="/canales" className="text-xs text-white/40">← Canales</Link>
          <span className="text-xs text-white/40">🧉 MATEANDO</span>
        </div>

        <Card>
          <div className="mb-3">
            <div className="text-yellow-400 font-bold text-sm tracking-wide mb-1">MES — POR CANAL</div>
            <div className="text-white font-bold text-xl">
              {fmtFull(totalMes)} <span className="text-white/40 font-normal text-sm">({ventasMes} ventas)</span>
            </div>
          </div>

          <div className="space-y-2">
            <ChanRow label="Tienda Online" color="text-blue-400" monto={online.monto} cant={online.cant} />
            <ChanRow label="  └ Mercado Pago" color="text-blue-400/60" monto={mp.amount} cant={mp.orders} small />
            <ChanRow label="  └ Transferencias" color="text-blue-400/60" monto={comprobantes.amount} cant={comprobantes.orders} small />
            <ChanRow label="Local Físico" color="text-emerald-400" monto={local.monto} cant={local.cant} />
            <ChanRow label="Mercado Libre" color="text-yellow-400" monto={ml.month_to_date.amount} cant={ml.month_to_date.orders} />
            <ChanRow label="Mayorista" color="text-purple-400" monto={mayorista?.amount ?? 0} cant={mayorista?.orders ?? 0} />
          </div>

          <div className="mt-3 pt-3 border-t border-white/10 text-xs text-white/40">
            Promedio diario {fmtM(promedioDiario)} · {diasTranscurridos}d del mes
          </div>
        </Card>

        <p className="text-center text-white/30 text-xs mt-6">
          TO (excepto MP y Transferencias) y Local se actualizan a mano en /canales · el resto, en vivo
        </p>
      </div>
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white/5 border border-white/10 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

function ChanRow({ label, color, monto, cant, small }: { label: string; color: string; monto: number; cant: number; small?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between ${small ? 'text-xs' : 'text-sm'}`}>
      <span className={`font-semibold ${color}`}>{label}:</span>
      <span className={small ? 'text-white/70' : 'text-white'}>
        {fmtFull(monto)} <span className="text-white/40">({cant} ventas)</span>
      </span>
    </div>
  );
}
