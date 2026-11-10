'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Pestañas de la sección de pauta: primero la plataforma (Meta / Google / TikTok); Meta tiene sus sub-pestañas.
const META = [
  { href: '/anuncios', label: 'Cargar campaña' },
  { href: '/anuncios/rendimiento', label: 'Rendimiento de pauta' },
  { href: '/anuncios/presupuesto', label: 'Presupuesto por ROAS' },
];
const PLATAFORMAS = [
  { href: '/anuncios', label: 'Meta Ads', activa: (p: string) => META.some((m) => m.href === p) },
  { href: '/anuncios/google', label: 'Google Ads', activa: (p: string) => p === '/anuncios/google' },
  { href: '/anuncios/tiktok', label: 'TikTok Ads', activa: (p: string) => p === '/anuncios/tiktok' },
];

const fila = 'flex gap-1 rounded-xl bg-slate-900 border border-slate-800 p-1 w-fit max-w-full overflow-x-auto whitespace-nowrap';
const tab = (on: boolean) => `rounded-lg px-3 py-1.5 transition-colors ${on ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-400 hover:text-slate-100'}`;

export default function Pestanas() {
  const path = usePathname();
  const enMeta = PLATAFORMAS[0].activa(path);
  return (
    <div className="space-y-2">
      <div className={`${fila} text-sm font-semibold`}>
        {PLATAFORMAS.map((t) => <Link key={t.label} href={t.href} className={tab(t.activa(path))}>{t.label}</Link>)}
      </div>
      {enMeta && (
        <div className={`${fila} text-xs`}>
          {META.map((t) => <Link key={t.href} href={t.href} className={tab(path === t.href)}>{t.label}</Link>)}
        </div>
      )}
    </div>
  );
}
