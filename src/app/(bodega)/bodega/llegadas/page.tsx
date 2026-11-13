import type { Metadata } from 'next';
import { llegadasDeBodega } from '@/composicion/bodega';
import { etiquetaFecha, formatearPiezas } from '@/dominio/formato';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { ErrorLectura, TablaPorGuardar, TarjetaCompra } from '@/ui/bodega/listas';

export const metadata: Metadata = { title: 'Llegadas de inventario' };

export default async function PaginaLlegadasBodega() {
  const l = await llegadasDeBodega();
  if (l.estado !== 'ok') {
    return <Pagina ancho="tablero"><EncabezadoPagina eyebrow="Bodega" titulo="Llegadas de inventario" /><ErrorLectura /></Pagina>;
  }
  const d = l.datos;
  const piezas = d.compras.reduce((a, c) => a + c.piezas, 0);
  const llegaron = d.compras.filter((c) => c.estado === 'llego_merida').length;
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Bodega · ${d.fecha ? etiquetaFecha(d.fecha) : 'hoy'}`}
        titulo={d.compras.length === 0 ? 'No hay llegadas por recibir' : `${d.compras.length} ${d.compras.length === 1 ? 'llegada' : 'llegadas'} por recibir, ${formatearPiezas(piezas)}`}
        descripcion={d.compras.length === 0 ? 'Cuando un socio confirme una compra para la bodega, aparecerá aquí.' : `${llegaron} ya ${llegaron === 1 ? 'llegó' : 'llegaron'} a Mérida. Cuenta lo que llega y guárdalo por modelo y sabor; los socios registran la recepción.`}
      />
      <Rejilla dividir="6-6" alinear="inicio">
        <Tarjeta titulo="Por proveedor" descripcion="Lo que viene en camino o ya llegó">
          {d.compras.length === 0
            ? <p className="rtm-nota" data-testid="bodega-vacio">Sin llegadas por recibir.</p>
            : <ul className="bodega-lista">{d.compras.map((c) => <TarjetaCompra key={c.folio} c={c} />)}</ul>}
        </Tarjeta>
        <Tarjeta plana titulo="Por guardar" descripcion="Piezas esperadas, sumadas por modelo y sabor">
          <TablaPorGuardar lineas={d.porGuardar} />
        </Tarjeta>
      </Rejilla>
    </Pagina>
  );
}
