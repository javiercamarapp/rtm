// Raiz de composicion del Pago de renta. Las paginas importan de aqui, nunca de infra. La sesion se exige ANTES de tocar la base (la autoridad real es la funcion SQL).
import type { PanelRenta } from '@/dominio/pago-renta/tipos';
import { leerPanelRentaOmar, leerPanelRentaSocio } from '@/infra/supabase/pago-renta';
import { exigirOmar, exigirSocio } from './acceso';

export async function pagoRentaDeSocio(): Promise<PanelRenta> {
  await exigirSocio();
  return leerPanelRentaSocio();
}

export async function pagoRentaDeOmar(): Promise<PanelRenta> {
  await exigirOmar();
  return leerPanelRentaOmar();
}
