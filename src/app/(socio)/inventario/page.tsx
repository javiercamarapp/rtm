import type { Metadata } from 'next';
import { EncabezadoPagina, EstadoVacio } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../contexto';

export const metadata: Metadata = { title: 'Inventario' };

export default function Pagina() {
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Inventario · ${etiquetaHoy()}`}
        antes="Todavía no hay"
        enfasis="existencias"
        contexto="Existencia por modelo y sabor, kárdex con costo promedio y conteo ciego."
      />
      <EstadoVacio titulo="Sin existencias registradas" texto="La existencia sale del libro de movimientos. Se llenará con la primera compra recibida." />
    </>
  );
}
