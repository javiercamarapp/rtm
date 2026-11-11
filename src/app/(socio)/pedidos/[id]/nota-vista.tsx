import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import type { NotaPedido } from '@/dominio/operacion/tipos';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { MARCA } from '@/config/marca';

/** La nota tipo invoice del cliente: formal, minimalista y sin colores. Solo nombre del cliente; sabores agrupados por modelo con subtotales. */
export function NotaCliente({ nota, pedidoId }: { nota: NotaPedido; pedidoId: number }) {
  const c = nota.cliente;
  return (
    <article className="rtm-nota-doc" aria-label={`Nota ${nota.folio_documento}`} data-testid="nota-cliente">
      <header>
        <p className="rtm-nota-marca">{MARCA.nombre}</p>
        <div className="rtm-nota-meta">
          <strong>{nota.tipo === 'correccion' ? 'NOTA CORREGIDA' : 'NOTA'}</strong>
          <span className="rtm-mono">{nota.folio_documento}</span><br />
          <span>{c.fecha ? etiquetaFecha(c.fecha) : ''}</span>
        </div>
      </header>
      <div>
        <p className="rtm-nota">CLIENTE</p>
        <strong>{c.cliente}</strong>
        <p className="rtm-nota">{c.entrega}</p>
      </div>
      <div role="table" aria-label="Detalle de la nota">
        <div role="row" className="rtm-nota-fila rtm-nota-cabecera"><span role="columnheader">PRODUCTO</span><span role="columnheader">SABOR</span><span role="columnheader">CANTIDAD</span><span role="columnheader">PRECIO</span><span role="columnheader">TOTAL</span></div>
        {c.grupos.map((g) => (
          <div key={g.modelo} role="rowgroup">
            <div role="row" className="rtm-nota-fila rtm-nota-modelo"><span role="cell">{g.modelo}</span><span role="cell" /><span role="cell">{g.piezas}</span><span role="cell" /><span role="cell">{formatearMoneda(g.subtotal_cent)}</span></div>
            {g.sabores.map((s) => (
              <div role="row" className="rtm-nota-fila" key={`${g.modelo}-${s.sabor}-${s.precio_cent}`}><span role="cell" /><span role="cell">{s.sabor}</span><span role="cell">{s.piezas}</span><span role="cell">{formatearMoneda(s.precio_cent)}</span><span role="cell">{formatearMoneda(s.total_cent)}</span></div>
            ))}
          </div>
        ))}
      </div>
      <div className="rtm-nota-totales">
        <div><span>Cantidad total</span><span>{c.piezas_total} piezas</span></div>
        <div><span>Subtotal</span><span>{formatearMoneda(c.subtotal_cent)}</span></div>
        {c.envio_cent > 0n && <div><span>Envío</span><span>{formatearMoneda(c.envio_cent)}</span></div>}
        {c.recargo_cent > 0n && <div><span>Recargo</span><span>{formatearMoneda(c.recargo_cent)}</span></div>}
        {c.descuento_cent > 0n && <div><span>Descuento</span><span>{`−${formatearMoneda(c.descuento_cent)}`}</span></div>}
        <div className="rtm-nota-total"><span>Total a saldar</span><CifraComprobada texto={formatearMoneda(c.total_cent)} cifra={`pedido:total:${pedidoId}`} comprobacion="cuadra" /></div>
      </div>
    </article>
  );
}
