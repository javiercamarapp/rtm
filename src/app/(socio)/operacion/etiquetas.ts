// Palabras de la interfaz para estados y origenes (el color nunca va solo: siempre hay una palabra).
import type { EstadoCompra, EstadoPedido, FilaCxc, Origen } from '@/dominio/operacion/tipos';

export type Tono = 'ok' | 'atencion' | 'malo' | 'neutro';

export const ESTADO_PEDIDO: Record<EstadoPedido, { texto: string; tono: Tono }> = {
  borrador: { texto: 'Borrador', tono: 'neutro' },
  confirmado: { texto: 'Confirmado', tono: 'atencion' },
  enviado: { texto: 'Enviado', tono: 'ok' },
  cancelado: { texto: 'Cancelado', tono: 'neutro' },
  anulado: { texto: 'Anulado', tono: 'malo' },
};
export const ORIGEN: Record<Origen, string> = {
  bodega_omar: 'Bodega Omar',
  castores: 'Bodega por Castores',
  karen_directo: 'Karen directo',
  karen_via_isaac: 'Karen vía Isaac',
  isaac_directo: 'Isaac directo',
};
export const ESTADO_COMPRA: Record<EstadoCompra, { texto: string; tono: Tono }> = {
  borrador: { texto: 'Borrador', tono: 'neutro' },
  confirmada: { texto: 'Confirmada', tono: 'atencion' },
  enviada: { texto: 'Enviada', tono: 'atencion' },
  en_trayecto: { texto: 'En trayecto', tono: 'atencion' },
  llego_merida: { texto: 'Llegó a Mérida', tono: 'atencion' },
  recibida: { texto: 'Recibida', tono: 'ok' },
  cerrada: { texto: 'Cerrada', tono: 'ok' },
  anulada: { texto: 'Anulada', tono: 'malo' },
};
export const ESTADO_CXC: Record<FilaCxc['estado'], { texto: string; tono: Tono }> = {
  al_corriente: { texto: 'Al corriente', tono: 'ok' },
  por_vencer: { texto: 'Por vencer', tono: 'atencion' },
  vencido: { texto: 'Vencido', tono: 'malo' },
  sin_plazo: { texto: 'Sin plazo acordado', tono: 'neutro' },
  saldo_a_favor: { texto: 'Saldo a favor', tono: 'neutro' },
};
export const CUBETA: Record<string, string> = { '0_7': '0 a 7 días', '8_14': '8 a 14 días', '15_30': '15 a 30 días', mas_30: 'Más de 30 días' };
export const SEVERIDAD: Record<string, { texto: string; tono: Tono }> = { C: { texto: 'Crítica', tono: 'malo' }, I: { texto: 'Importante', tono: 'atencion' }, F: { texto: 'Informativa', tono: 'neutro' } };
export const CONCEPTO_CUENTA: Record<string, string> = {
  pago_cliente_redirigido: 'Pago de cliente redirigido', pago_socio: 'Pago de un socio', pago_sociedad: 'Pago de la sociedad', oc_aplicada: 'Orden de compra aplicada', ajuste: 'Ajuste',
  reclamo_diferencia: 'Reclamo por diferencia de recepción', reversa: 'Reversa', apertura: 'Saldo de apertura',
};
export const AVISO_PEDIDO: Record<string, string> = {
  precio_distinto_tabulador: 'Precio distinto del tabulador', venta_bajo_costo: 'Venta a costo o bajo costo', sin_precio_catalogo: 'Sin precio de catálogo',
  minimo_piezas: 'Menos de 20 piezas', existencia_insuficiente: 'Existencia insuficiente',
};
