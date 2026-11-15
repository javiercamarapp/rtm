import { formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { Pulso as DatosPulso } from '@/dominio/notificaciones/tipos';

/** Pulso de 4 indicadores con datos reales (tablero de inicio). Sin ningun hecho que lo respalde se muestra "Sin dato", nunca un cero inventado. */
export function chipsPulso(p: DatosPulso | null): { id: string; etiqueta: string; texto: string | null; href: string; ayuda: string }[] {
  return [
    { id: 'isaac', etiqueta: 'Por pagar a Isaac', texto: p?.por_pagar_isaac_cent == null ? null : formatearMoneda(p.por_pagar_isaac_cent), href: '/proveedores', ayuda: 'Deuda de la empresa con Isaac: el total del Mayor (cuenta 2110) menos los pedidos a costo del socio de menudeo que aún no paga, que van aparte y no son deuda de la empresa. Es la misma cifra de Proveedores' },
    { id: 'cobrar', etiqueta: 'Por cobrar', texto: p?.por_cobrar_cent == null ? null : formatearMoneda(p.por_cobrar_cent), href: '/cuentas-por-cobrar', ayuda: 'Saldo de los pedidos enviados' },
    { id: 'socios', etiqueta: 'Entre socios', texto: p?.entre_socios == null ? null : (p.entre_socios.diferencia_cent === 0n ? 'En paz' : `${p.entre_socios.socio} +${formatearMoneda(p.entre_socios.diferencia_cent)}`), href: '/socios', ayuda: 'Diferencia entre las posiciones netas de los socios' },
    { id: 'bodega', etiqueta: 'En bodega', texto: p?.en_bodega == null ? null : `${formatearPiezas(p.en_bodega.piezas)} · ${formatearMoneda(p.en_bodega.valor_cent)}`, href: '/inventario', ayuda: 'Existencia y su valor a costo promedio' },
  ];
}
