import { exigirSocio } from '@/composicion/acceso';
import { inventarioDeSocio } from '@/composicion/inventario';
import { kardexCsv } from '@/dominio/inventario/csv';

export const dynamic = 'force-dynamic';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Kardex de un modelo en CSV (?modelo=ID&sku=ID&ini=&fin=). Solo socios; la base calcula todo. */
export async function GET(req: Request) {
  await exigirSocio();
  const q = new URL(req.url).searchParams;
  const modelo = Number(q.get('modelo'));
  const sku = q.get('sku') ? Number(q.get('sku')) : null;
  const ini = q.get('ini');
  const fin = q.get('fin');
  if (!Number.isInteger(modelo) || modelo <= 0 || (sku !== null && !Number.isInteger(sku)) || (ini && !FECHA.test(ini)) || (fin && !FECHA.test(fin))) return new Response('Solicitud inválida', { status: 400 });
  const k = await (await inventarioDeSocio()).kardex(modelo, sku, ini || null, fin || null, 5000);
  if (!k) return new Response('No encontrado', { status: 404 });
  return new Response(String.fromCharCode(0xfeff) + kardexCsv(k), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="kardex-${modelo}.csv"`, 'cache-control': 'private, no-store' },
  });
}
