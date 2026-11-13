// Implementa el puerto de dropshipping con las funciones api.ds_* (sesion del socio, llave publica; nunca la de servicio).
import type { FiltroPedidosDs, LectorDropshipping } from '@/aplicacion/dropshipping/puertos';
import type { Explicacion } from '@/dominio/catalogo/tipos';
import { centavosABigint } from '@/dominio/operacion/json';
import { cabecerasLlave } from '@/config/llave_destinatario';
import { crearClienteServidor } from './cliente-servidor';

async function llamar<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  // La llave de cifrado de los destinatarios viaja por cabecera solo en la ruta del servidor (nunca al navegador).
  const sb = await crearClienteServidor(cabecerasLlave());
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return centavosABigint<T>(data);
}

interface ExplicacionCruda {
  cifra: string; titulo: string; unidad: 'pz' | 'mxn' | 'ident'; valor: number | null;
  comprobacion?: { via1: string; via1_valor: number; via2: string; via2_valor: number; cuadra: boolean };
  renglones?: { concepto: string; monto_cent: bigint; fecha_neg?: string | null }[];
}

function aExplicacion(e: ExplicacionCruda): Explicacion {
  return {
    cifra: e.cifra, titulo: e.titulo, unidad: e.unidad, valor: e.valor,
    comprobacion: e.comprobacion ? { via1: e.comprobacion.via1, via1Valor: e.comprobacion.via1_valor, via2: e.comprobacion.via2, via2Valor: e.comprobacion.via2_valor, cuadra: e.comprobacion.cuadra } : null,
    movimientos: [], precioCent: null, costos: [],
    renglones: (e.renglones ?? []).map((r) => ({ concepto: r.concepto, montoCent: r.monto_cent, saldoCent: null, hora: null, fechaNeg: r.fecha_neg ?? null, evento: null, canal: null, autor: null, mensajeOrigen: null })),
  };
}

export function lectorDropshippingSupabase(): LectorDropshipping {
  return {
    resumen: (d, h) => llamar('ds_resumen', { p_desde: d ?? null, p_hasta: h ?? null }),
    pedidos: (f: FiltroPedidosDs) =>
      llamar('ds_pedidos', {
        p_origen_surtido: f.origenSurtido ?? null, p_proveedor: f.proveedor ?? null, p_estado: f.estado ?? null, p_cliente_id: f.clienteId ?? null, p_desde: f.desde ?? null, p_hasta: f.hasta ?? null,
        p_busqueda: f.busqueda ?? null, p_tipo_venta: f.tipoVenta ?? null,
      }),
    ficha: (id) => llamar('ds_ficha', { p_pedido: id }),
    destinatario: (id) => llamar('ds_destinatario', { p_pedido: id }),
    cuentaProveedor: (p) => llamar('ds_cuenta_proveedor', { p_proveedor: p }),
    porCobrar: () => llamar('ds_por_cobrar'),
    catalogo: (c, o) => llamar('ds_catalogo', { p_cliente_id: c, p_origen: o }),
    desglose: (dim, d, h, o) => llamar('ds_desglose', { p_dim: dim, p_desde: d ?? null, p_hasta: h ?? null, p_origen_surtido: o ?? null }),
    utilidad: (d, h) => llamar('ds_utilidad', { p_desde: d ?? null, p_hasta: h ?? null }),
    reporteMensual: (n) => llamar('ds_reporte_mensual', { p_meses: n }),
    conciliacion: (i, f) => llamar('ds_conciliacion', { p_ini: i, p_fin: f }),
    aportacionNeta: () => llamar('socios_aportacion_neta'),
    orden: (id, completo) => llamar('ds_orden_proveedor', { p_pedido: id, p_completo: completo }),
    revelar: async (id, campo, motivo) => (await llamar<{ valor: string }>('ds_destinatario_revelar', { p_pedido: id, p_campo: campo, p_motivo: motivo })).valor,
    menudeo: (socio, f) => llamar('ds_menudeo', { p_socio: socio, p_desde: f.desde ?? null, p_hasta: f.hasta ?? null, p_proveedor: f.proveedor ?? null, p_estado: f.estadoPago ?? null }),
    menudeoPendientes: () => llamar('ds_menudeo_pendientes'),
    fondosEnPoder: (socio) => llamar('ds_fondos_en_poder', { p_socio: socio }),
    evidencia: (id) => llamar('ds_evidencia', { p_reporte: id }),
    explicar: async (cifra) => aExplicacion(await llamar<ExplicacionCruda>(cifra.startsWith('dsu:') ? 'ds_explicar_utilidad' : cifra.startsWith('dsm:') ? 'ds_explicar_menudeo' : 'ds_explicar', { p_cifra: cifra })),
  };
}
