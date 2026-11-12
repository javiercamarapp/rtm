// Raiz de composicion de pedidos, compras, pagos, paquetes y avisos. Las paginas y las acciones importan de aqui, nunca de infra.
import { obtenerDocumentoDevolucion, obtenerDocumentoNota, type DocumentoDevolucion, type DocumentoNota, type VarianteNota } from '@/aplicacion/operacion/documentos';
import { ACCIONES_OPERACION, type AccionOperacion, type EscritorOperacion, type GeneradorPdf, type LectorOperacion } from '@/aplicacion/operacion/puertos';
import type { ResultadoAccion } from '@/dominio/operacion/tipos';
import { pdfDevolucion } from '@/infra/pdf/devolucion';
import { huella, pdfHojaInterna, pdfNotaCliente } from '@/infra/pdf/nota';
import { ErrorDeNegocio, escritorOperacionSupabase, lectorOperacionSupabase } from '@/infra/supabase/operacion';
import { exigirSocio } from './acceso';

const generador: GeneradorPdf = { notaCliente: pdfNotaCliente, hojaInterna: pdfHojaInterna, devolucion: pdfDevolucion, huella };

/** Lector para paginas de socio: exige sesion de socio ANTES de tocar la base (la autoridad igual es la funcion SQL). */
export async function operacionDeSocio(): Promise<LectorOperacion> {
  await exigirSocio();
  return lectorOperacionSupabase();
}

const MENSAJES: Record<string, string> = {
  P0409: 'Esa operación ya se había enviado con otros datos. Recarga la página.',
  P0422: 'La fecha cae en un periodo que ya se cerró.',
  P0423: 'No hay existencia suficiente para esa salida.',
  P0424: 'Karen exige pago completo antes de confirmar la orden: falta saldo a favor.',
  P0425: 'El pago está sin identificar: asígnalo primero a un cliente.',
  P0427: 'El pedido tiene avisos sin aceptar.',
  P0428: 'Ese paso ya no aplica al estado actual. Recarga la página.',
  '42501': 'Tu sesión no tiene permiso para esto.',
};

/** Ejecuta UNA accion de escritura de la lista cerrada. La clave de idempotencia viene del formulario (`web:<uuid>`): reenviar no duplica. */
export async function ejecutarAccionDeSocio(accion: string, args: Record<string, unknown>): Promise<ResultadoAccion> {
  await exigirSocio();
  if (!(ACCIONES_OPERACION as readonly string[]).includes(accion)) return { ok: false, mensaje: 'Acción desconocida.', codigo: null };
  const clave = args['p_clave_idem'];
  if (typeof clave !== 'string' || !/^web:[0-9a-f-]{8,64}$/.test(clave)) return { ok: false, mensaje: 'Falta la clave de la operación. Recarga la página.', codigo: null };
  if (Object.keys(args).some((k) => !/^p_[a-z0-9_]+$/.test(k))) return { ok: false, mensaje: 'Datos inválidos.', codigo: null };
  try {
    const escritor: EscritorOperacion = escritorOperacionSupabase();
    return { ok: true, datos: await escritor.ejecutar(accion as AccionOperacion, args) };
  } catch (e) {
    if (e instanceof ErrorDeNegocio) {
      const detalle = (e.codigo && MENSAJES[e.codigo]) || null;
      // El texto de la base ya viene en espanol y dice que paso; se muestra completo.
      return { ok: false, mensaje: detalle ? `${detalle} (${e.message})` : e.message, codigo: e.codigo };
    }
    return { ok: false, mensaje: 'No se pudo guardar. Intenta de nuevo.', codigo: null };
  }
}

export async function documentoDeNota(notaId: number, variante: VarianteNota): Promise<DocumentoNota | null> {
  await exigirSocio();
  return obtenerDocumentoNota({ lector: lectorOperacionSupabase(), escritor: escritorOperacionSupabase(), pdf: generador }, notaId, variante);
}

export async function documentoDeDevolucion(tipo: 'cliente' | 'proveedor', id: number): Promise<DocumentoDevolucion | null> {
  await exigirSocio();
  return obtenerDocumentoDevolucion({ lector: lectorOperacionSupabase(), escritor: escritorOperacionSupabase(), pdf: generador }, tipo, id);
}
