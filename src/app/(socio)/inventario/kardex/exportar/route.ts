import { exigirSocio } from '@/composicion/acceso';
import { datosDeSocio } from '@/composicion/datos';
import { kardexConsolidadoCsv } from '@/dominio/datos/csv';

export const dynamic = 'force-dynamic';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const entero = (v: string | null) => (v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null);

/** Kardex en CSV (?marca=&modelo=&sku=&ini=&fin=&tipo=&q=): todos los renglones del filtro, en orden cronologico. Solo socios; la base calcula todo. */
export async function GET(req: Request) {
  await exigirSocio();
  const q = new URL(req.url).searchParams;
  const ini = q.get('ini');
  const fin = q.get('fin');
  if ((ini && !FECHA.test(ini)) || (fin && !FECHA.test(fin))) return new Response('Solicitud inválida', { status: 400 });
  const datos = await datosDeSocio();
  const filtro = { marca: q.get('marca') || null, modelo: entero(q.get('modelo')), sku: entero(q.get('sku')), ini: ini || null, fin: fin || null, tipo: q.get('tipo') || null, q: q.get('q') || null };
  const filas = [];
  let primero = null;
  for (let desplazamiento = 0; desplazamiento < 50_000; desplazamiento += 1000) {
    const k = await datos.kardexConsolidado({ ...filtro, limite: 1000, desplazamiento });
    primero ??= k;
    filas.push(...k.movimientos);
    if (desplazamiento + 1000 >= k.total) break;
  }
  if (!primero) return new Response('No encontrado', { status: 404 });
  const nombre = filtro.modelo ? `kardex-${filtro.modelo}` : 'kardex';
  return new Response(String.fromCharCode(0xfeff) + kardexConsolidadoCsv(primero, filas), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${nombre}.csv"`, 'cache-control': 'private, no-store' },
  });
}
