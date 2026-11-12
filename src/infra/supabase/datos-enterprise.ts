// Implementa el puerto de lecturas enterprise con las funciones api.* de la migracion 20261112200000 (sesion del usuario, llave publica; nunca la de servicio).
import type { FiltroKardex, LectorDatos } from '@/aplicacion/datos/puertos';
import { bigintACentavos, centavosABigint } from '@/dominio/operacion/json';
import { crearClienteServidor } from './cliente-servidor';

async function leer<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return centavosABigint<T>(data);
}

export const argumentosKardex = (f: FiltroKardex) => ({
  p_marca: f.marca, p_modelo: f.modelo, p_sku: f.sku, p_ini: f.ini, p_fin: f.fin, p_tipo: f.tipo, p_q: f.q, p_limite: f.limite, p_desplazamiento: f.desplazamiento,
});

export function lectorDatosSupabase(): LectorDatos {
  return {
    kardexConsolidado: (f) => leer('inventario_kardex_consolidado', argumentosKardex(f)),
    detalleInventario: (ini, fin) => leer('inventario_detalle', { p_ini: ini, p_fin: fin }),
    resumenMarcas: (ini, fin) => leer('inventario_resumen_marca', { p_ini: ini, p_fin: fin }),
    mermas: (ini, fin, limite, desplazamiento) => leer('inventario_mermas', { p_ini: ini, p_fin: fin, p_limite: limite, p_desplazamiento: desplazamiento }),
    valuacionDetalle: (hasta) => leer('conta_valuacion_detalle', { p_hasta: hasta }),
    valuacionSerie: (desde, hasta, paso) => leer('conta_valuacion_serie', { p_desde: desde, p_hasta: hasta, p_paso: paso }),
    caja: (ini, fin) => leer('caja_resumen', { p_ini: ini, p_fin: fin }),
    libro: (f) => leer('libro_dinero', {
      p_ini: f.ini, p_fin: f.fin, p_estado: f.estado, p_q: f.q, p_min_cent: f.minCent === null ? null : bigintACentavos(f.minCent), p_max_cent: f.maxCent === null ? null : bigintACentavos(f.maxCent),
      p_cuenta: f.cuenta, p_limite: f.limite, p_desplazamiento: f.desplazamiento, p_orden: f.orden,
    }),
  };
}
