// Lectura del Pago de renta con la sesion del usuario (llave publica): api.pago_renta_panel para el socio y omar.mi_pago_renta para Omar.
// Cada funcion valida el rol dentro de la base; aqui solo se convierte el jsonb (centavos a bigint).
import { centavosABigint } from '@/dominio/operacion/json';
import type { PanelRenta } from '@/dominio/pago-renta/tipos';
import { crearClienteServidor } from './cliente-servidor';

export async function leerPanelRentaSocio(): Promise<PanelRenta> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc('pago_renta_panel', { p_hoy: null });
  if (error) throw new Error(`pago_renta_panel: ${error.message}`);
  return centavosABigint<PanelRenta>(data);
}

export async function leerPanelRentaOmar(): Promise<PanelRenta> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.schema('omar').rpc('mi_pago_renta');
  if (error) throw new Error(`mi_pago_renta: ${error.message}`);
  return centavosABigint<PanelRenta>(data);
}
