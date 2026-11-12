import type { Metadata } from 'next';
import { operacionDeSocio } from '@/composicion/operacion';
import { EncabezadoPagina, Pagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../../../contexto';
import { FormularioCompra } from './formulario-compra';

export const metadata: Metadata = { title: 'Nueva orden de compra' };

export default async function PaginaNuevaCompra({ searchParams }: { searchParams: Promise<{ p?: string; modelo?: string; d?: string }> }) {
  const { p, modelo, d } = await searchParams;
  const proveedor = p === 'Karen' ? 'Karen' : 'Isaac';
  const catalogo = await (await operacionDeSocio()).catalogoCompra(proveedor);
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: `/proveedores?p=${proveedor}`, texto: 'Proveedores' }}
        eyebrow={`Nueva orden de compra · ${etiquetaHoy()}`}
        titulo={`Orden de compra a ${proveedor}`}
        descripcion="Cada renglón lleva el costo vigente del proveedor; si cambias el costo, el motivo es obligatorio. Pagadas, facturadas y recibidas son tres cantidades distintas: las recibidas se confirman en Mérida, por sabor."
      />
      <FormularioCompra proveedor={proveedor} catalogo={catalogo} {...(modelo ? { modeloInicial: modelo } : {})} {...(d ? { disponibles: d.split(',').filter(Boolean) } : {})} />
    </Pagina>
  );
}
