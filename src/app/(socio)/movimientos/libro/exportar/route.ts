import { exigirSocio } from '@/composicion/acceso';
import { datosDeSocio } from '@/composicion/datos';
import { celdaCsv, pesosCsv, respuestaCsv } from '../../../_a2/util';

export const dynamic = 'force-dynamic';
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const pesos = (v: string | null): bigint | null => { const t = v?.replace(/[,\s]/g, ''); return t && /^\d+(\.\d{1,2})?$/.test(t) ? BigInt(Math.round(Number(t) * 100)) : null; };

/** Libro de ingresos y egresos en CSV con saldo corrido: todos los renglones del filtro. Solo socios. */
export async function GET(req: Request) {
  await exigirSocio();
  const q = new URL(req.url).searchParams;
  const ini = q.get('ini'); const fin = q.get('fin'); const estado = q.get('estado');
  if ((ini && !FECHA.test(ini)) || (fin && !FECHA.test(fin)) || (estado && !['sin_clasificar', 'clasificado', 'conciliado'].includes(estado))) return new Response('Solicitud inválida', { status: 400 });
  const datos = await datosDeSocio();
  const f = { ini: ini || null, fin: fin || null, estado: (estado || null) as 'sin_clasificar' | 'clasificado' | 'conciliado' | null, q: q.get('q') || null, minCent: pesos(q.get('min')), maxCent: pesos(q.get('max')), cuenta: q.get('cuenta') || null, orden: q.get('orden') === 'desc' ? ('desc' as const) : ('asc' as const) };
  const lineas = ['Fecha,Concepto,Categoria,Cuenta,Contraparte,Folio,Cargos,Abonos,Saldo,Estado,Origen'];
  let primero = null;
  for (let off = 0; off < 100_000; off += 500) {
    const l = await datos.libro({ ...f, limite: 500, desplazamiento: off });
    primero ??= l;
    for (const x of l.movimientos) lineas.push([x.fecha_neg, x.concepto, x.categoria?.replaceAll('_', ' ') ?? '', x.cuenta, x.contraparte, x.folio, pesosCsv(x.cargo_cent), pesosCsv(x.abono_cent), pesosCsv(x.saldo_cent), x.estado.replaceAll('_', ' '), x.origen].map((v) => celdaCsv(v)).join(','));
    if (off + 500 >= l.total) break;
  }
  if (primero) lineas.push(['', 'Totales del filtro', '', '', '', '', pesosCsv(primero.totales.cargos_cent), pesosCsv(primero.totales.abonos_cent), pesosCsv(primero.totales.saldo_final_cent), '', ''].map((v) => celdaCsv(v)).join(','));
  return respuestaCsv('libro-de-dinero', lineas);
}
