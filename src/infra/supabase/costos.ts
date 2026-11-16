// Lecturas de la pantalla de costos con la sesion del usuario (api.costos_*). Las escrituras pasan por la lista cerrada de acciones.
import { centavosABigint } from '@/dominio/operacion/json';
import type { Explicacion } from '@/dominio/catalogo/tipos';
import type { AportacionesSocio, CargoVista, CuentaCostos, ExplicacionCargo, ResumenMesVista, ServicioVista } from '@/dominio/costos/vista';
import { crearClienteServidor } from './cliente-servidor';
import { explicacion, llamar } from './lector-catalogo';

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
  aportaciones(socio: 'angelo' | 'javier'): Promise<AportacionesSocio>;
  /** Cifras costos:aportacion:AAAA-MM y costos:aportacion:total (dos vias, calculadas por la base). */
  explicarCifra(cifra: string): Promise<Explicacion>;
  /** Libro propio de llamadas de IA del mes (liquidadas), en millonesimas de dolar. */
  iaLibro(mes: string): Promise<{ mes: string; total_micro: number; llamadas: number; por_rol: Record<string, number>; ultima_at: string | null }>;
}

export function lectorCostosSupabase(): LectorCostos {
  return {
    servicios: () => leer('costos_servicios'),
    resumen: (mes, inc) => leer('costos_resumen', { p_mes: mes, p_incluir_construccion: inc }),
    cargos: (mes) => leer('costos_cargos', { p_mes: mes }),
    cuenta: (s) => leer('costos_cuenta', { p_socio: s }),
    explicar: (id) => leer('costos_explicar', { p_cargo_id: id }),
    tipoCambio: (f) => leer('costos_tipo_cambio', { p_fecha: f }),
    aportaciones: (s) => leer('costos_aportaciones', { p_socio: s }),
    explicarCifra: (cifra) => llamar('explicar_costos', { p_cifra: cifra }, explicacion),
    iaLibro: (mes) => leer('costos_ia_libro', { p_mes: mes }),
  };
}
