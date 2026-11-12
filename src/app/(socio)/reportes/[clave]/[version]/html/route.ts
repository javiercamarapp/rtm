import { exigirSocio } from '@/composicion/acceso';
import { reportesDeSocio } from '@/composicion/reportes';

export const dynamic = 'force-dynamic';

/** HTML guardado del reporte, con la sesion del socio. Politica estricta: sin scripts, sin red, solo estilos y fuentes incrustados. */
export async function GET(_req: Request, ctx: { params: Promise<{ clave: string; version: string }> }): Promise<Response> {
  const p = await ctx.params;
  const clave = decodeURIComponent(p.clave);
  const version = Number(p.version);
  if (!/^(semanal|mensual):\d{4}-\d{2}-\d{2}$/.test(clave) || !Number.isInteger(version)) return new Response(null, { status: 404 });
  await exigirSocio();
  const r = await reportesDeSocio();
  const html = await r.html(clave, version);
  if (!html) return new Response(null, { status: 404 });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:", 'cache-control': 'private, no-store' } });
}
