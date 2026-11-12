import type { Metadata } from 'next';
import { inventarioDeSocio } from '@/composicion/inventario';
import { etiquetaFechaHora } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import '@/ui/estilos/paginas-a2.css';
import { etiquetaHoy } from '../../contexto';
import { HojaConteo } from './hoja-conteo';

export const metadata: Metadata = { title: 'Conteo físico' };

export default async function PaginaConteo() {
  const lector = await inventarioDeSocio();
  const [hoja, conteos] = await Promise.all([lector.conteoHoja('bodega_omar'), lector.conteos()]);
  const cerrados = conteos.filter((c) => c.estado === 'cerrado');
  const ultimo = cerrados[0] ?? null;
  const sinExplicar = conteos.reduce((a, c) => a + c.sin_explicar, 0);
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Conteo físico · ${etiquetaHoy()}`}
        titulo="Cuenta la bodega a ciegas"
        descripcion="Primero se cuenta, después se muestra la diferencia contra el sistema y se explica (venta no registrada, toma no registrada, error de sabor, reclamo al proveedor, merma o error de conteo). El conteo exige la fecha y la hora en que se contó."
      />
      <KpiLinea etiquetaAria="Resumen de conteos" celdas={[
        { id: 'n', etiqueta: 'Conteos', valor: conteos.length === 0 ? null : String(conteos.length), categoria: 1, nota: `${cerrados.length} cerrados` },
        { id: 'x', etiqueta: 'Exactitud del último', valor: ultimo?.exactitud_bp == null ? null : `${(ultimo.exactitud_bp / 100).toFixed(2)} %`, categoria: 2, nota: ultimo ? etiquetaFechaHora(ultimo.contado_at) : undefined },
        { id: 'd', etiqueta: 'Sabores con diferencia (último)', valor: ultimo ? String(ultimo.con_diferencia) : null, categoria: 3, nota: ultimo ? `de ${ultimo.lineas} sabores` : undefined },
        { id: 's', etiqueta: 'Diferencias sin explicar', valor: conteos.length === 0 ? null : String(sinExplicar), categoria: 4, nota: 'En todos los conteos' },
      ]} />
      {hoja.length === 0 ? (
        <div className="rtm-dt-aviso"><strong>Nada que contar todavía</strong><p>La hoja de conteo se arma con los sabores que ya tuvieron una entrada en la Bodega Omar.</p></div>
      ) : (
        <HojaConteo ubicacion="bodega_omar" hoja={hoja} />
      )}
      <Tarjeta plana className="rtm-a2-tabla" titulo="Conteos anteriores">
        <DataTable
          densidad="densa" plana
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
      </Tarjeta>
    </Pagina>
  );
}
