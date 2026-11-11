import type { Metadata } from 'next';
import { EncabezadoPagina, EstadoVacio } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../contexto';

export const metadata: Metadata = { title: 'Proveedores' };

export default function Pagina() {
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Proveedores · ${etiquetaHoy()}`}
        antes="Isaac y Karen,"
        enfasis="siempre separados"
        contexto="Cada proveedor tiene su cuenta, su hoja y su liquidación; nunca se mezclan."
      />
      <EstadoVacio titulo="Sin compras ni pagos" texto="Aquí verás lo que falta por saldar con cada proveedor, con su comprobación y su procedencia." />
    </>
  );
}
