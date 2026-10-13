@AGENTS.md

# Claude Workspace

Este es el workspace principal para proyectos con Claude.

## Flujo de trabajo

Después de hacer cambios con Claude, guardar en la nube:

```bash
git add .
git commit -m "descripción del cambio"
git push
```

Vercel despliega automáticamente en cada `git push` a `main`.

## Links
- **GitHub**: https://github.com/mateandoarg1-collab/claude-workspace
- **App en vivo**: https://claude-workspace-virid.vercel.app

## Estructura
- `app/` — páginas y componentes Next.js
- `public/` — archivos estáticos

## Diseño del panel
- Tema **oscuro** único. La escala `slate` está redefinida en `app/globals.css` como neutro oscuro con tinte verde (950 = fondo, 900 = tarjetas, 800 = bordes, 100/300 = textos). Acento de marca: `emerald`.
- Todas las páginas usan `<AppHeader title subtitle width />` (`app/components/AppHeader.tsx`) — el menú se edita en un solo lugar (`NAV`).
- Mobile primero: padding `px-4 sm:px-6`, grids `grid-cols-1 sm:grid-cols-2`, tablas anchas con `overflow-x-auto` o columnas `hidden sm:table-cell`.
