import sharp from 'sharp';
import { descargarDrive } from '@/lib/anuncios';
import { ARGENTINA, ESPANOL, gmutate, LOGO_ASSET, MERCHANT_ID, NOMBRE_ASSET, rn } from '@/lib/googleAds';

export const maxDuration = 120;

// Crea una campaña de Google Ads PAUSADA en una sola transacción (si algo falla no queda nada a medias).
//  - pmax: Performance Max con el catálogo de Merchant Center (todos los productos) + grupo de recursos con las
//    imágenes de la carpeta de Drive (recortadas a 1,91:1, 1:1 y 4:5), logo y nombre ya cargados en la cuenta, y textos.
//  - busqueda: Búsqueda con un grupo de anuncios, palabras clave (concordancia amplia) y un anuncio responsivo.
// Las dos: Maximizar conversiones, Argentina, español. validar = solo valida con Google, no crea nada.
type Body = {
  tipo: 'pmax' | 'busqueda'; nombre: string; presupuesto: number; url: string; validar?: boolean;
  titulos: string[]; titulosLargos?: string[]; descripciones: string[]; palabras?: string[]; imagenes?: string[];
};

const TAMANOS = [
  { campo: 'MARKETING_IMAGE', w: 1200, h: 628 },
  { campo: 'SQUARE_MARKETING_IMAGE', w: 1200, h: 1200 },
  { campo: 'PORTRAIT_MARKETING_IMAGE', w: 960, h: 1200 },
] as const;

export async function POST(req: Request) {
  const b = (await req.json()) as Body;
  const limpiar = (l: string[] | undefined, max: number) => (l ?? []).map((s) => s.trim()).filter((s) => s && s.length <= max);
  const titulos = limpiar(b.titulos, 30), largos = limpiar(b.titulosLargos, 90), descs = limpiar(b.descripciones, 90);
  const palabras = limpiar(b.palabras, 80);
  if (!b.nombre?.trim() || !(Number(b.presupuesto) > 0) || !/^https?:\/\//.test(b.url ?? '')) {
    return Response.json({ error: 'Completá nombre, presupuesto y URL' }, { status: 400 });
  }
  if (titulos.length < 3 || descs.length < 2) return Response.json({ error: 'Hacen falta al menos 3 títulos y 2 descripciones' }, { status: 400 });
  if (!descs.some((d) => d.length <= 60)) return Response.json({ error: 'Al menos una descripción tiene que tener 60 caracteres o menos' }, { status: 400 });

  const nombre = b.nombre.trim();
  const budget = rn('campaignBudgets', -1), campana = rn('campaigns', -2);
  const ops: unknown[] = [
    { campaignBudgetOperation: { create: { resourceName: budget, name: `${nombre} (${Date.now()})`, amountMicros: String(Math.round(Number(b.presupuesto)) * 1e6), deliveryMethod: 'STANDARD', explicitlyShared: false } } },
  ];
  const base = {
    resourceName: campana, name: nombre, status: 'PAUSED', campaignBudget: budget, maximizeConversions: {},
    containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
  };
  const criterios = [
    { campaignCriterionOperation: { create: { campaign: campana, location: { geoTargetConstant: ARGENTINA } } } },
    { campaignCriterionOperation: { create: { campaign: campana, language: { languageConstant: ESPANOL } } } },
  ];

  try {
    if (b.tipo === 'pmax') {
      if (!largos.length) return Response.json({ error: 'Hace falta al menos 1 título largo' }, { status: 400 });
      if (!b.imagenes?.length) return Response.json({ error: 'Elegí al menos 1 imagen de la carpeta' }, { status: 400 });
      ops.push({ campaignOperation: { create: { ...base, advertisingChannelType: 'PERFORMANCE_MAX', shoppingSetting: { merchantId: MERCHANT_ID }, brandGuidelinesEnabled: false } } }, ...criterios);
      const grupo = rn('assetGroups', -3);
      const vinculos: Array<{ asset: string; fieldType: string }> = [
        { asset: rn('assets', LOGO_ASSET), fieldType: 'LOGO' },
        { asset: rn('assets', NOMBRE_ASSET), fieldType: 'BUSINESS_NAME' },
      ];
      let tmp = -10;
      // Imágenes: cada una de Drive se recorta a los 3 formatos que pide Performance Max (máx. 20 por formato).
      for (const [i, fileId] of b.imagenes.slice(0, 6).entries()) {
        const original = await descargarDrive(fileId);
        for (const t of TAMANOS) {
          const data = await sharp(original).rotate().resize(t.w, t.h, { fit: 'cover', position: 'attention' }).jpeg({ quality: 85 }).toBuffer();
          const asset = rn('assets', tmp--);
          ops.push({ assetOperation: { create: { resourceName: asset, name: `${nombre} img${i + 1} ${t.w}x${t.h} ${Date.now()}`, type: 'IMAGE', imageAsset: { data: data.toString('base64') } } } });
          vinculos.push({ asset, fieldType: t.campo });
        }
      }
      const texto = (lista: string[], campo: string) => {
        for (const text of lista) {
          const asset = rn('assets', tmp--);
          ops.push({ assetOperation: { create: { resourceName: asset, textAsset: { text } } } });
          vinculos.push({ asset, fieldType: campo });
        }
      };
      texto(titulos.slice(0, 15), 'HEADLINE');
      texto(largos.slice(0, 5), 'LONG_HEADLINE');
      texto(descs.slice(0, 5), 'DESCRIPTION');
      ops.push({ assetGroupOperation: { create: { resourceName: grupo, campaign: campana, name: `${nombre} - Grupo 1`, finalUrls: [b.url], status: 'ENABLED' } } });
      for (const v of vinculos) ops.push({ assetGroupAssetOperation: { create: { assetGroup: grupo, asset: v.asset, fieldType: v.fieldType } } });
      // Todos los productos del catálogo.
      ops.push({ assetGroupListingGroupFilterOperation: { create: { assetGroup: grupo, type: 'UNIT_INCLUDED', listingSource: 'SHOPPING' } } });
    } else {
      if (!palabras.length) return Response.json({ error: 'Hace falta al menos 1 palabra clave' }, { status: 400 });
      ops.push({
        campaignOperation: {
          create: {
            ...base, advertisingChannelType: 'SEARCH',
            networkSettings: { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false, targetPartnerSearchNetwork: false },
          },
        },
      }, ...criterios);
      const grupo = rn('adGroups', -3);
      ops.push({ adGroupOperation: { create: { resourceName: grupo, campaign: campana, name: `${nombre} - Grupo 1`, status: 'ENABLED', type: 'SEARCH_STANDARD' } } });
      for (const text of [...new Set(palabras.map((p) => p.toLowerCase()))].slice(0, 50)) {
        ops.push({ adGroupCriterionOperation: { create: { adGroup: grupo, status: 'ENABLED', keyword: { text, matchType: 'BROAD' } } } });
      }
      ops.push({
        adGroupAdOperation: {
          create: {
            adGroup: grupo, status: 'ENABLED',
            ad: { finalUrls: [b.url], responsiveSearchAd: { headlines: titulos.slice(0, 15).map((text) => ({ text })), descriptions: descs.slice(0, 4).map((text) => ({ text })) } },
          },
        },
      });
    }

    const r = await gmutate(ops, !!b.validar);
    if (b.validar) return Response.json({ ok: true, validado: true });
    const creada = r.mutateOperationResponses?.find((x) => x.campaignResult)?.campaignResult?.resourceName ?? '';
    return Response.json({ ok: true, campana: creada.split('/').pop() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
