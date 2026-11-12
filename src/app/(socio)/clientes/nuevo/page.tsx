import type { Metadata } from 'next';
import Link from 'next/link';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { crearClienteAccion } from '../../alta/acciones';
import { etiquetaHoy } from '../../contexto';
import { FormularioCliente } from '../formulario-cliente';

export const metadata: Metadata = { title: 'Nuevo cliente' };

export default function Pagina() {
  return (
    <>
      <p className="rtm-migaja"><Link href="/clientes">Clientes</Link> / Nuevo</p>
      <EncabezadoPagina
        eyebrow={`Nuevo cliente · ${etiquetaHoy()}`}
        antes="Dar de alta un"
        enfasis="cliente"
        contexto="Solo se guarda el nombre, el tipo y una nota. Después de crearlo puedes cargar su tabulador de precios por modelo."
      />
      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Datos del cliente">
        <FormularioCliente modo="nuevo" accion={crearClienteAccion} />
      </section>
    </>
  );
}
