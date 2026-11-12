import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { lectorDeSocio } from '@/composicion/catalogo';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import { editarClienteAccion } from '../../../alta/acciones';
import { etiquetaHoy } from '../../../contexto';
import { FormularioCliente } from '../../formulario-cliente';

export const metadata: Metadata = { title: 'Editar cliente' };

export default async function PaginaEditarCliente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const f = await (await lectorDeSocio()).ficha(n);
  if (!f) notFound();
  return (
    <Pagina ancho="formulario">
      <EncabezadoPagina
        migaja={{ href: `/clientes/${f.id}`, texto: f.nombre }}
        eyebrow={`Editar cliente · ${etiquetaHoy()}`}
        titulo={`Editar a ${f.nombre}`}
        descripcion="Cambia el nombre, el tipo o la nota. Los precios se editan aparte, con vigencia e historial."
        acciones={<Link className="rtm-boton" href={`/clientes/${f.id}/precios`}>Editar sus precios</Link>}
      />
      <Tarjeta titulo="Datos del cliente">
        <FormularioCliente modo="editar" accion={editarClienteAccion.bind(null, f.id)} inicial={{ nombre: f.nombre, tipo: f.tipo, nota: f.nota ?? '', activo: f.activo }} />
      </Tarjeta>
    </Pagina>
  );
}
