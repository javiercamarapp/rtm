import type { Metadata } from 'next';
import { pagoRentaDeSocio } from '@/composicion/pago-renta';
import { esPaso } from '@/dominio/pago-renta/calculos';
import { PanelPagoRenta } from '@/ui/pago-renta/panel';
import { RegistrarPagoRenta } from './formulario-pago';

export const metadata: Metadata = { title: 'Pago renta' };

export default async function PaginaPagoRenta({ searchParams }: { searchParams: Promise<{ paso?: string }> }) {
  const { paso: p } = await searchParams;
  const panel = await pagoRentaDeSocio();
  return <PanelPagoRenta panel={panel} modo="socio" paso={esPaso(p) ? p : 'semana'} ruta="/pago-renta" acciones={<RegistrarPagoRenta porPagarCent={Number(panel.estado.por_pagar_cent)} />} />;
}
