// Casos de uso de la vista de bodega: solo lectura. La base valida el rol dentro de cada funcion (bodega activo o socio en vista previa).
import type { HoyAPreparar, Llegadas, ResultadoEmpaque } from '@/dominio/bodega/bodega';

export interface LectorBodega {
  hoy(): Promise<HoyAPreparar>;
  llegadas(): Promise<Llegadas>;
}

/** Una lectura que falla se muestra como error en palabras; nunca como ceros inventados. */
export type LecturaBodega<T> = { estado: 'ok'; datos: T } | { estado: 'error' };

export async function leer<T>(f: () => Promise<T>): Promise<LecturaBodega<T>> {
  try {
    return { estado: 'ok', datos: await f() };
  } catch {
    return { estado: 'error' };
  }
}

export type { ResultadoEmpaque };

export interface AccionesBodega {
  marcarEmpacado(clave: string, folio: string): Promise<void>;
}


const CLAVE = /^web:[0-9a-f-]{8,64}$/;
const FOLIO = /^[A-Z]{1,3}-\d{3,9}$/;

/** Marcar empacado: valida clave y folio, llama a la funcion propia de bodega y traduce los errores sin texto tecnico. */
export async function empacar(a: AccionesBodega, clave: string, folio: string): Promise<ResultadoEmpaque> {
  if (!CLAVE.test(clave)) return { ok: false, mensaje: 'Falta la clave de la operación. Recarga la página.' };
  if (!FOLIO.test(folio)) return { ok: false, mensaje: 'Pedido no válido.' };
  try {
    await a.marcarEmpacado(clave, folio);
    return { ok: true };
  } catch (e) {
    const codigo = e instanceof Error ? e.message : '';
    if (codigo === 'P0428') return { ok: false, mensaje: 'Ese pedido ya no está por preparar. Recarga la página.' };
    if (codigo === '42501') return { ok: false, mensaje: 'Tu sesión no puede hacer esto.' };
    return { ok: false, mensaje: 'No se pudo guardar. Intenta de nuevo; no se duplicará.' };
  }
}
