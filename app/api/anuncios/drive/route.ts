import { driveAuth, idCarpeta } from '@/lib/anuncios';

export const maxDuration = 30;

// Lista imágenes y videos de una carpeta de Drive (incluye subcarpetas de un nivel).
// La carpeta tiene que estar compartida con mateando-sa@mateando-claude.iam.gserviceaccount.com.
export async function GET(req: Request) {
  const link = new URL(req.url).searchParams.get('carpeta') ?? '';
  if (!link) return Response.json({ error: 'Falta el link de la carpeta' }, { status: 400 });
  const drive = driveAuth();
  try {
    const listar = async (id: string) => {
      const out = [];
      let pageToken: string | undefined;
      do {
        const r = await drive.files.list({
          q: `'${id}' in parents and trashed = false`,
          fields: 'nextPageToken, files(id,name,mimeType,thumbnailLink,size)',
          pageSize: 200, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true,
        });
        out.push(...(r.data.files ?? []));
        pageToken = r.data.nextPageToken ?? undefined;
      } while (pageToken);
      return out;
    };
    const raiz = await listar(idCarpeta(link));
    const subs = raiz.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
    const todos = [...raiz, ...(await Promise.all(subs.map((s) => listar(s.id!)))).flat()];
    const archivos = todos
      .filter((f) => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/'))
      .map((f) => ({
        id: f.id, nombre: f.name, tipo: f.mimeType!.startsWith('video/') ? 'video' : 'imagen',
        miniatura: f.thumbnailLink, mb: f.size ? Math.round(Number(f.size) / 1e5) / 10 : null,
      }))
      .sort((a, b) => a.nombre!.localeCompare(b.nombre!));
    return Response.json({ archivos });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const ayuda = /not found|404/i.test(msg)
      ? 'No veo la carpeta: compartila (Lector) con mateando-sa@mateando-claude.iam.gserviceaccount.com'
      : msg;
    return Response.json({ error: ayuda }, { status: 400 });
  }
}
