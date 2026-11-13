import { documentoDeDevolucion } from '@/composicion/operacion';

export const dynamic = 'force-dynamic';

/** PDF de una nota de credito (tipo=cliente) o de una devolucion a proveedor (tipo=proveedor). Solo socios; se genera una vez y se guarda. */
export async function GET(_req: Request, { params }: { params: Promise<{ tipo: string; id: string }> }) {
  const { tipo, id } = await params;
  const n = Number(id);
  if ((tipo !== 'cliente' && tipo !== 'proveedor') || !Number.isInteger(n) || n <= 0) return new Response('No encontrada', { status: 404 });
  const doc = await documentoDeDevolucion(tipo, n);
  if (!doc) return new Response('No encontrada', { status: 404 });
  return new Response(new Uint8Array(doc.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${doc.folio}.pdf"`,
      'cache-control': 'private, no-store',
      'x-huella-sha256': doc.sha256,
    },
  });
}
