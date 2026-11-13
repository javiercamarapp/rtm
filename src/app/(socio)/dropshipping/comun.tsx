import { Pestanas } from '@/ui/componentes/controles';
import type { OrigenSurtido } from '@/dominio/dropshipping/tipos';

export const ORIGEN_SURTIDO: Record<OrigenSurtido, string> = { dropshipping: 'Dropshipping', inventario_merida: 'Inventario en Mérida' };
export const TIPO_VENTA: Record<string, string> = { cliente: 'De cliente', socio_a_costo: 'A costo para socio' };
export const FUENTE_PAGO: Record<string, string> = {
  sociedad: 'Dinero de la sociedad', socio_fondos: 'Un socio, con fondos de la sociedad que tiene', socio_propio: 'Un socio, con su dinero (reembolso)', socio_capital: 'Un socio, con su dinero declarado como capital',
  cliente_a_proveedor: 'El cliente pagó directo a la cuenta del proveedor',
};

export type PestanaDs = 'resumen' | 'pedidos' | 'nuevo' | 'pagos' | 'por-cobrar' | 'utilidad';

/** Pestañas de la sección Dropshipping (máximo 6). */
export function PestanasDs({ activa, sinFolio }: { activa: PestanaDs; sinFolio?: number }) {
  const items: { id: PestanaDs; etiqueta: string; href: string; contador?: number }[] = [
    { id: 'resumen', etiqueta: 'Resumen', href: '/dropshipping' },
    { id: 'pedidos', etiqueta: 'Pedidos', href: '/dropshipping/pedidos', contador: sinFolio && sinFolio > 0 ? sinFolio : undefined },
    { id: 'nuevo', etiqueta: 'Nuevo pedido', href: '/dropshipping/nuevo' },
    { id: 'pagos', etiqueta: 'Pagos al proveedor', href: '/dropshipping/pagos' },
    { id: 'por-cobrar', etiqueta: 'Por cobrar', href: '/dropshipping/por-cobrar' },
    { id: 'utilidad', etiqueta: 'Utilidad', href: '/dropshipping/utilidad' },
  ];
  return <Pestanas etiquetaAria="Secciones de Dropshipping" items={items.map((i) => ({ ...i, activa: i.id === activa, testid: `ds-pestana-${i.id}` }))} />;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Fecha AAAA-MM-DD válida o null (los parámetros de la URL nunca llegan crudos a la base). */
export function fechaOpcional(v: string | undefined): string | null {
  return v && FECHA.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null;
}
