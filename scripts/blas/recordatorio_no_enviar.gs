// Para el Apps Script de info@mateando.com que manda "Datos para la transferencia de tu compra".
//
// Antes de mandar cada recordatorio, fijarse si la orden está en la planilla
// "Recordatorios transferencia - no enviar". La llena el servidor de Mateando cada 5 minutos con las órdenes
// pagadas, las que ya mandaron comprobante por WhatsApp (aunque falte verificar) y las canceladas.
// Ejemplo del 10-nov, orden #207876: pagó 23:25, se tildó 23:37 y el recordatorio salió igual a las 23:40.
//
// Planilla: https://docs.google.com/spreadsheets/d/1HNGL0EGeMNnrQNqrw626UxrL6DP3VaWv9WOZN4q6Zvc
// Pestaña no_enviar: A orden | B motivo | C fecha. F1 = hora de la última actualización.
// La primera vez hay que correr una función a mano desde el editor para darle permiso de leer planillas.

const PLANILLA_NO_ENVIAR = '1HNGL0EGeMNnrQNqrw626UxrL6DP3VaWv9WOZN4q6Zvc';
const MAX_ATRASO_MIN = 20;

/**
 * Devuelve un Set con los números de orden que NO hay que mandar ("207876"),
 * o null si la lista tiene más de 20 minutos (el servidor no la pudo actualizar).
 * Con null, esa vuelta no se manda NINGÚN recordatorio: mejor saltear uno que escribirle a alguien que pagó.
 */
function ordenesQueNoSeMandan() {
  const hoja = SpreadsheetApp.openById(PLANILLA_NO_ENVIAR).getSheetByName('no_enviar');
  const actualizado = new Date(hoja.getRange('F1').getValue());
  const atrasoMin = (Date.now() - actualizado.getTime()) / 60000;
  if (!(atrasoMin <= MAX_ATRASO_MIN)) { // también si la fecha no se entiende
    console.warn('Lista no_enviar vieja (' + Math.round(atrasoMin) + ' min): esta vuelta no se manda nada');
    return null;
  }
  const filas = hoja.getLastRow() - 1;
  const valores = filas > 0 ? hoja.getRange(2, 1, filas, 1).getValues() : [];
  return new Set(valores.map(f => String(f[0]).replace(/\D/g, '')).filter(Boolean));
}

// Cómo usarlo en la función que manda los recordatorios (leer la lista UNA vez, justo antes del loop):
//
// function mandarRecordatorios() {
//   const noMandar = ordenesQueNoSeMandan();
//   if (!noMandar) return;
//   for (const orden of ordenesPendientes) {                 // como lo arma hoy el script
//     const numero = String(orden.numero).replace(/\D/g, ''); // "#207876" → "207876"
//     if (noMandar.has(numero)) continue;                    // pagada, con comprobante o cancelada
//     // ... mandar el mail como hasta ahora
//   }
// }

// Para probar desde el editor: tiene que mostrar "207876 → no se manda".
function probarNoEnviar() {
  const noMandar = ordenesQueNoSeMandan();
  if (!noMandar) return console.log('La lista está vieja');
  console.log(noMandar.size + ' órdenes en la lista');
  console.log('207876 → ' + (noMandar.has('207876') ? 'no se manda' : 'SE MANDA'));
}
