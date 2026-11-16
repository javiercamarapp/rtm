import type { Metadata } from 'next';
import { hoyDeBodega } from '@/composicion/bodega';
import { etiquetaFecha, formatearPiezas } from '@/dominio/formato';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { empacarAccion } from '../acciones';
import { ErrorLectura, TablaSurtido, TarjetaCliente } from '@/ui/bodega/listas';

export const metadata: Metadata = { title: 'Hoy a preparar' };

export default async function PaginaHoyBodega() {
  const l = await hoyDeBodega();
  if (l.estado !== 'ok') {
    return <Pagina ancho="tablero"><EncabezadoPagina eyebrow="Bodega" titulo="Hoy a preparar" /><ErrorLectura /></Pagina>;
  }
  const d = l.datos;
  const r = d.resumen;
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Bodega · ${d.fecha ? etiquetaFecha(d.fecha) : 'hoy'}`}
        titulo={r.pedidos === 0 ? 'No hay pedidos por preparar' : `${r.pedidos} ${r.pedidos === 1 ? 'pedido' : 'pedidos'} por preparar, ${formatearPiezas(r.piezas)}`}
        descripcion={r.pedidos === 0 ? 'Cuando un socio confirme un pedido que sale de la bodega, aparecerá aquí.' : `${r.clientes} ${r.clientes === 1 ? 'cliente' : 'clientes'} · ${r.porEmpacar} por empacar${r.deDiasAnteriores ? ` · ${r.deDiasAnteriores} de días anteriores` : ''}.`}
      />
      <KpiLinea
        etiquetaAria="Resumen de lo que hay que preparar"
        celdas={[
          { id: 'clientes', testid: 'bodega-kpi-clientes', etiqueta: 'Clientes', valor: String(r.clientes), categoria: 1 },
          { id: 'pedidos', testid: 'bodega-kpi-pedidos', etiqueta: 'Pedidos', valor: String(r.pedidos), categoria: 6 },
          { id: 'piezas', testid: 'bodega-kpi-piezas', etiqueta: 'Piezas por tomar', valor: formatearPiezas(r.piezas), categoria: 3 },
          { id: 'empacar', testid: 'bodega-kpi-empacar', etiqueta: 'Por empacar', valor: String(r.porEmpacar), categoria: 4 },
        ]}
      />
      <Rejilla dividir="6-6" alinear="inicio">
        <Tarjeta titulo="Por cliente" descripcion="Qué preparar para cada uno">
          {d.clientes.length === 0
            ? <p className="rtm-nota" data-testid="bodega-vacio">Sin pedidos por preparar.</p>
            : <ul className="bodega-lista">{d.clientes.map((c) => <TarjetaCliente key={c.cliente} c={c} empacar={empacarAccion} />)}</ul>}
        </Tarjeta>
        <Tarjeta plana titulo="Lista de surtido" descripcion="Todo junto, por modelo y sabor, contra lo que hay">
          <TablaSurtido surtido={d.surtido} />
        </Tarjeta>
      </Rejilla>
    </Pagina>
  );
}
