// Implementa los puertos de operacion con las funciones api.* (sesion del usuario, llave publica; nunca la de servicio).
import type { AccionOperacion, EscritorOperacion, LectorOperacion } from '@/aplicacion/operacion/puertos';
import { centavosABigint } from '@/dominio/operacion/json';
import { crearClienteServidor } from './cliente-servidor';

async function leer<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return centavosABigint<T>(data);
}

export class ErrorDeNegocio extends Error {
  constructor(message: string, readonly codigo: string | null) {
    super(message);
  }
}

export function lectorOperacionSupabase(): LectorOperacion {
  return {
    pedidos: () => leer('pedidos_lista'),
    pedido: (id) => leer('pedido_detalle', { p_pedido: id }),
    catalogoPedido: (c) => leer('pedido_catalogo', { p_cliente_id: c }),
    notaFuente: (id) => leer('nota_fuente', { p_nota: id }),
    documento: (id, v) => leer('nota_documento', { p_nota: id, p_variante: v }),
    porHacer: () => leer('paquetes_por_hacer'),
    enTransito: () => leer('paquetes_en_transito'),
    umbralesPaquetes: () => leer('paquetes_umbrales'),
    compras: (p) => leer('compras_lista', { p_proveedor: p ?? null }),
    compra: (id) => leer('compra_detalle', { p_compra: id }),
    cuentaProveedor: (p) => leer('proveedor_cuenta', { p_proveedor: p }),
    catalogoCompra: (p) => leer('compra_catalogo', { p_proveedor: p }),
    cuentasPorCobrar: () => leer('cuentas_por_cobrar'),
    cxcCliente: (id) => leer('cxc_cliente', { p_cliente: id }),
    contextoPagos: () => leer('pagos_contexto'),
    estadoSocio: (s) => leer('estado_socio', { p_socio: s }),
    avisos: (e) => leer('avisos_lista', { p_estado: e === undefined ? 'abierta' : e }),
    hojaProveedor: (p, s, a) => leer('proveedor_hoja', { p_proveedor: p, p_semana_ini: s, p_ambito: a }),
    notaProveedor: (p, s, a) => leer('nota_proveedor', { p_proveedor: p, p_semana_ini: s, p_ambito: a }),
    liquidacionesProveedor: (p) => leer('liquidaciones_proveedor', { p_proveedor: p }),
    cuentaSocios: () => leer('socios_cuenta'),
    socioCuenta: (s) => leer('socio_cuenta', { p_socio: s }),
    cascadaProyeccion: (i, f) => leer('cascada_proyeccion', { p_ini: i, p_fin: f }),
    cierresReparto: () => leer('cierres_reparto'),
    omarCuenta: (s) => leer('omar_cuenta', { p_semana_ini: s }),
    compraRecepcion: (id) => leer('compra_recepcion', { p_compra: id }),
    devoluciones: () => leer('devoluciones_lista'),
    pedidoDevoluciones: (id) => leer('pedido_devoluciones', { p_pedido: id }),
    catalogoDevolucionProveedor: () => leer('devolucion_proveedor_catalogo'),
    devolucionFuente: (t, id) => leer('devolucion_fuente', { p_tipo: t, p_id: id }),
    devolucionDocumento: (t, id) => leer('devolucion_documento', { p_tipo: t, p_id: id }),
    textoCobro: (id) => leer('texto_cobro', { p_cliente: id }),
  };
}

export function escritorOperacionSupabase(): EscritorOperacion {
  return {
    async ejecutar(accion: AccionOperacion, args) {
      const sb = await crearClienteServidor();
      const { data, error } = await sb.rpc(accion, args);
      if (error) throw new ErrorDeNegocio(error.message, error.code ?? null);
      return (data ?? {}) as Record<string, unknown>;
    },
    async guardarDocumento(notaId, variante, sha256, bytes) {
      const sb = await crearClienteServidor();
      const hex = `\\x${Buffer.from(bytes).toString('hex')}`;
      const { error } = await sb.rpc('guardar_documento_nota', { p_nota: notaId, p_variante: variante, p_sha256: sha256, p_contenido: hex });
      if (error) throw new ErrorDeNegocio(error.message, error.code ?? null);
    },
    async guardarDocumentoDevolucion(tipo, id, sha256, bytes) {
      const sb = await crearClienteServidor();
      const hex = `\\x${Buffer.from(bytes).toString('hex')}`;
      const { error } = await sb.rpc('guardar_documento_devolucion', { p_tipo: tipo, p_devolucion: id, p_variante: 'pdf', p_sha256: sha256, p_contenido: hex });
      if (error) throw new ErrorDeNegocio(error.message, error.code ?? null);
    },
  };
}
