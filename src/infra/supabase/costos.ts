// Lecturas de la pantalla de costos con la sesion del usuario (api.costos_*). Las escrituras pasan por la lista cerrada de acciones.
import { centavosABigint } from '@/dominio/operacion/json';
import type { CargoVista, CuentaCostos, ExplicacionCargo, ResumenMesVista, ServicioVista } from '@/dominio/costos/vista';
import { crearClienteServidor } from './cliente-servidor';

async function leer<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return centavosABigint<T>(data);
}

export interface LectorCostos {
  servicios(): Promise<ServicioVista[]>;
  resumen(mes: string, incluirConstruccion: boolean): Promise<ResumenMesVista>;
  cargos(mes: string | null): Promise<CargoVista[]>;
  cuenta(socio: 'angelo' | 'javier'): Promise<CuentaCostos>;
  explicar(cargoId: number): Promise<ExplicacionCargo>;
  tipoCambio(fecha: string): Promise<{ fecha: string; tc_micro: number; fuente: string } | null>;
}

export function lectorCostosSupabase(): LectorCostos {
  return {
    servicios: () => leer('costos_servicios'),
    resumen: (mes, inc) => leer('costos_resumen', { p_mes: mes, p_incluir_construccion: inc }),
    cargos: (mes) => leer('costos_cargos', { p_mes: mes }),
    cuenta: (s) => leer('costos_cuenta', { p_socio: s }),
    explicar: (id) => leer('costos_explicar', { p_cargo_id: id }),
    tipoCambio: (f) => leer('costos_tipo_cambio', { p_fecha: f }),
  };
}
