export type SeveridadAviso = 'C' | 'I' | 'F';

export interface NotificacionCampana {
  id: number; nt: string; codigo: string; severidad: SeveridadAviso; titulo: string; entidad_tipo: string | null; entidad_id: number | null; estado: 'abierta' | 'resuelta' | 'descartada' | 'caducada';
  conteo: number; creado_at: string; requiere_accion: boolean; botones: string[]; leida: boolean; telegram: string | null; telegram_no_salio: boolean;
}
export interface ListaCampana { filtro: 'todas' | 'sin_leer'; pagina: number; hay_mas: boolean; sin_leer: number; notificaciones: NotificacionCampana[] }

export interface ItemTuTurno {
  clase: 'aviso' | 'toma'; id: number; codigo: string; severidad: SeveridadAviso; titulo: string; entidad_tipo: string | null; entidad_id: number | null; creado_at: string; botones: string[];
}
export interface TuTurno { items: ItemTuTurno[] }

export interface Pulso {
  por_pagar_isaac_cent: bigint | null;
  por_cobrar_cent: bigint | null;
  entre_socios: { socio: 'Angelo' | 'Javier'; cent: bigint } | null;
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
