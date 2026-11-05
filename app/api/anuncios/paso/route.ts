import { descargarDrive, meta, tokenPara } from '@/lib/anuncios';

export const maxDuration = 300;

// Un paso de la carga (la página los llama en orden y muestra el progreso):
//   campana → media (por archivo) → conjunto → anuncio. Todo PAUSADO.
type Body =
  | { accion: 'campana'; cuenta: string; nombre: string; presupuesto: number }
  | { accion: 'media'; cuenta: string; fileId: string; nombre: string; tipo: 'imagen' | 'video' }
  | { accion: 'conjunto'; cuenta: string; campana: string; nombre: string; pixel?: string; edadMin?: number }
  | {
      accion: 'anuncio'; cuenta: string; conjunto: string; nombre: string; tipo: 'imagen' | 'video';
      hash?: string; videoId?: string; miniatura?: string; texto: string; titulo: string; link: string;
      cta: string; pagina: string; instagram?: string;
    };

export async function POST(req: Request) {
  const b = (await req.json()) as Body;
  const token = tokenPara(b.cuenta);
  if (!token) return Response.json({ error: 'Falta token de Meta para esa cuenta' }, { status: 500 });
  try {
    if (b.accion === 'campana') {
      const r = await meta(`${b.cuenta}/campaigns`, token, {
        body: {
          name: b.nombre, objective: 'OUTCOME_SALES', status: 'PAUSED', special_ad_categories: [],
          daily_budget: String(Math.round(b.presupuesto * 100)), bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        },
      });
      return Response.json({ id: r.id });
    }

    if (b.accion === 'media') {
      const buf = await descargarDrive(b.fileId);
      if (b.tipo === 'imagen') {
        const r = await meta(`${b.cuenta}/adimages`, token, { body: { bytes: buf.toString('base64'), name: b.nombre } });
        const img = Object.values(r.images ?? {})[0] as { hash: string } | undefined;
        if (!img) throw new Error('Meta no devolvió el hash de la imagen');
        return Response.json({ hash: img.hash });
      }
      const fd = new FormData();
      fd.append('source', new Blob([new Uint8Array(buf)]), b.nombre);
      fd.append('name', b.nombre);
      const v = await meta(`${b.cuenta}/advideos`, token, { body: fd });
      // Esperar a que Meta procese el video para tener miniatura (hasta ~4 min).
      for (let i = 0; i < 48; i++) {
        const s = await meta(`${v.id}?fields=status`, token);
        const estado = s.status?.video_status;
        if (estado === 'ready') break;
        if (estado === 'error') throw new Error('Meta no pudo procesar el video');
        await new Promise((r) => setTimeout(r, 5000));
      }
      const t = await meta(`${v.id}/thumbnails?fields=uri,is_preferred`, token);
      const thumbs = (t.data ?? []) as Array<{ uri: string; is_preferred: boolean }>;
      const miniatura = (thumbs.find((x) => x.is_preferred) ?? thumbs[0])?.uri;
      return Response.json({ videoId: v.id, miniatura });
    }

    if (b.accion === 'conjunto') {
      const r = await meta(`${b.cuenta}/adsets`, token, {
        body: {
          name: b.nombre, campaign_id: b.campana, status: 'PAUSED',
          billing_event: 'IMPRESSIONS',
          optimization_goal: b.pixel ? 'OFFSITE_CONVERSIONS' : 'LINK_CLICKS',
          ...(b.pixel ? { promoted_object: { pixel_id: b.pixel, custom_event_type: 'PURCHASE' } } : {}),
          targeting: {
            geo_locations: { countries: ['AR'] }, age_min: b.edadMin ?? 18, age_max: 65,
            targeting_automation: { advantage_audience: 1 },
          },
        },
      });
      return Response.json({ id: r.id });
    }

    if (b.accion === 'anuncio') {
      const cta = { type: b.cta, value: { link: b.link } };
      const spec =
        b.tipo === 'imagen'
          ? { link_data: { image_hash: b.hash, link: b.link, message: b.texto, name: b.titulo, call_to_action: cta } }
          : { video_data: { video_id: b.videoId, image_url: b.miniatura, message: b.texto, title: b.titulo, call_to_action: cta } };
      const creativo = await meta(`${b.cuenta}/adcreatives`, token, {
        body: {
          name: b.nombre,
          object_story_spec: { page_id: b.pagina, ...(b.instagram ? { instagram_user_id: b.instagram } : {}), ...spec },
        },
      });
      const ad = await meta(`${b.cuenta}/ads`, token, {
        body: { name: b.nombre, adset_id: b.conjunto, creative: { creative_id: creativo.id }, status: 'PAUSED' },
      });
      return Response.json({ id: ad.id });
    }
    return Response.json({ error: 'Acción desconocida' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
