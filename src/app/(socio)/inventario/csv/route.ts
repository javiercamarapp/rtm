import { exigirSocio } from '@/composicion/acceso';
import { datosDeSocio } from '@/composicion/datos';
import { inventarioDeSocio } from '@/composicion/inventario';
import { PALABRA_COBERTURA } from '@/dominio/inventario/cobertura';
import { celdaCsv, pesosCsv, respuestaCsv } from '../../_a2/util';

export const dynamic = 'force-dynamic';

/** Inventario por modelo y por sabor en CSV, con valor y costo unitario. Solo socios; la base calcula todo. El valor del sabor es a costo del modelo. */
export async function GET() {
  await exigirSocio();
  const [inv, det] = await Promise.all([(await inventarioDeSocio()).completo(), (await datosDeSocio()).detalleInventario(null, null)]);
  const dM = new Map(det.modelos.map((d) => [d.modelo_id, d]));
  const dS = new Map(det.sabores.map((d) => [d.sku_id, d]));
  const cab = ['Nivel', 'Marca', 'Modelo', 'Sabor', 'Piezas', 'Apartadas', 'Disponibles', 'Costo unitario', 'Valor total (sabor: a costo del modelo)', 'Entradas del periodo', 'Salidas del periodo', 'Mermas del periodo', 'Cobertura (dias)', 'Semaforo', 'Ultima entrada'];
  const lineas = [`Inventario al corte ${inv.corte}; periodo ${det.ini} a ${det.fin}`, cab.join(',')];
  for (const x of inv.modelos.filter((z) => z.piezas !== null)) {
    const d = dM.get(x.modelo_id);
    lineas.push(['Modelo', x.marca, x.modelo, '', x.piezas, x.reservado, x.disponible, pesosCsv(x.costo_prom_cent), pesosCsv(x.valor_cent), d?.entradas ?? 0, d?.salidas ?? 0, d?.mermas ?? 0, x.cobertura_dias, x.estado ? PALABRA_COBERTURA[x.estado] : '', d?.ultima_entrada ?? ''].map((v) => celdaCsv(v as string | number | null)).join(','));
    for (const s of x.sabores) {
      const e = dS.get(s.sku_id);
      lineas.push(['Sabor', x.marca, x.modelo, s.sabor, s.piezas, s.reservado, s.disponible, pesosCsv(x.costo_prom_cent), pesosCsv(s.valor_cent), e?.entradas ?? 0, e?.salidas ?? 0, e?.mermas ?? 0, s.cobertura_dias, s.estado ? PALABRA_COBERTURA[s.estado] : '', e?.ultima_entrada ?? ''].map((v) => celdaCsv(v as string | number | null)).join(','));
    }
  }
  lineas.push(['Total', '', '', '', inv.totales.piezas, inv.totales.reservado, '', '', pesosCsv(inv.totales.valor_cent)].map((v) => celdaCsv(v as string | number | null)).join(','));
  return respuestaCsv('inventario', lineas);
}
