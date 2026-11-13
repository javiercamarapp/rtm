import { ETIQUETA_ESTADO_COMPRA, type ClientePorPreparar, type CompraPorRecibir, type LineaBodega, type Surtido } from '@/dominio/bodega/bodega';
import { etiquetaFecha, formatearPiezas } from '@/dominio/formato';
import { DataTable } from '../componentes/data-table';
import { EstadoTexto } from '../componentes/estado-texto';

export function ErrorLectura() {
  return <p className="rtm-error" role="alert" data-testid="lectura-error">No se pudo cargar. Intenta de nuevo en un momento.</p>;
}

function Lineas({ lineas }: { lineas: LineaBodega[] }) {
  return (
    <ul className="bodega-lineas">
      {lineas.map((l) => (
        <li key={`${l.modelo}|${l.sabor}`}>
          <span>{l.modelo} · {l.sabor}</span>
          <strong>{formatearPiezas(l.piezas)}</strong>
        </li>
      ))}
    </ul>
  );
}

/** Un cliente con sus pedidos por preparar. Solo nombre del cliente, piezas por modelo y sabor, estado de empaque y zona. */
export function TarjetaCliente({ c }: { c: ClientePorPreparar }) {
  return (
    <li className="bodega-cliente" data-testid="bodega-cliente">
      <div className="bodega-cliente-cab">
        <h3 className="bodega-cliente-nombre">{c.cliente}</h3>
        <span className="bodega-cliente-total" data-testid="bodega-cliente-piezas">{formatearPiezas(c.piezas)}</span>
      </div>
      {c.pedidos.map((p) => (
        <div key={p.folio} className="bodega-pedido" data-testid="bodega-pedido">
          <div className="bodega-pedido-cab">
            <span className="rtm-mono">{p.folio}</span>
            <EstadoTexto tono={p.empacado ? 'ok' : 'atencion'}>{p.empacado ? 'Empacado' : 'Por empacar'}</EstadoTexto>
            {!p.deHoy && <EstadoTexto tono="malo">{`De ${etiquetaFecha(p.fecha)}`}</EstadoTexto>}
            {p.zona && <span className="rtm-celda-sub">{p.zona}</span>}
          </div>
          <Lineas lineas={p.lineas} />
        </div>
      ))}
    </li>
  );
}

/** Todo lo que hay que tomar del anaquel, sumado por modelo y sabor, contra lo que hay. */
export function TablaSurtido({ surtido }: { surtido: Surtido[] }) {
  return (
    <DataTable plana densidad="densa" etiqueta="Lista de surtido" clave={(s) => `${s.modelo}|${s.sabor}`} filas={surtido}
      vacio={{ titulo: 'Nada que tomar', texto: 'No hay pedidos por preparar.' }}
      columnas={[
        { id: 'm', titulo: 'Modelo', ancho: 'l', prioridadMovil: 'titulo', celda: (s) => <>{s.modelo}<span className="rtm-celda-sub">{s.sabor}</span></> },
        { id: 'p', titulo: 'Tomar', numerica: true, prioridadMovil: 'principal', celda: (s) => formatearPiezas(s.piezas) },
        { id: 'e', titulo: 'Hay', numerica: true, celda: (s) => formatearPiezas(s.existencia) },
        { id: 'f', titulo: 'Alcanza', celda: (s) => (s.falta > 0 ? <EstadoTexto tono="malo">{`Faltan ${formatearPiezas(s.falta)}`}</EstadoTexto> : <EstadoTexto tono="ok">Sí</EstadoTexto>) },
      ]} />
  );
}

export function TarjetaCompra({ c }: { c: CompraPorRecibir }) {
  return (
    <li className="bodega-cliente" data-testid="bodega-compra">
      <div className="bodega-cliente-cab">
        <h3 className="bodega-cliente-nombre">{c.proveedor || 'Compra'} <span className="rtm-mono">{c.folio}</span></h3>
        <span className="bodega-cliente-total">{formatearPiezas(c.piezas)}</span>
      </div>
      <div className="bodega-pedido-cab">
        <EstadoTexto tono={c.estado === 'llego_merida' ? 'ok' : c.atrasada ? 'malo' : 'neutro'}>{ETIQUETA_ESTADO_COMPRA[c.estado]}</EstadoTexto>
        {c.llegadaEstimada && <span className="rtm-celda-sub">{c.atrasada ? `Esperada el ${etiquetaFecha(c.llegadaEstimada)} (atrasada)` : `Esperada el ${etiquetaFecha(c.llegadaEstimada)}`}</span>}
      </div>
      {c.guias.length > 0 && <p className="rtm-celda-sub">Guía: {c.guias.map((g) => `${g.paqueteria} ${g.numero}`).join(' · ')}</p>}
      <Lineas lineas={c.lineas} />
    </li>
  );
}

export function TablaPorGuardar({ lineas }: { lineas: LineaBodega[] }) {
  return (
    <DataTable plana densidad="densa" etiqueta="Por guardar" clave={(s) => `${s.modelo}|${s.sabor}`} filas={lineas}
      vacio={{ titulo: 'Nada por guardar', texto: 'No hay compras por recibir.' }}
      columnas={[
        { id: 'm', titulo: 'Modelo', ancho: 'l', prioridadMovil: 'titulo', celda: (s) => <>{s.modelo}<span className="rtm-celda-sub">{s.sabor}</span></> },
        { id: 'p', titulo: 'Esperadas', numerica: true, prioridadMovil: 'principal', celda: (s) => formatearPiezas(s.piezas) },
      ]} />
  );
}
