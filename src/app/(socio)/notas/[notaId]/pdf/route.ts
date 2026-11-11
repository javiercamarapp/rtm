import { documentoDeNota } from '@/composicion/operacion';

export const dynamic = 'force-dynamic';

/** PDF de una nota (?v=cliente | interna). Solo socios (la composicion exige sesion). Se genera una vez; reabrir entrega los mismos bytes. */
export async function GET(req: Request, { params }: { params: Promise<{ notaId: string }> }) {
  const { notaId } = await params;
  const id = Number(notaId);
  const v = new URL(req.url).searchParams.get('v') === 'interna' ? 'interna' : 'cliente';
  if (!Number.isInteger(id) || id <= 0) return new Response('No encontrada', { status: 404 });
  const doc = await documentoDeNota(id, v);
  if (!doc) return new Response('No encontrada', { status: 404 });
  return new Response(new Uint8Array(doc.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${doc.folio}${v === 'interna' ? '-interna' : ''}.pdf"`,
      'cache-control': 'private, no-store',
      'x-huella-sha256': doc.sha256,
    },
  });
}
