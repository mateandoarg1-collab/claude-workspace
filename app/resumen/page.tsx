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
  const [ml, setMl] = useState<{ today: Sum; yesterday_full: Sum; last_7_days: Sum; month_to_date: Sum } | null>(null);
  const [mayorista, setMayorista] = useState<{ orders: number; amount: number } | null>(null);
  const [online, setOnline] = useState({ monto: 0, cant: 0 });
  const [local, setLocal] = useState({ monto: 0, cant: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/ml/sales', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/mayorista', { cache: 'no-store' }).then((r) => r.json()),
      fetchEmpretiendaManual(),
    ]).then(([mlData, mayoristaData, manual]) => {
      setMl(mlData);
      if (!mayoristaData.error) setMayorista(mayoristaData);
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
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-yellow-400 font-bold text-sm tracking-wide">MES — POR CANAL</span>
            <span className="text-white font-bold text-lg">
              {fmtM(totalMes)} <span className="text-white/40 font-normal text-sm">({ventasMes}v)</span>
            </span>
          </div>

          <ChannelRow>
            <Chan label="TO" color="text-blue-400" value={fmtM(online.monto)} />
            <Chan label="LOC" color="text-emerald-400" value={fmtM(local.monto)} />
            <Chan label="ML" color="text-yellow-400" value={fmtM(ml.month_to_date.amount)} />
            <Chan label="MAY" color="text-purple-400" value={fmtM(mayorista?.amount ?? 0)} />
          </ChannelRow>

          <div className="mt-3 pt-3 border-t border-white/10 text-xs text-white/40">
            Promedio diario {fmtM(promedioDiario)} · {diasTranscurridos}d del mes
          </div>
        </Card>

        <Card className="mt-3">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-emerald-400 font-bold text-sm tracking-wide">HOY</span>
            <span className="text-white font-bold text-lg">
              {fmtFull(ml.today.amount)} <span className="text-white/40 font-normal text-sm">({ml.today.orders}v)</span>
            </span>
          </div>
          <div className="text-xs text-white/40">solo Mercado Libre (único canal con dato en tiempo real)</div>
        </Card>

        <Card className="mt-3">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-blue-400 font-bold text-sm tracking-wide">AYER</span>
            <span className="text-white font-bold text-lg">
              {fmtFull(ml.yesterday_full.amount)} <span className="text-white/40 font-normal text-sm">({ml.yesterday_full.orders}v)</span>
            </span>
          </div>
          <div className="text-xs text-white/40">Mercado Libre</div>
        </Card>

        <Card className="mt-3">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-purple-400 font-bold text-sm tracking-wide">ÚLTIMOS 7 DÍAS</span>
            <span className="text-white font-bold text-lg">
              {fmtFull(ml.last_7_days.amount)} <span className="text-white/40 font-normal text-sm">({ml.last_7_days.orders}v)</span>
            </span>
          </div>
          <div className="text-xs text-white/40">Mercado Libre</div>
        </Card>

        <p className="text-center text-white/30 text-xs mt-6">
          TO y Local se actualizan a mano en /canales · Mayorista y ML en vivo
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

function ChannelRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1">{children}</div>;
}

function Chan({ label, color, value }: { label: string; color: string; value: string }) {
  return (
    <div className="text-sm">
      <span className={`font-semibold ${color}`}>{label}</span>{' '}
      <span className="text-white">{value}</span>
    </div>
  );
}
