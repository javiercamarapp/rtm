import { exigirSocio } from '@/composicion/acceso';
import { inventarioDeSocio } from '@/composicion/inventario';
import { nombreArchivo } from '@/dominio/inventario/compartir';

export const dynamic = 'force-dynamic';

/** PDF del inventario ya generado y guardado. Solo socios. Reabrir entrega los mismos bytes (misma huella). `?descargar=1` fuerza la descarga. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await exigirSocio();
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return new Response('No encontrado', { status: 404 });
  const doc = await (await inventarioDeSocio()).documento(n);
  if (!doc || !doc.base64 || !doc.sha256) return new Response('No encontrado', { status: 404 });
  const descargar = new URL(req.url).searchParams.get('descargar') === '1';
  return new Response(new Uint8Array(Buffer.from(doc.base64, 'base64')), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${descargar ? 'attachment' : 'inline'}; filename="${nombreArchivo(doc.folio, doc.version)}"`,
      'cache-control': 'private, no-store',
      'x-huella-sha256': doc.sha256,
    },
  });
}
