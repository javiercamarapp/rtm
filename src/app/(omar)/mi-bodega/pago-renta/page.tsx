import type { Metadata } from 'next';
import { pagoRentaDeOmar } from '@/composicion/pago-renta';
import { esPaso } from '@/dominio/pago-renta/calculos';
import { PanelPagoRenta } from '@/ui/pago-renta/panel';

export const metadata: Metadata = { title: 'Pago renta' };

/** Solo lectura: Omar ve piezas, tarifa, devengado, pagado, por pagar, sus pagos y la proyeccion. Nada de clientes, costos, margenes ni contabilidad. */
export default async function PaginaPagoRentaOmar({ searchParams }: { searchParams: Promise<{ paso?: string }> }) {
  const { paso: p } = await searchParams;
  const panel = await pagoRentaDeOmar();
  return <PanelPagoRenta panel={panel} modo="omar" paso={esPaso(p) ? p : 'semana'} ruta="/mi-bodega/pago-renta" />;
}
