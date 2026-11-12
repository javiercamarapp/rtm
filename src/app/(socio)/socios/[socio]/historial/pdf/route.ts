import { exigirSocio } from '@/composicion/acceso';
import { pdfDeHistorial } from '@/composicion/historial';

export const dynamic = 'force-dynamic';

/** Estado de cuenta personal en PDF. Solo socios (la composicion exige sesion); lo ven los dos, 50/50 transparente. */
export async function GET(_req: Request, { params }: { params: Promise<{ socio: string }> }) {
  await exigirSocio();
  const { socio } = await params;
  if (socio !== 'Angelo' && socio !== 'Javier') return new Response('No encontrado', { status: 404 });
  const pdf = await pdfDeHistorial(socio);
  return new Response(new Uint8Array(pdf.bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${pdf.nombre}"`, 'cache-control': 'private, no-store', 'x-huella-sha256': pdf.sha256 },
  });
}
