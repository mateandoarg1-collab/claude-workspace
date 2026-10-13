'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PreguntasBadge from './PreguntasBadge';

const NAV: Array<{ href: string; label: string; badge?: boolean }> = [
  { href: '/', label: 'Mercado Libre' },
  { href: '/productos', label: 'Productos' },
  { href: '/canales', label: 'Canales' },
  { href: '/competencia', label: 'Competencia' },
  { href: '/comportamiento', label: 'Comportamiento' },
  { href: '/preguntas', label: 'Preguntas', badge: true },
  { href: '/resumen', label: 'Resumen 📱' },
];

const WIDTHS = { '4xl': 'max-w-4xl', '5xl': 'max-w-5xl', '7xl': 'max-w-7xl' } as const;

// Header compartido por todas las páginas del panel: marca + título de la página
// + navegación. En mobile la navegación es una fila de pills con scroll horizontal.
export default function AppHeader({
  title,
  subtitle,
  width = '5xl',
}: {
  title: string;
  subtitle?: React.ReactNode;
  width?: keyof typeof WIDTHS;
}) {
  const path = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);
  // En mobile la fila de pills scrollea: dejar visible la página actual.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [path]);
  return (
    <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/85 backdrop-blur-md">
      <div className={`${WIDTHS[width]} mx-auto px-4 sm:px-6 pt-3 sm:pt-4 pb-2 sm:pb-3 flex flex-col gap-2 sm:gap-3 ${width === "7xl" ? "lg:flex-row lg:items-center lg:justify-between" : ""}`}>
        <div className="min-w-0 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-800 flex items-center justify-center text-lg shadow-lg shadow-emerald-900/40 flex-shrink-0">
            🧉
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold tracking-[0.2em] text-emerald-400">MATEANDO</div>
            <h1 className="text-base sm:text-lg font-semibold leading-tight truncate text-slate-50">{title}</h1>
            {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
          </div>
        </div>
        <nav className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-1 overflow-x-auto no-scrollbar text-sm">
          {NAV.map((n) => {
            const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                ref={active ? activeRef : undefined}
                href={n.href}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 flex items-center transition-colors ${
                  active
                    ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                }`}
              >
                {n.label}
                {n.badge && <PreguntasBadge />}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
