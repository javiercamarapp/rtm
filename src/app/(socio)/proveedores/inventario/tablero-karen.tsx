'use client';

import { useMemo, useState } from 'react';
import {
  avisosDeTablero, conteoPorMarca, consultaDeFiltros, ETIQUETA_EVENTO, filtrarYOrdenar, FILTROS_INICIALES, filtrosActivos, hace, leerFiltros, tonoDeEvento,
  type DatosTablero, type EventoGlobal, type FiltrosKaren, type OrdenTablero,
} from '@/dominio/proveedores/tablero';
import { fotoDeModelo } from '@/config/fotos_karen';
import { etiquetaFechaHora, marcaMayus, nombreVape } from '@/dominio/formato';
import { PanelVape } from './panel-vape';
import { TarjetaVape } from './tarjeta-vape';
import '@/ui/estilos/barrido-b.css';

export interface PropsTablero extends DatosTablero {
  eventos: EventoGlobal[];
  porConfirmar: number;
  promociones: { clave: string; etiqueta: string; fin: string | null; modelos: string[] }[];
  ahoraIso: string;
  /** Consulta de la URL (sin "?") con el estado de los filtros. */
  consultaInicial: string;
  sinLectura: boolean;
  /** Mapa modelo -> foto; por omision el de la configuracion. */
  fotos?: Readonly<Record<string, string>>;
}

const ORDENES: { v: OrdenTablero; t: string }[] = [
  { v: 'nombre', t: 'Marca y nombre' }, { v: 'sabores', t: 'Más sabores disponibles' }, { v: 'vendidos', t: 'Más vendidos' }, { v: 'cobertura', t: 'Menor cobertura' }, { v: 'recientes', t: 'Más recientes' },
];

