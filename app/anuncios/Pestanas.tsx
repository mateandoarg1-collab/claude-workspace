'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Pestañas de la sección de pauta: carga de campañas y rendimiento de anuncios.
export default function Pestanas() {
  const path = usePathname();
  const tabs = [
    { href: '/anuncios', label: 'Cargar campaña' },
    { href: '/anuncios/rendimiento', label: 'Rendimiento de pauta' },
    { href: '/anuncios/presupuesto', label: 'Presupuesto por ROAS' },
  ];
  return (
    <div className="flex gap-1 rounded-xl bg-slate-900 border border-slate-800 p-1 w-fit max-w-full overflow-x-auto text-sm whitespace-nowrap">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href}
          className={`rounded-lg px-3 py-1.5 transition-colors ${path === t.href ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-400 hover:text-slate-100'}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
