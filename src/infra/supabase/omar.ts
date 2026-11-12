// Adaptador de la vista de Omar contra Supabase. Usa la sesion de Omar (llave publica) y SOLO el esquema `omar`: vistas de lista blanca y funciones omar.*.
// Las funciones omar.mis_* y omar.solicitar_toma aun no existen en la base: estan documentadas en docs/pendiente-sql-omar.md. Mientras falten, cada lectura
// devuelve `pendiente_sql` y la solicitud responde `sin_cola`; nada se inventa.
import type { ColaSolicitudes, LectorOmar } from '@/aplicacion/omar/puertos';
import { parsearCuenta, parsearConfiguracion, parsearDisponible, parsearLiquidaciones, parsearPaquetes, parsearSolicitudes } from '@/dominio/omar/lectura';
import type { Lectura, ResultadoSolicitud } from '@/dominio/omar/tipos';
import { crearClienteServidor } from './cliente-servidor';

/** PostgREST: funcion o relacion inexistente en el esquema (aun sin migracion). */
const FALTA = new Set(['PGRST202', 'PGRST205', '42883', '42P01']);

async function vista<T>(nombre: string, parsear: (v: unknown) => T): Promise<Lectura<T>> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.schema('omar').from(nombre).select('*');
  if (error) return FALTA.has(error.code ?? '') ? { estado: 'pendiente_sql' } : { estado: 'error' };
  return { estado: 'ok', datos: parsear(data) };
}

async function funcion<T>(nombre: string, args: Record<string, unknown>, parsear: (v: unknown) => T): Promise<Lectura<T>> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.schema('omar').rpc(nombre, args);
  if (error) return FALTA.has(error.code ?? '') ? { estado: 'pendiente_sql' } : { estado: 'error' };
  return { estado: 'ok', datos: parsear(data) };
}

export function lectorOmarSupabase(): LectorOmar {
  return {
    disponible: () => vista('v_mercancia', parsearDisponible),
    cuenta: () => vista('v_mi_cuenta', parsearCuenta),
    solicitudes: () => funcion('mis_solicitudes', { p_limite: 20 }, parsearSolicitudes),
    liquidaciones: () => funcion('mis_liquidaciones', { p_limite: 8 }, parsearLiquidaciones),
    paquetes: () => funcion('mis_paquetes', {}, parsearPaquetes),
    configuracion: async () => {
      const l = await funcion('mi_configuracion', {}, parsearConfiguracion);
      if (l.estado !== 'ok') return l;
      return l.datos === null ? { estado: 'error' } : { estado: 'ok', datos: l.datos };
    },
  };
}

const MENSAJES: Record<string, { motivo: Extract<ResultadoSolicitud, { ok: false }>['motivo']; mensaje: string }> = {
  P0423: { motivo: 'sin_disponible', mensaje: 'Esa pieza ya no está disponible para tomar. Revisa tu bodega.' },
  '23514': { motivo: 'tope', mensaje: 'La cantidad no es válida o pasa el tope por solicitud.' },
  '42501': { motivo: 'desactivado', mensaje: 'Tu cuenta no tiene permiso para solicitar piezas.' },
};

export function colaSolicitudesSupabase(): ColaSolicitudes {
  return {
    async solicitar(clave, linea) {
      const sb = await crearClienteServidor();
      const { data, error } = await sb.schema('omar').rpc('solicitar_toma', { p_clave_idem: clave, p_modelo: linea.modelo, p_sabor: linea.sabor, p_piezas: linea.piezas });
      if (error) {
        if (FALTA.has(error.code ?? '')) return { ok: false, motivo: 'sin_cola', mensaje: 'Las solicitudes todavía no están habilitadas. Avísale a los socios.' };
        return { ok: false, ...(MENSAJES[error.code ?? ''] ?? { motivo: 'sin_cola' as const, mensaje: 'No se pudo enviar la solicitud. Intenta de nuevo.' }) };
      }
      const r = (data ?? {}) as Record<string, unknown>;
      if (r.estado !== 'pendiente' || typeof r.folio !== 'string') return { ok: false, motivo: 'sin_cola', mensaje: 'No se pudo enviar la solicitud. Intenta de nuevo.' };
      return { ok: true, folio: r.folio, estado: 'pendiente', caduca_at: typeof r.caduca_at === 'string' ? r.caduca_at : '', repetido: r.repetido === true };
    },
  };
}
