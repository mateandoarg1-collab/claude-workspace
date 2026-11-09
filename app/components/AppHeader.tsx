'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PreguntasBadge from './PreguntasBadge';
import Wordmark from './Wordmark';

type Item = { href: string; label: string; badge?: boolean };
// Solapas de arriba. Las que tienen `sub` agrupan varias páginas: al entrar se muestra una segunda fila para elegir.
const NAV: Array<Item & { sub?: Item[] }> = [
  { href: '/canales', label: 'Canales' },
  { href: '/estadisticas', label: 'Estadísticas' },
  { href: '/anuncios', label: 'Carga Anuncios' },
  { href: '/mercadolibre', label: 'Mercado Libre' },
  {
    href: '/rentabilidad-tienda',
    label: 'Rentabilidad',
    sub: [
      { href: '/rentabilidad-tienda', label: 'Tienda' },
      { href: '/rentabilidad-meli', label: 'Mercado Libre' },
    ],
  },
  {
    href: '/full',
    label: 'China',
    sub: [
      { href: '/full', label: 'Stock en Full' },
      { href: '/china', label: 'Ritmo de venta' },
      { href: '/simulador', label: 'Simulador de espacio' },
      { href: '/productos', label: 'Productos vendidos' },
    ],
  },
  {
    href: '/envios',
    label: 'Logística',
    sub: [
      { href: '/envios', label: 'Envíos' },
      { href: '/despacho', label: 'Despacho' },
      { href: '/posventa', label: 'Posventa' },
    ],
  },
  { href: '/preguntas', label: 'Preguntas ML', badge: true },
];

const activa = (path: string, href: string) => (href === '/' ? path === '/' : path.startsWith(href));
const pill = (on: boolean) =>
  `whitespace-nowrap rounded-full px-3 py-1.5 flex items-center transition-colors ${
    on ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
  }`;

const WIDTHS = { '4xl': 'max-w-4xl', '5xl': 'max-w-5xl', '7xl': 'max-w-7xl' } as const;

// Header compartido por todas las páginas del panel: marca + título de la página
// + navegación. En mobile la navegación es una fila de pills con scroll horizontal.
export default function AppHeader({
  title,
  subtitle,
  logo,
  width = '5xl',
}: {
  title: string;
  subtitle?: React.ReactNode;
  /** Imagen (en /public) que reemplaza visualmente al título, p. ej. el logo del canal. */
  logo?: string;
  width?: keyof typeof WIDTHS;
}) {
  const path = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);
  const grupo = NAV.find((n) => n.sub?.some((x) => activa(path, x.href)));
  // En mobile la fila de pills scrollea: dejar visible la página actual.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [path]);
  return (
    <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/85 backdrop-blur-md">
      <div className={`${WIDTHS[width]} mx-auto px-4 sm:px-6 pt-3 sm:pt-4 pb-2 sm:pb-3 flex flex-col gap-2 sm:gap-3 ${width === "7xl" ? "lg:flex-row lg:items-center lg:justify-between" : ""}`}>
        <div className="min-w-0 flex items-center gap-3 sm:gap-4">
          <Link href="/" aria-label="Inicio" className="flex-shrink-0 text-white hover:text-emerald-300 transition-colors">
            <Wordmark className="h-6 sm:h-7 w-auto" />
          </Link>
          <div className="w-px self-stretch bg-slate-800" />
          <div className="min-w-0">
            {logo ? (
              <h1 className="mb-0.5">
                <span className="sr-only">{title}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logo} alt="" className="h-7 sm:h-8 w-auto rounded-md" />
              </h1>
            ) : (
              <h1 className="text-base sm:text-lg font-semibold leading-tight truncate text-slate-50">{title}</h1>
            )}
            {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 min-w-0">
          <nav className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-1 overflow-x-auto no-scrollbar text-sm">
            {NAV.map((n) => {
              const active = n.sub ? n.sub.some((x) => activa(path, x.href)) : activa(path, n.href);
              return (
                <Link key={n.label} ref={active ? activeRef : undefined} href={n.href} className={pill(active)}>
                  {n.label}
                  {n.badge && <PreguntasBadge />}
                </Link>
              );
            })}
          </nav>
          {grupo && (
            <nav className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-1 overflow-x-auto no-scrollbar text-xs">
              {grupo.sub!.map((x) => (
                <Link key={x.href} href={x.href} className={pill(activa(path, x.href)).replace('px-3 py-1.5', 'px-2.5 py-1')}>
                  {x.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
