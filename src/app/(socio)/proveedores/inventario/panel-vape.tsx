'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { formatearEntero, marcaMayus, nombreVape, saborMayus } from '@/dominio/formato';
import { disponibles, estadoDisponibilidad, ETIQUETA_EVENTO, hace, nombreVisible, tonoDeEvento, type ModeloTablero, type Recomendacion } from '@/dominio/proveedores/tablero';
import { FotoVape, IndicadorDisponibilidad } from './tarjeta-vape';

type FiltroSabor = 'todos' | 'disponibles' | 'agotados';

/** Panel lateral de un modelo: sabores (disponible o agotado, cambios recientes, cuanto vendemos y cuanto tenemos) y linea de tiempo. Es un dialogo modal. */
export function PanelVape({ modelo: m, foto, caladas, ahora, recomendacion, onCerrar }: { modelo: ModeloTablero | null; foto: string | null; caladas: boolean; ahora: Date; recomendacion: Recomendacion | null; onCerrar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [filtro, setFiltro] = useState<FiltroSabor>('todos');
  const origen = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (m && !d.open) { origen.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; d.showModal(); }
    if (!m && d.open) { d.close(); if (origen.current?.isConnected) origen.current.focus(); }
  }, [m]);
  useEffect(() => setFiltro('todos'), [m?.producto_id]);

  const sabores = m ? m.sabores.filter((s) => (filtro === 'todos' ? true : filtro === 'disponibles' ? s.disponible : !s.disponible)) : [];
  const nombre = m ? nombreVisible(m, caladas) : '';
  return (
    <dialog ref={ref} className="rtm-kr-panel" aria-labelledby={`${id}-t`} onCancel={(e) => { e.preventDefault(); onCerrar(); }} onClick={(e) => { if (e.target === ref.current) onCerrar(); }} data-testid="panel-modelo">
      {m && (
        <div className="rtm-kr-panel-in">
          <header className="rtm-kr-panel-cab">
            <FotoVape src={foto} marca={m.marca} nombre={nombre} tamano="grande" />
            <div>
              <p className="rtm-eyebrow">{marcaMayus(m.marca)}</p>
              <h2 id={`${id}-t`} className="rtm-kr-panel-titulo">{nombreVape(nombre)}</h2>
              <IndicadorDisponibilidad estado={estadoDisponibilidad(m)} />
              <p className="rtm-nota">{disponibles(m)} de {m.sabores.length} sabores disponibles{m.puffs ? ` · ${formatearEntero(m.puffs)} caladas` : ''}</p>
            </div>
            <button type="button" className="rtm-boton" onClick={onCerrar} data-testid="cerrar-panel" aria-label="Cerrar detalle">Cerrar</button>
          </header>

          <dl className="rtm-kr-cifras">
            <div><dt>Vendes (60 días)</dt><dd>{m.canonico_id === null ? 'Sin ligar' : `${m.ventas_60d} pz`}</dd></div>
            <div><dt>Tu existencia</dt><dd>{m.canonico_id === null ? 'Sin ligar' : `${m.existencia_propia} pz`}</dd></div>
            <div><dt>Cobertura</dt><dd>{m.cobertura_dias === null ? 'Sin ventas' : `${m.cobertura_dias} ${m.cobertura_dias === 1 ? 'día' : 'días'}`}</dd></div>
          </dl>

          {recomendacion && (
            <div className="rtm-kr-reco" role="note">
              <strong>Recomendación</strong>
              <p>
                {recomendacion.motivos.includes('reponer') ? 'Conviene pedir este modelo: se vende y la existencia propia es corta. ' : ''}
                {recomendacion.motivos.includes('llego_y_vendemos') ? 'Karen acaba de recibir algo de este modelo. ' : ''}
                {recomendacion.motivos.includes('agotado_y_vendemos') ? 'Se agotó algo de este modelo con Karen. ' : ''}
                {recomendacion.sabores_sugeridos.length > 0 ? `Sabores que más vendes y Karen tiene: ${recomendacion.sabores_sugeridos.map(saborMayus).join(', ')}.` : ''}
              </p>
            </div>
          )}

          <section aria-label="Sabores">
            <div className="rtm-kr-panel-sub">
              <h3>Sabores</h3>
              <div className="rtm-seg-mini" role="group" aria-label="Filtrar sabores">
                {(['todos', 'disponibles', 'agotados'] as const).map((f) => (
                  <button key={f} type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>{f === 'todos' ? 'Todos' : f === 'disponibles' ? 'Disponibles' : 'Agotados'}</button>
                ))}
              </div>
            </div>
            {m.sabores.length === 0 ? <p className="rtm-nota">Todavía no hay sabores leídos para este modelo.</p> : sabores.length === 0 ? <p className="rtm-nota">Ningún sabor con ese filtro.</p> : (
              <ul className="rtm-kr-sabores-lista">
                {sabores.map((s) => (
                  <li key={s.variante_id} data-agotado={!s.disponible} data-testid={`sabor-${s.variante_id}`}>
                    <span className="rtm-kr-sabor-nombre">
                      <i className="rtm-kr-punto" data-ok={s.disponible} aria-hidden="true" />
                      {saborMayus(s.sabor)}
                      <span className="rtm-kr-sabor-estado">{s.disponible ? 'Disponible' : 'Agotado'}{s.inestable ? ' · inestable' : ''}</span>
                    </span>
                    <span className="rtm-kr-sabor-datos">
                      {s.cambio_en && s.cambio_tipo ? <span title={ETIQUETA_EVENTO[s.cambio_tipo] ?? s.cambio_tipo}>{ETIQUETA_EVENTO[s.cambio_tipo] ?? s.cambio_tipo} {hace(s.cambio_en, ahora)}</span> : null}
                      <span>{m.canonico_id === null || s.sabor_canonico_id === null ? 'No lo vendes' : s.ventas_60d > 0 ? `Vendes ${s.ventas_60d} pz` : 'Sin ventas'}</span>
                      <span>{m.canonico_id === null || s.sabor_canonico_id === null ? '' : `Tienes ${s.existencia_propia} pz`}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Cambios del modelo">
            <h3 className="rtm-kr-panel-sub-h">Cambios recientes</h3>
            {m.eventos.length === 0 ? <p className="rtm-nota">Sin cambios registrados todavía.</p> : (
              <ol className="rtm-kr-linea">
                {m.eventos.map((e) => (
                  <li key={e.clave} data-tono={tonoDeEvento(e.tipo)}>
                    <span>{ETIQUETA_EVENTO[e.tipo] ?? e.tipo}{e.sabor ? `: ${saborMayus(e.sabor)}` : ''}</span>
                    <time dateTime={e.en}>{hace(e.en, ahora)}</time>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <footer className="rtm-kr-panel-pie">
            {m.canonico_nombre && !m.nuevo_sin_costo ? (
              <Link className="rtm-boton rtm-boton-primario" href={`/proveedores/compras/nueva?p=Karen&modelo=${encodeURIComponent(m.canonico_nombre)}&d=${encodeURIComponent(m.sabores.filter((s) => s.disponible).map((s) => s.sabor).join(','))}`} data-testid={`orden-${m.producto_id}`}>Ordenar a Karen</Link>
            ) : (
              <p className="rtm-nota">Da el costo y confirma el modelo antes de ordenar.</p>
            )}
          </footer>
        </div>
      )}
    </dialog>
  );
}
