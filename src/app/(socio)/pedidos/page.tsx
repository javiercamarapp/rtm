import type { Metadata } from 'next';
import { EncabezadoPagina, EstadoVacio } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../contexto';

export const metadata: Metadata = { title: 'Pedidos y notas' };

export default function Pagina() {
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Pedidos y notas · ${etiquetaHoy()}`}
        antes="Aún no hay"
        enfasis="pedidos"
        contexto="Cada pedido nace con su nota para el cliente y su hoja interna, y se comprueba por dos vías antes de enviarse."
      />
      <EstadoVacio titulo="Sin pedidos todavía" texto="Cuando exista el catálogo con costos y precios, aquí aparecerán la lista de pedidos, el estado de pago y los avisos." />
    </>
  );
}
