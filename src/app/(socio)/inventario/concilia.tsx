import '@/ui/estilos/socios-valuacion.css';
import { etiquetaFechaHora, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { ConciliaInventario } from '@/dominio/inventario/tipos';
import { Estado } from '../_a3/util';
import { Tarjeta } from '@/ui/componentes/pagina';

const ESTADO_CONTEO = { conciliado: 'Conciliado', diferencias_abiertas: 'Con diferencias abiertas', sin_conteo: 'Sin conteo físico todavía' } as const;

/** Comprobacion visible: el kardex valorizado es la cuenta 1310 del libro, las piezas del kardex son la existencia mostrada, y el ultimo conteo fisico con sus diferencias por sabor.
 *  Todas las cifras las calcula la base (api.inventario_concilia); aqui solo se muestran. */
export function PanelConcilia({ c }: { c: ConciliaInventario }) {
  const u = c.ultimo_conteo;
  return (
    <Tarjeta
      titulo="Concilia con el libro"
      descripcion="El kárdex valorizado es la cuenta 1310 y las piezas del kárdex son la existencia que ves aquí"
      acciones={<span data-testid="concilia-estado"><Estado tono={c.concilia ? 'ok' : 'malo'}>{c.concilia ? 'Concilia' : 'No concilia'}</Estado></span>}
    >
      <ul className="sv-rubros" data-testid="concilia-inventario">
        <li data-testid="concilia-valor"><span>Kárdex valorizado</span><span>{formatearMoneda(c.valor.kardex_cent)} · cuenta 1310 {formatearMoneda(c.valor.libro_1310_cent)}</span><Estado tono={c.valor.ok ? 'ok' : 'malo'}>{c.valor.ok ? 'Cuadra' : 'No cuadra'}</Estado></li>
        <li data-testid="concilia-piezas"><span>Piezas del kárdex</span><span>{formatearPiezas(c.piezas.kardex)} · existencia mostrada {formatearPiezas(c.piezas.existencia)}</span><Estado tono={c.piezas.ok ? 'ok' : 'malo'}>{c.piezas.ok ? 'Cuadra' : 'No cuadra'}</Estado></li>
        <li data-testid="concilia-conteo"><span>Último conteo físico</span>
          <span>{u ? `${etiquetaFechaHora(u.contado_at)} · ${u.sabores_con_diferencia === 0 ? 'sin diferencias' : `${u.sabores_con_diferencia} ${u.sabores_con_diferencia === 1 ? 'sabor con diferencia' : 'sabores con diferencia'}, neto ${u.neto_piezas > 0 ? '+' : ''}${formatearPiezas(u.neto_piezas)}, ajuste de valor ${formatearMoneda(u.ajuste_valor_cent)}`}` : 'Todavía no hay un conteo cerrado'}</span>
          <Estado tono={c.estado_conteo === 'conciliado' ? 'ok' : c.estado_conteo === 'sin_conteo' ? 'neutro' : 'atencion'}>{ESTADO_CONTEO[c.estado_conteo]}</Estado></li>
      </ul>
      {u && u.diferencias.length > 0 && (
        <ul className="sv-rubros" data-testid="concilia-diferencias" aria-label="Diferencias por sabor del último conteo">
          {u.diferencias.map((d) => (
            <li key={`${d.modelo}-${d.sabor}`}><span>{d.modelo} · {d.sabor}</span><span>Sistema {formatearPiezas(d.esperado)} · contado {formatearPiezas(d.contado)} · {d.diferencia > 0 ? '+' : ''}{formatearPiezas(d.diferencia)}</span><Estado tono={d.explicada ? 'ok' : 'atencion'}>{d.explicada ? 'Explicada' : 'Sin explicar'}</Estado></li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}
