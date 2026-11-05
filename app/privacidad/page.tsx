// Política de privacidad pública: la pide Meta para pasar a modo público la app
// "conexion reportes ads" (usada para crear anuncios desde /anuncios).
export const metadata = { title: 'Política de privacidad · MATEANDO' };

export default function Privacidad() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-300 px-4 sm:px-6 py-10">
      <div className="max-w-2xl mx-auto space-y-4 text-sm leading-relaxed">
        <h1 className="text-2xl font-semibold text-slate-50">Política de privacidad</h1>
        <p>Andomat 611 S.R.L. (MATEANDO, www.mateandoarg.com) opera esta aplicación de uso interno para administrar sus propias campañas publicitarias y reportes en Meta.</p>
        <h2 className="text-lg font-semibold text-slate-100">Datos que usamos</h2>
        <p>La aplicación accede únicamente a las cuentas publicitarias, páginas y activos propios de MATEANDO (campañas, anuncios, métricas y creatividades). No recopila datos personales de usuarios de Facebook o Instagram.</p>
        <h2 className="text-lg font-semibold text-slate-100">Uso y conservación</h2>
        <p>La información se usa solo para crear y medir publicidad de MATEANDO. No se vende ni se comparte con terceros.</p>
        <h2 className="text-lg font-semibold text-slate-100">Eliminación de datos</h2>
        <p>Para solicitar la eliminación de cualquier dato, escribinos a jpcipolletta@mateando.com y lo resolvemos dentro de los 30 días.</p>
        <p className="text-slate-500">Última actualización: 5 de noviembre de 2026.</p>
      </div>
    </main>
  );
}
