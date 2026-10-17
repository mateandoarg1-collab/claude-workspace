import { redirect } from 'next/navigation';

// Al entrar al dashboard se abre Ventas por canal; Mercado Libre está en /mercadolibre.
export default function Home() {
  redirect('/canales');
}
