// Logo de cada canal de venta (en /canales y /resumen). Plataformas: su logo (PNG en public/canales);
// Local y Mayorista: etiqueta con emoji.
export type CanalId = 'online' | 'ml' | 'local' | 'shopify' | 'mayorista';

const LOGOS: Partial<Record<CanalId, { src: string; alt: string }>> = {
  online: { src: '/canales/empretienda-logo.png', alt: 'Empretienda' },
  ml: { src: '/canales/mercadolibre-logo.png', alt: 'Mercado Libre' },
  shopify: { src: '/canales/shopify-logo.png', alt: 'Shopify' },
};

const ETIQUETAS: Partial<Record<CanalId, string>> = {
  local: '🛍️🛒 LOCAL',
  mayorista: '📦 MAYORISTA',
};

export default function CanalMarca({ id, chico }: { id: CanalId; chico?: boolean }) {
  const alto = chico ? 'h-6' : 'h-7';
  const logo = LOGOS[id];
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo.src} alt={logo.alt} className={`${alto} w-auto rounded-md`} />;
  }
  return (
    <span className={`${alto} inline-flex items-center rounded-md bg-white px-2 text-xs font-extrabold tracking-wide text-slate-950`}>
      {ETIQUETAS[id]}
    </span>
  );
}
