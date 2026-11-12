import { reportesDeSocio } from '@/composicion/reportes';

export const dynamic = 'force-dynamic';

/** PDF del reporte con la sesion del socio (enlace autenticado del aviso y del correo). El mismo archivo guardado: reabrirlo no lo regenera. */
export async function GET(_req: Request, ctx: { params: Promise<{ clave: string; version: string }> }): Promise<Response> {
  const p = await ctx.params;
  const clave = decodeURIComponent(p.clave);
  const version = Number(p.version);
  if (!/^(semanal|mensual):\d{4}-\d{2}-\d{2}$/.test(clave) || !Number.isInteger(version)) return new Response(null, { status: 404 });
  const r = await reportesDeSocio();
  const pdf = await r.pdf(clave, version);
  if (!pdf) return new Response(null, { status: 404 });
  return new Response(Buffer.from(pdf), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${clave.replace(':', '-')}-v${version}.pdf"`, 'cache-control': 'private, no-store' } });
}
