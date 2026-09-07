import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MATEANDO',
    short_name: 'Mateando',
    description: 'Panel de gestión MATEANDO — preguntas, ventas y más',
    start_url: '/preguntas',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#059669',
    icons: [
      { src: '/pwa-icon-192', sizes: '192x192', type: 'image/png' },
      { src: '/pwa-icon-512', sizes: '512x512', type: 'image/png' },
    ],
  };
}
