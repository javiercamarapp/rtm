import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../../../contexto';
import { FormularioCompra } from './formulario-compra';

export const metadata: Metadata = { title: 'Nueva orden de compra' };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ p?: string; modelo?: string; d?: string }> }) {
  const { p, modelo, d } = await searchParams;
  const proveedor = p === 'Karen' ? 'Karen' : 'Isaac';
  const catalogo = await (await operacionDeSocio()).catalogoCompra(proveedor);
  return (
    <>
      <p className="rtm-migaja"><Link href={`/proveedores?p=${proveedor}`}>Proveedores</Link> / Nueva orden de compra</p>
      <EncabezadoPagina
        eyebrow={`Nueva orden de compra · ${etiquetaHoy()}`}
        antes="Orden de compra a"
        enfasis={proveedor}
        contexto="Cada renglón lleva el costo vigente del proveedor; si cambias el costo, el motivo es obligatorio. Pagadas, facturadas y recibidas son tres cantidades distintas: las recibidas se confirman en Mérida, por sabor."
      />
      <FormularioCompra proveedor={proveedor} catalogo={catalogo} {...(modelo ? { modeloInicial: modelo } : {})} {...(d ? { disponibles: d.split(',').filter(Boolean) } : {})} />
    </>
  );
}
