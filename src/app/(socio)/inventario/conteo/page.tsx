import type { Metadata } from 'next';
import { inventarioDeSocio } from '@/composicion/inventario';
import { etiquetaFechaHora } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../../contexto';
import { HojaConteo } from './hoja-conteo';

export const metadata: Metadata = { title: 'Conteo físico' };

export default async function Pagina() {
  const lector = await inventarioDeSocio();
  const [hoja, conteos] = await Promise.all([lector.conteoHoja('bodega_omar'), lector.conteos()]);
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Conteo físico · ${etiquetaHoy()}`}
        antes="Cuenta la"
        enfasis="bodega"
        despues="a ciegas"
        contexto="Primero se cuenta, después se muestra la diferencia contra el sistema y se explica (venta no registrada, toma no registrada, error de sabor, reclamo al proveedor, merma o error de conteo). El conteo exige la fecha y la hora en que se contó."
      />
      {hoja.length === 0 ? (
        <div className="rtm-dt-aviso"><strong>Nada que contar todavía</strong><p>La hoja de conteo se arma con los sabores que ya tuvieron una entrada en la Bodega Omar.</p></div>
      ) : (
        <HojaConteo ubicacion="bodega_omar" hoja={hoja} />
      )}
      <section className="rtm-seccion rtm-entra rtm-i-3" aria-label="Conteos anteriores">
        <h2>Conteos anteriores</h2>
        <DataTable
          etiqueta="Conteos anteriores"
          clave={(c) => c.id}
          filas={conteos}
          vacio={{ titulo: 'Sin conteos', texto: 'Cada conteo cerrado queda aquí con su exactitud y las diferencias sin explicar.' }}
          columnas={[
            { id: 'f', titulo: 'Contado', celda: (c) => etiquetaFechaHora(c.contado_at) },
            { id: 'u', titulo: 'Ubicación', secundaria: true, celda: (c) => c.ubicacion },
            { id: 'l', titulo: 'Sabores', numerica: true, celda: (c) => c.lineas },
            { id: 'd', titulo: 'Con diferencia', numerica: true, celda: (c) => c.con_diferencia },
            { id: 's', titulo: 'Sin explicar', numerica: true, celda: (c) => (c.sin_explicar === 0 ? 'Ninguna' : <EstadoTexto tono="atencion">{c.sin_explicar}</EstadoTexto>) },
            { id: 'x', titulo: 'Exactitud', numerica: true, celda: (c) => (c.exactitud_bp === null ? 'Sin dato' : `${(c.exactitud_bp / 100).toFixed(2)} %`) },
            { id: 'e', titulo: 'Estado', celda: (c) => (c.estado === 'cerrado' ? 'Cerrado' : 'Abierto') },
          ]}
        />
      </section>
    </>
  );
}
