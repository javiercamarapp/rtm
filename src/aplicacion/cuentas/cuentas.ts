// Casos de uso de la pantalla Cuentas. Validan, llaman al puerto (api.cuenta_*) y devuelven un eco en palabras. Los permisos NO se deciden aqui:
// la funcion SQL exige rol socio, tipo creable y no cambia el tipo de un correo existente; esta capa solo traduce los errores.
import { normalizarCorreo, sinCorreos, validarAlta, type CampoAlta, type EntradaAlta, type ListaCuentas } from '@/dominio/cuentas/cuentas';

export class ErrorCuentas extends Error {
  constructor(message: string, readonly codigo: string | null) {
    super(message);
  }
}

export interface PuertoCuentas {
  listar(): Promise<ListaCuentas>;
  alta(clave: string, e: EntradaAlta): Promise<{ estado: 'creada' | 'sin_cambio' | 'desactivada'; accesoCreado: boolean }>;
  cambiarEstado(clave: string, correo: string, activo: boolean, motivo: string | null): Promise<{ estado: 'reactivada' | 'desactivada' | 'sin_cambio' }>;
}

export type ResultadoCuentas<K extends string = never> =
  | { ok: true; eco: string }
  | { ok: false; mensaje: string; errores: Partial<Record<K, string>> };

const CLAVE = /^web:[0-9a-f-]{8,64}$/;
const falla = <K extends string>(mensaje: string, errores: Partial<Record<K, string>> = {}): ResultadoCuentas<K> => ({ ok: false, mensaje, errores });

const MENSAJES: Record<string, string> = {
  '42501': 'Tu sesión no puede hacer esto: solo un socio administra cuentas, y desde la web solo se crean cuentas de bodega.',
  '23505': 'Ese correo ya tiene otro tipo de cuenta. No se puede cambiar desde la web.',
  '22023': 'Revisa el correo y el tipo de cuenta.',
  P0409: 'Esa operación ya se había enviado con otros datos. Recarga la página.',
  '54000': 'Se alcanzó el tope de cuentas creadas desde la web. Desactiva alguna que ya no se use.',
};
function mensajeDe(e: unknown): string {
  if (e instanceof ErrorCuentas) return (e.codigo && MENSAJES[e.codigo]) || 'No se pudo guardar. Intenta de nuevo.';
  return 'No se pudo guardar. Intenta de nuevo.';
}

export async function darDeAlta(p: PuertoCuentas, clave: string, entrada: EntradaAlta, tiposCreables: readonly string[]): Promise<ResultadoCuentas<CampoAlta>> {
  if (!CLAVE.test(clave)) return falla('Falta la clave de la operación. Recarga la página.');
  const v = validarAlta(entrada, tiposCreables);
  if (!v.ok) return falla('Revisa los campos marcados.', v.errores);
  try {
    const r = await p.alta(clave, v.valor);
    if (r.estado === 'sin_cambio') return { ok: true, eco: `Ese correo ya tenía acceso de ${v.valor.tipo}: no se duplicó.` };
    if (r.estado === 'desactivada') return falla('Ese correo ya existe y está desactivado. Reactívalo desde la lista.');
    return { ok: true, eco: r.accesoCreado ? `Cuenta creada: ${v.valor.correo} ya puede pedir su enlace de acceso.` : `Cuenta creada: ${v.valor.correo}. Falta crear su acceso con «npm run acceso:cuentas»; después podrá pedir su enlace.` };
  } catch (e) {
    return falla(mensajeDe(e));
  }
}

export async function cambiarEstado(p: PuertoCuentas, clave: string, correo: string, activo: boolean, motivo: string | null): Promise<ResultadoCuentas> {
  if (!CLAVE.test(clave)) return falla('Falta la clave de la operación. Recarga la página.');
  const c = normalizarCorreo(correo);
  if (c === '') return falla('Falta el correo.');
  try {
    const r = await p.cambiarEstado(clave, c, activo, motivo && motivo.trim() !== '' ? sinCorreos(motivo).slice(0, 200) : null);
    if (r.estado === 'sin_cambio') return { ok: true, eco: 'La cuenta ya estaba así: no hubo cambio.' };
    return { ok: true, eco: r.estado === 'desactivada' ? 'Cuenta desactivada: ya no puede entrar y se cerraron sus sesiones. Se conserva para reactivarla.' : 'Cuenta reactivada.' };
  } catch (e) {
    return falla(mensajeDe(e));
  }
}
