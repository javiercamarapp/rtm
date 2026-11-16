// Adaptador de la vista de bodega contra Supabase: sesion del usuario (llave publica) y SOLO api.bodega_hoy_a_preparar / api.bodega_llegadas.
import type { AccionesBodega, LectorBodega } from '@/aplicacion/bodega/bodega';
import { parsearHoy, parsearLlegadas } from '@/dominio/bodega/bodega';
import { crearClienteServidor } from './cliente-servidor';

export function lectorBodegaSupabase(): LectorBodega {
  return {
    async hoy() {
      const sb = await crearClienteServidor();
      const { data, error } = await sb.rpc('bodega_hoy_a_preparar');
      if (error) throw new Error(error.code ?? 'error');
      return parsearHoy(data);
    },
    async llegadas() {
      const sb = await crearClienteServidor();
      const { data, error } = await sb.rpc('bodega_llegadas');
      if (error) throw new Error(error.code ?? 'error');
      return parsearLlegadas(data);
    },
  };
}

export function accionesBodegaSupabase(): AccionesBodega {
  return {
    async marcarEmpacado(clave, folio) {
      const sb = await crearClienteServidor();
      const { error } = await sb.rpc('bodega_marcar_empacado', { p_clave_idem: clave, p_folio: folio });
      if (error) throw new Error(error.code ?? 'error');
    },
  };
}
