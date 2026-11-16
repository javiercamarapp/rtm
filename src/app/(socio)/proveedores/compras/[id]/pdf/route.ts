import { exigirSocio } from '@/composicion/acceso';
import { pdfOrdenCompraDeSocio } from '@/composicion/proveedores';

export const dynamic = 'force-dynamic';

/** PDF de la orden de compra (renglones, cantidades, costos y total). Solo socios. La fecha de emision es la de la orden: la misma orden da los mismos bytes. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await exigirSocio();
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return new Response('No encontrada', { status: 404 });
  const pdf = await pdfOrdenCompraDeSocio(n);
  if (!pdf) return new Response('No encontrada', { status: 404 });
  return new Response(new Uint8Array(pdf.bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${pdf.nombre}"`, 'cache-control': 'private, no-store' },
  });
}
