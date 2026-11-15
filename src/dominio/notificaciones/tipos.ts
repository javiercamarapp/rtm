import type { PorPagar } from '../operacion/por_pagar';
export type SeveridadAviso = 'C' | 'I' | 'F';

export interface NotificacionCampana {
  id: number; nt: string; codigo: string; severidad: SeveridadAviso; titulo: string; entidad_tipo: string | null; entidad_id: number | null; estado: 'abierta' | 'resuelta' | 'descartada' | 'caducada';
  conteo: number; creado_at: string; requiere_accion: boolean; botones: string[]; leida: boolean; telegram: string | null; telegram_no_salio: boolean;
  /** Solo en avisos ya cerrados (Resueltos recientes): cuando y por que se cerraron. */
  resuelto_at?: string | null; resuelto_motivo?: string | null;
}
/** Contadores de TODO lo vigente (no de la pagina), calculados en la base con la regla de cada aviso. */
export interface ResumenAvisos { criticas: number; importantes: number; informativas: number; piden_accion: number; vigentes: number; resueltos_recientes: number }
export type FiltroAvisos = 'todas' | 'sin_leer' | 'resueltos';
export interface ListaCampana { filtro: FiltroAvisos; pagina: number; hay_mas: boolean; sin_leer: number; resumen?: ResumenAvisos; notificaciones: NotificacionCampana[] }

export interface ItemTuTurno {
  clase: 'aviso' | 'toma'; id: number; codigo: string; severidad: SeveridadAviso; titulo: string; entidad_tipo: string | null; entidad_id: number | null; creado_at: string; botones: string[];
}
export interface TuTurno { items: ItemTuTurno[] }

export interface Pulso {
  /** Por pagar de la empresa con renglones (Isaac, Karen, renta de Omar) y total; la renta ya esta en el libro. */
  por_pagar?: PorPagar | null;
  por_pagar_isaac_cent: bigint | null;
  /** Pedidos a costo del socio de menudeo pendientes de pago con Isaac (aparte: no son deuda de la empresa). */
  por_pagar_isaac_socio_cent?: bigint | null;
  por_cobrar_cent: bigint | null;
  entre_socios: { socio: 'Angelo' | 'Javier'; diferencia_cent: bigint } | null;
  en_bodega: { piezas: number; valor_cent: bigint } | null;
}

/** Destino de un aviso en la interfaz (el aviso lleva la entidad, no un enlace). */
export function destinoAviso(tipo: string | null, id: number | null): string | null {
  if (tipo === null) return null;
  if (tipo === 'pedido' && id !== null) return `/pedidos/${id}`;
  if (tipo === 'compra' && id !== null) return `/proveedores/compras/${id}`;
  if (tipo === 'compra_diferencia') return '/proveedores';
  if (tipo === 'pago') return '/cuentas-por-cobrar';
  if (tipo === 'conteo') return '/inventario/conteo';
  if (tipo === 'comprobacion') return '/contabilidad/comprobaciones';
  if (tipo === 'periodo') return '/contabilidad/comprobaciones';
  if (tipo === 'proveedor') return '/proveedores';
  if (tipo === 'toma') return '/omar';
  if (tipo === 'socios') return '/socios';
  return null;
}
