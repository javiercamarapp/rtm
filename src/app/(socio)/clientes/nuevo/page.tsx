import type { Metadata } from 'next';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import { crearClienteAccion } from '../../alta/acciones';
import { etiquetaHoy } from '../../contexto';
import { FormularioCliente } from '../formulario-cliente';

export const metadata: Metadata = { title: 'Nuevo cliente' };

export default function PaginaNuevoCliente() {
  return (
    <Pagina ancho="formulario">
      <EncabezadoPagina
        migaja={{ href: '/clientes', texto: 'Clientes' }}
        eyebrow={`Nuevo cliente · ${etiquetaHoy()}`}
        titulo="Dar de alta un cliente"
        descripcion="Solo se guarda el nombre, el tipo y una nota. Después de crearlo puedes cargar su tabulador de precios por modelo."
      />
      <Tarjeta titulo="Datos del cliente">
        <FormularioCliente modo="nuevo" accion={crearClienteAccion} />
      </Tarjeta>
    </Pagina>
  );
}
