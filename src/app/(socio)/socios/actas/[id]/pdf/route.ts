import { pdfDeActa } from '@/composicion/historial';

export const dynamic = 'force-dynamic';

/** PDF del acta de corte (con el sello si ya se cerro). Solo socios. El mismo acta da los mismos bytes. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return new Response('No encontrada', { status: 404 });
  const pdf = await pdfDeActa(n);
  if (!pdf) return new Response('No encontrada', { status: 404 });
  return new Response(new Uint8Array(pdf.bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${pdf.nombre}"`, 'cache-control': 'private, no-store', 'x-huella-sha256': pdf.sha256 },
  });
}
