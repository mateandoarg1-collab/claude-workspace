// Costos cargados a mano por producto (pestaña costos_tienda: producto | costo | actualizado | desde), para los scripts
// que calculan CMV. Un producto puede tener varias filas: cada una vale desde su fecha (YYYY-MM-DD) hasta la siguiente.
// Sin fecha = vale desde siempre (sirve para corregir un costo mal cargado: cambia todas las ventas).
//   _productos       { NOMBRE: costo vigente hoy }          (CMV del período en /canales)
//   _productos_hist  { NOMBRE: [[desde, costo], ...] }      (rentabilidad venta por venta: el de la fecha de cada venta)
export const normalizar = (p) => String(p ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
const dia = (x) => (/^\d{4}-\d{2}-\d{2}/.test(String(x ?? '')) ? String(x).slice(0, 10) : '');

export function armarManuales(filas, hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)) {
  const hist = {};
  for (const [p, c, , d] of filas ?? []) {
    const k = normalizar(p);
    if (!k || String(c ?? '').trim() === '' || !(Number(c) >= 0)) continue;
    (hist[k] ??= []).push([dia(d), Number(c)]);
  }
  const vigente = {};
  for (const [k, l] of Object.entries(hist)) {
    l.sort((a, b) => a[0].localeCompare(b[0]));
    const hasta = l.filter(([d]) => d <= hoy);
    if (hasta.length) vigente[k] = hasta[hasta.length - 1][1];
  }
  return { _productos: vigente, _productos_hist: hist };
}