export function TableroKaren(p: PropsTablero) {
  const ahora = useMemo(() => new Date(p.ahoraIso), [p.ahoraIso]);
  const [f, setF] = useState<FiltrosKaren>(() => leerFiltros(new URLSearchParams(p.consultaInicial)));
  const [todosAvisos, setTodosAvisos] = useState(false);

  const aplicar = (parcial: Partial<FiltrosKaren>) => {
    const nuevo = { ...f, ...parcial };
    setF(nuevo);
    // Estado en la URL sin pedir la pagina otra vez al servidor.
    try {
      const q = consultaDeFiltros(nuevo);
      window.history.replaceState(window.history.state, '', q ? `?${q}` : window.location.pathname);
    } catch { /* sin historial (pruebas o navegador restringido): el filtro funciona igual */ }
  };

  const lista = useMemo(() => filtrarYOrdenar(p.modelos, f), [p.modelos, f]);
  const marcas = useMemo(() => conteoPorMarca(p.modelos, f), [p.modelos, f]);
  const avisos = useMemo(() => avisosDeTablero({ recomendaciones: p.recomendaciones, eventos: p.eventos, porConfirmar: p.porConfirmar }, ahora), [p.recomendaciones, p.eventos, p.porConfirmar, ahora]);
  const abierto = p.modelos.find((m) => m.producto_id === f.modelo) ?? null;
  const reco = abierto ? p.recomendaciones.find((r) => r.producto_id === abierto.producto_id) ?? null : null;
  const activos = filtrosActivos(f);
  const extras = [f.existencia !== 'todas', f.vendemos, f.nuevos, f.caladas].filter(Boolean).length;
  const foto = (handle: string) => fotoDeModelo(handle, p.fotos);
  const visibles = todosAvisos ? avisos : avisos.slice(0, 3);

  return (
    <>
      <section className="rtm-kr-avisos" aria-label="Avisos y recomendaciones" data-testid="avisos">
        <div className="rtm-kr-sec-cab"><h2>Avisos y recomendaciones</h2>{avisos.length > 3 && <button type="button" className="rtm-kr-enlace" onClick={() => setTodosAvisos(!todosAvisos)} aria-expanded={todosAvisos}>{todosAvisos ? 'Ver menos' : `Ver los ${avisos.length}`}</button>}</div>
        {avisos.length === 0 ? (
          <p className="rtm-kr-vacio-linea">{p.sinLectura ? 'Cuando se active la lectura, aquí aparecerán los modelos nuevos, los sabores que lleguen o se agoten y qué conviene pedir.' : 'Sin novedades por ahora. Te avisaremos de lo nuevo, lo agotado y lo que conviene pedir.'}</p>
        ) : (
          <ul className="rtm-kr-aviso-lista">
            {visibles.map((a) => (
              <li key={a.clave} data-tono={a.tono}>
                {a.productoId ? <button type="button" onClick={() => aplicar({ modelo: a.productoId })}><strong>{a.titulo}</strong><span>{a.detalle}</span></button> : <div><strong>{a.titulo}</strong><span>{a.detalle}</span></div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rtm-kr-barra-filtros" aria-label="Buscar y filtrar">
        <label className="rtm-kr-buscar">
          <span className="rtm-solo-lectores">Buscar modelo, marca o sabor</span>
          <input type="search" className="rtm-campo" placeholder="Buscar modelo, marca o sabor" value={f.q} onChange={(e) => aplicar({ q: e.target.value })} data-testid="buscar" autoComplete="off" />
        </label>
        <details className="rtm-kr-marcas" data-testid="filtro-marca">
          <summary className="rtm-boton">Marca{f.marcas.length ? ` (${f.marcas.length})` : ''}</summary>
          <fieldset>
            <legend className="rtm-solo-lectores">Marcas</legend>
            {marcas.map((m) => (
              <label key={m.marca}>
                <input type="checkbox" checked={f.marcas.includes(m.marca)} onChange={(e) => aplicar({ marcas: e.target.checked ? [...f.marcas, m.marca] : f.marcas.filter((x) => x !== m.marca) })} />
                <span>{marcaMayus(m.marca)}</span><small>{m.n}</small>
              </label>
            ))}
            {f.marcas.length > 0 && <button type="button" className="rtm-kr-enlace" onClick={() => aplicar({ marcas: [] })}>Quitar marcas</button>}
          </fieldset>
        </details>
        <div className="rtm-seg-mini" role="group" aria-label="Disponibilidad en Karen">
          {([['todos', 'Todos'], ['con', 'Con sabores'], ['agotados', 'Agotados']] as const).map(([v, t]) => <button key={v} type="button" aria-pressed={f.disp === v} onClick={() => aplicar({ disp: v })}>{t}</button>)}
        </div>
        <details className="rtm-kr-marcas" data-testid="mas-filtros">
          <summary className="rtm-boton" title="Existencia propia, lo que vendemos, nuevos y caladas">Más filtros{extras ? ` (${extras})` : ''}</summary>
          <fieldset>
            <legend className="rtm-solo-lectores">Más filtros</legend>
            <label className="rtm-bb-campo-fila"><span>Existencia nuestra</span>
              <select className="rtm-campo" value={f.existencia} onChange={(e) => aplicar({ existencia: e.target.value as FiltrosKaren['existencia'] })} data-testid="filtro-existencia" aria-label="Existencia propia">
                <option value="todas">Con o sin existencia nuestra</option><option value="con">Con existencia nuestra</option><option value="sin">Sin existencia nuestra</option>
              </select>
            </label>
            <label><input type="checkbox" checked={f.vendemos} onChange={() => aplicar({ vendemos: !f.vendemos })} data-testid="solo-vendemos" /><span>Solo lo que vendemos</span></label>
            <label><input type="checkbox" checked={f.nuevos} onChange={() => aplicar({ nuevos: !f.nuevos })} data-testid="solo-nuevos" /><span>Nuevos esta semana</span></label>
            <label><input type="checkbox" checked={f.caladas} onChange={() => aplicar({ caladas: !f.caladas })} data-testid="ver-caladas" /><span>Mostrar caladas</span></label>
          </fieldset>
        </details>
        <label className="rtm-kr-select"><span className="rtm-solo-lectores">Ordenar por</span>
          <select className="rtm-campo" value={f.orden} onChange={(e) => aplicar({ orden: e.target.value as OrdenTablero })} data-testid="orden">
            {ORDENES.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
          </select>
        </label>
        <div className="rtm-kr-resumen" role="status" aria-live="polite" data-testid="resumen">
          {lista.length} de {p.modelos.length} modelos
          {activos > 0 && <button type="button" className="rtm-kr-enlace" onClick={() => aplicar({ ...FILTROS_INICIALES, caladas: f.caladas, orden: f.orden })} data-testid="limpiar">Limpiar filtros ({activos})</button>}
        </div>
      </section>

      {p.modelos.length === 0 ? (
        <div className="rtm-kr-vacio" data-testid="vacio-sin-lecturas">
          <span aria-hidden="true" className="rtm-kr-vacio-marca">K</span>
          <h2>Todavía no hay lecturas de Karen</h2>
          <p>Cuando se active la lectura horaria, aquí verás cada modelo con su foto y sus sabores en tiempo real, con avisos de lo nuevo y lo agotado. Mientras tanto la lista para clientes no está disponible.</p>
        </div>
      ) : lista.length === 0 ? (
        <div className="rtm-kr-vacio" data-testid="vacio-sin-resultados">
          <h2>Ningún modelo coincide</h2>
          <p>Prueba con otra palabra o quita algún filtro.</p>
          <button type="button" className="rtm-boton" onClick={() => aplicar({ ...FILTROS_INICIALES, caladas: f.caladas, orden: f.orden })}>Limpiar filtros</button>
        </div>
      ) : (
        <ul className="rtm-kr-rejilla" aria-label="Modelos de Karen" data-testid="rejilla">
          {lista.map((m, i) => <TarjetaVape key={m.producto_id} modelo={m} foto={foto(m.handle)} caladas={f.caladas} ahora={ahora} abierta={f.modelo === m.producto_id} indice={i} onAbrir={(id) => aplicar({ modelo: id })} />)}
        </ul>
      )}

      <div className="rtm-kr-dos">
        <section className="rtm-kr-bloque" aria-label="Cambios recientes">
          <div className="rtm-kr-sec-cab"><h2>Cambios recientes</h2><span className="rtm-nota">Solo cambios, no una foto por hora</span></div>
          {p.eventos.length === 0 ? <p className="rtm-kr-vacio-linea">Sin cambios todavía.</p> : (
            <ol className="rtm-kr-linea" data-testid="linea-tiempo">
              {p.eventos.slice(0, 12).map((e) => (
                <li key={e.clave} data-tono={tonoDeEvento(e.tipo)}>
                  <span>{ETIQUETA_EVENTO[e.tipo] ?? e.tipo}{e.modelo ? `: ${nombreVape(e.modelo)}` : ''}{e.despues && e.tipo.startsWith('sabor') ? ` (${e.despues})` : ''}</span>
                  <time dateTime={e.en}>{hace(e.en, ahora)}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="rtm-kr-bloque" aria-label="Promociones">
          <div className="rtm-kr-sec-cab"><h2>Promociones</h2><span className="rtm-nota">Informativo: puede no aplicar a mayoreo</span></div>
          {p.promociones.length === 0 ? <p className="rtm-kr-vacio-linea">Sin promociones vigentes.</p> : (
            <ul className="rtm-kr-promos">
              {p.promociones.map((x) => <li key={x.clave}><strong>{x.etiqueta}</strong><span>{x.modelos.slice(0, 3).join(', ') || 'Toda la campaña'}{x.fin ? ` · hasta ${etiquetaFechaHora(x.fin)}` : ''}</span></li>)}
            </ul>
          )}
        </section>
      </div>

      <PanelVape modelo={abierto} foto={abierto ? foto(abierto.handle) : null} caladas={f.caladas} ahora={ahora} recomendacion={reco} onCerrar={() => aplicar({ modelo: null })} />
    </>
  );
}
