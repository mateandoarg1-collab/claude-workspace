import AppHeader from '../components/AppHeader';

// El simulador es un HTML autocontenido (public/simulador-contenedor.html):
// se muestra embebido para que quede dentro del panel con su navegación.
export default function SimuladorPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <AppHeader title="Simulador Container" subtitle="Ocupación, FOB y landed por pedido" width="7xl" />
      <iframe
        src="/simulador-contenedor.html"
        title="Simulador Contenedor"
        className="flex-1 w-full border-0 bg-white"
        style={{ minHeight: 'calc(100vh - 80px)' }}
      />
    </div>
  );
}
