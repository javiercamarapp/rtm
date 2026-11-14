// Implementa los puertos de inventario con las funciones api.* (sesion del usuario, llave publica; nunca la de servicio).
import type { EscritorInventario, LectorInventario } from '@/aplicacion/inventario/puertos';
import type { DocumentoGuardado, DocumentoReservado } from '@/dominio/inventario/tipos';
import { centavosABigint } from '@/dominio/operacion/json';
import { crearClienteServidor } from './cliente-servidor';

async function llamar<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return centavosABigint<T>(data);
}

export class ErrorInventario extends Error {
  constructor(message: string, readonly codigo: string | null) {
    super(message);
  }
}

async function escribir<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new ErrorInventario(error.message, error.code ?? null);
  return centavosABigint<T>(data);
}

export function lectorInventarioSupabase(): LectorInventario {
  return {
    completo: () => llamar('inventario_completo'),
    kardex: (modeloId, skuId, ini, fin, limite) => llamar('inventario_kardex', { p_modelo: modeloId, p_sku: skuId, p_ini: ini, p_fin: fin, p_limite: limite }),
    conteoHoja: (ubicacion) => llamar('conteo_hoja', { p_ubicacion: ubicacion }),
    concilia: () => llamar('inventario_concilia'),
    conteoPrevisualizar: (ubicacion, lineas) => llamar('conteo_previsualizar', { p_ubicacion: ubicacion, p_lineas: lineas }),
    conteos: () => llamar('conteos_lista'),
    conteo: (id) => llamar('conteo_detalle', { p_conteo: id }),
    async documento(id) {
      const d = await llamar<(DocumentoGuardado & { base64: string | null }) | null>('documento_inventario', { p_id: id });
      return d;
    },
    documentos: () => llamar('documentos_inventario'),
  };
}

export function escritorInventarioSupabase(): EscritorInventario {
  return {
    abrirConteo: (clave, ubicacion, tipo, contadoAt) => escribir('abrir_conteo', { p_clave_idem: clave, p_ubicacion: ubicacion, p_tipo: tipo, p_contado_at: contadoAt }),
    cerrarConteo: (clave, conteoId, lineas) => escribir('cerrar_conteo', { p_clave_idem: clave, p_conteo_id: conteoId, p_lineas: lineas }),
    agregarSabor: (clave, modeloId, sabor, confirmar) => escribir('conteo_agregar_sabor', { p_clave_idem: clave, p_modelo_id: modeloId, p_sabor: sabor, p_confirmar: confirmar }),
    reservarDocumento: (clave, version, params) => escribir<DocumentoReservado>('reservar_documento_inventario', { p_clave_idem: clave, p_version: version, p_params: params }),
    async completarDocumento(id, sha256, bytes) {
      await escribir('completar_documento_inventario', { p_id: id, p_sha256: sha256, p_base64: Buffer.from(bytes).toString('base64') });
    },
  };
}
