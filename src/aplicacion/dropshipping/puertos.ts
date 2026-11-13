import type { Explicacion } from '@/dominio/catalogo/tipos';
import type {
  AportacionNeta, CatalogoDs, FondosEnPoder, Menudeo, PendientesSocio, ConciliacionPeriodo, CuentaProveedorDs, Destinatario, DimensionDesglose, FichaDs, FilaDesglose, FilaDs, FilaPorCobrar, OrdenProveedor, OrigenSurtido, ReporteMensual,
  ResumenDs, UtilidadDs,
} from '@/dominio/dropshipping/tipos';

export interface FiltroPedidosDs {
  origenSurtido?: OrigenSurtido | null; proveedor?: string | null; estado?: string | null; clienteId?: number | null; desde?: string | null; hasta?: string | null; busqueda?: string | null; tipoVenta?: string | null;
}

/** Lo que la web lee de dropshipping. Cada lectura es una funcion de la base (api.ds_*); la interfaz no calcula dinero. Nada de esto devuelve datos completos del destinatario. */
export interface LectorDropshipping {
  resumen(desde?: string | null, hasta?: string | null): Promise<ResumenDs>;
  pedidos(f: FiltroPedidosDs): Promise<FilaDs[]>;
  ficha(pedidoId: number): Promise<FichaDs | null>;
  destinatario(pedidoId: number): Promise<Destinatario | null>;
  cuentaProveedor(proveedor: string): Promise<CuentaProveedorDs>;
  porCobrar(): Promise<{ hoy: string; filas: FilaPorCobrar[] }>;
  catalogo(clienteId: number, origen: string): Promise<CatalogoDs>;
  desglose(dim: DimensionDesglose, desde?: string | null, hasta?: string | null, origen?: OrigenSurtido | null): Promise<FilaDesglose[]>;
  utilidad(desde?: string | null, hasta?: string | null): Promise<UtilidadDs>;
  reporteMensual(meses: number): Promise<ReporteMensual>;
  conciliacion(ini: string, fin: string): Promise<ConciliacionPeriodo>;
  aportacionNeta(): Promise<AportacionNeta>;
  /** Con completo = true entrega el bloque completo del destinatario y queda AUDITADO (accion orden). */
  orden(pedidoId: number, completo: boolean): Promise<OrdenProveedor>;
  /** Boton "Revelar": telefono o correo completos; queda auditado. */
  revelar(pedidoId: number, campo: 'telefono' | 'correo', motivo: string): Promise<string>;
  /** Pedidos a costo de un socio para su menudeo: renglones, pagado y pendiente de pago. NO restan a su valuacion ni a su aportacion neta. */
  menudeo(socio: string, f: { desde?: string | null; hasta?: string | null; proveedor?: string | null; estadoPago?: string | null }): Promise<Menudeo>;
  /** Dos renglones por socio: pedidos a costo pendientes de pago y fondos de la sociedad cobrados en su cuenta pendientes de entregar. */
  menudeoPendientes(): Promise<PendientesSocio[]>;
  fondosEnPoder(socio: string): Promise<FondosEnPoder>;
  /** Contenido de la evidencia de un pago (solo socios en la web; cada lectura queda registrada). Nunca llega a la IA ni a Telegram. */
  evidencia(reporteId: number): Promise<{ mime: string; nombre: string; sha256: string; b64: string } | null>;
  explicar(cifra: string): Promise<Explicacion>;
}
