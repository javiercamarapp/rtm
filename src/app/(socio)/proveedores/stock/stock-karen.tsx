import Link from 'next/link';
import { fotoDeModelo } from '@/config/fotos_karen';
import { rutaFotoModelo } from '@/dominio/catalogo/fotos-modelos';
import { etiquetaFechaHora, marcaMayus, nombreVape, saborMayus } from '@/dominio/formato';
import { agruparPorMarca, kpisStock, leerFiltrosStock, lineaBase, pasaFiltroStock, resumenPorMarca, sinLineaBase, ultimoCambio } from '@/dominio/proveedores/stock';
import { disponibles, estadoDisponibilidad, ETIQUETA_EVENTO, hace, tonoDeEvento, type EventoGlobal, type ModeloTablero } from '@/dominio/proveedores/tablero';
import { FotoVape, IndicadorDisponibilidad } from '../inventario/tarjeta-vape';

export interface PropsStockKaren {
  modelos: ModeloTablero[];
  eventos: EventoGlobal[];
  ultimaLecturaOk: string | null;
  desactualizado: boolean;
  lecturaActiva: boolean;
  ahoraIso: string;
  busqueda: Record<string, string | string[] | undefined>;
}

const SIN_DATO = 'Sin dato';

/** Gráfica compacta: porcentaje de sabores disponibles por marca. Barras SVG con entrada animada (se apaga con movimiento reducido). */
function GraficaMarcas({ modelos }: { modelos: ModeloTablero[] }) {
  const filas = resumenPorMarca(modelos);
  return (
    <ul className="rtm-st-grafica" aria-label="Sabores disponibles por marca" data-testid="grafica-marcas">
      {filas.map((r) => (
        <li key={r.marca}>
          <span className="rtm-st-g-nombre">{marcaMayus(r.marca)}</span>
          <i className="rtm-st-barra" role="img" aria-label={r.pct === null ? `${r.marca}: ${SIN_DATO}` : `${r.marca}: ${r.pct} % de sus sabores disponibles`}>
            <svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect className="rtm-st-barra-r" width={r.pct ?? 0} height="6" /></svg>
          </i>
          <b>{r.pct === null ? SIN_DATO : `${r.saboresDisp}/${r.saboresTotal}`}</b>
        </li>
      ))}
    </ul>
  );
}

export function StockKaren({ modelos: modelosCrudos, eventos: eventosCrudos, ultimaLecturaOk, desactualizado, lecturaActiva, ahoraIso, busqueda }: PropsStockKaren) {
  const ahora = new Date(ahoraIso);
  // La primera lectura es la linea base: ni cuenta como nuevo ni aparece en cambios recientes.
  const modelos = sinLineaBase(modelosCrudos);
  const base = lineaBase(modelosCrudos);
  const eventos = base === null ? eventosCrudos : eventosCrudos.filter((e) => Date.parse(e.en) > Date.parse(base));
  const f = leerFiltrosStock(busqueda);
  const marcas = [...new Set(modelos.map((m) => m.marca))].sort((a, b) => a.localeCompare(b, 'es'));
  const visibles = modelos.filter((m) => pasaFiltroStock(m, f));
  const grupos = agruparPorMarca(visibles);
  const k = kpisStock(modelos);
  const hayFiltros = Boolean(f.q || f.marca || f.disp !== 'todos' || f.nuevos);

  if (modelos.length === 0) {
    return (
      <section className="rtm-kr-vacio" data-testid="vacio-karen">
        <span aria-hidden="true" className="rtm-kr-vacio-marca">K</span>
        <h2>Todavía no hay lecturas de Karen</h2>
        <p>{lecturaActiva ? 'La lectura está encendida y esperando la primera pasada.' : 'La lectura está apagada. Cuando se encienda, el vigilante horario llenará esta página con los modelos y sabores de su tienda.'}</p>
      </section>
    );
  }

  return (
    <>
      <section className="rtm-st-kpis" aria-label="Resumen del stock de Karen" data-testid="kpis-stock">
        {[
          ['Modelos', String(k.modelos), 'Modelos que aparecen hoy en la tienda de Karen.'],
          ['Con sabores', String(k.conStock), 'Modelos con al menos un sabor disponible.'],
          ['Agotados', String(k.agotados), 'Modelos cuyos sabores están todos agotados.'],
          ['Nuevos esta semana', String(k.nuevos), 'Modelos vistos por primera vez en los últimos 7 días.'],
          ['Sabores disponibles', k.pct === null ? SIN_DATO : `${k.pct} %`, `${k.saboresDisp} de ${k.saboresTotal} sabores leídos. Es un conteo de lo que muestra la tienda, no una cuenta de dinero.`],
        ].map(([t, v, ayuda]) => (
          <div key={t} className="rtm-st-kpi" title={ayuda}><span>{t}</span><b>{v}</b></div>
        ))}
        <p className="rtm-st-visto" data-tono={desactualizado ? 'atencion' : undefined}>
          Visto por última vez {ultimaLecturaOk ? hace(ultimaLecturaOk, ahora) : SIN_DATO}{desactualizado && ultimaLecturaOk ? ' (dato viejo)' : ''}
          {base && <span data-testid="linea-base-stock"> · Línea base cargada el {etiquetaFechaHora(base)}</span>}
        </p>
      </section>

      <div className="rtm-kr-dos">
        <section className="rtm-kr-bloque" aria-label="Disponibilidad por marca">
          <div className="rtm-kr-sec-cab"><h2>Disponibilidad por marca</h2><span className="rtm-nota">Sabores disponibles de cada marca</span></div>
          <GraficaMarcas modelos={modelos} />
        </section>
        <section className="rtm-kr-bloque" aria-label="Cambios recientes">
          <div className="rtm-kr-sec-cab"><h2>Cambios recientes</h2><span className="rtm-nota">Nuevo, agotado y de regreso</span></div>
          {eventos.length === 0 ? <p className="rtm-kr-vacio-linea">Sin cambios todavía.</p> : (
            <ol className="rtm-kr-linea" data-testid="linea-tiempo-stock">
              {eventos.slice(0, 8).map((e) => (
                <li key={e.clave} data-tono={tonoDeEvento(e.tipo)}>
                  <span>{ETIQUETA_EVENTO[e.tipo] ?? e.tipo}{e.modelo ? `: ${nombreVape(e.modelo)}` : ''}{e.despues && e.tipo.startsWith('sabor') ? ` (${saborMayus(e.despues)})` : ''}</span>
                  <time dateTime={e.en}>{hace(e.en, ahora)}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <form className="rtm-st-filtros" method="get" action="/proveedores/stock" role="search" aria-label="Buscar y filtrar el stock" data-testid="filtros-stock">
        <label className="rtm-st-buscar"><span className="rtm-solo-lectores">Buscar modelo, marca o sabor</span><input type="search" name="q" className="rtm-campo" placeholder="Buscar modelo, marca o sabor" defaultValue={f.q} autoComplete="off" data-testid="buscar-stock" /></label>
        <label className="rtm-st-campo"><span className="rtm-solo-lectores">Marca</span>
          <select name="marca" className="rtm-campo" defaultValue={f.marca ?? ''} data-testid="filtro-marca-stock">
            <option value="">Todas las marcas</option>
            {marcas.map((m) => <option key={m} value={m}>{marcaMayus(m)}</option>)}
          </select>
        </label>
        <label className="rtm-st-campo"><span className="rtm-solo-lectores">Disponibilidad</span>
          <select name="disp" className="rtm-campo" defaultValue={f.disp} data-testid="filtro-disp-stock">
            <option value="todos">Todos</option><option value="con">Con sabores</option><option value="agotados">Agotados</option>
          </select>
        </label>
        <label className="rtm-st-check"><input type="checkbox" name="nuevos" value="1" defaultChecked={f.nuevos} /><span>Nuevos</span></label>
        <button type="submit" className="rtm-boton rtm-boton-primario">Filtrar</button>
        {hayFiltros && <Link className="rtm-kr-enlace" href="/proveedores/stock" data-testid="limpiar-stock">Limpiar</Link>}
        <span className="rtm-st-resumen" role="status">{visibles.length} de {modelos.length} modelos</span>
      </form>

      {grupos.length === 0 ? (
        <div className="rtm-kr-vacio" data-testid="vacio-sin-resultados-stock"><h2>Ningún modelo coincide</h2><p>Prueba con otra palabra o quita algún filtro.</p></div>
      ) : grupos.map((g) => (
        <section key={g.marca} className="rtm-st-marca" aria-label={`Marca ${g.marca}`}>
          <h2 className="rtm-st-marca-titulo">{marcaMayus(g.marca)}<span className="rtm-nota">{g.modelos.length} {g.modelos.length === 1 ? 'modelo' : 'modelos'}</span></h2>
          <ul className="rtm-st-lista" role="list">
            {g.modelos.map((m) => {
              const d = disponibles(m);
              const estado = estadoDisponibilidad(m);
              const cambio = ultimoCambio(m);
              const foto = fotoDeModelo(m.handle) ?? (m.canonico_nombre ? rutaFotoModelo(m.canonico_nombre) : null);
              const disponiblesTxt = m.sabores.filter((s) => s.disponible).slice(0, 6).map((s) => saborMayus(s.sabor));
              return (
                <li key={m.producto_id} className="rtm-st-fila" data-estado={estado} data-testid={`stock-${m.producto_id}`}>
                  <FotoVape src={foto} marca={m.marca} nombre={m.titulo} />
                  <div className="rtm-st-texto">
                    <strong>{nombreVape(m.titulo)}</strong>
                    <span className="rtm-st-sabores">
                      {m.sabores.length ? <><b>{d}</b> de {m.sabores.length} sabores{disponiblesTxt.length ? `: ${disponiblesTxt.join(', ')}${d > disponiblesTxt.length ? '...' : ''}` : ''}</> : 'Sin sabores leídos'}
                    </span>
                  </div>
                  <IndicadorDisponibilidad estado={estado} />
                  {m.nuevo_semana && <b className="rtm-kr-insignia" data-tipo="nuevo">Nuevo</b>}
                  <span className="rtm-st-propio">
                    {m.canonico_id === null ? 'Sin ligar a tu catálogo' : <>Lo tienes en bodega: <b>{m.existencia_propia}</b> pz</>}
                  </span>
                  <span className="rtm-st-cambio">{cambio ? <>{ETIQUETA_EVENTO[cambio.tipo] ?? 'Cambio'} {hace(cambio.en, ahora)}</> : 'Sin cambios'}</span>
                  <Link className="rtm-kr-enlace" href={`/inventario?q=${encodeURIComponent(m.canonico_nombre ?? m.titulo)}`} data-testid={`inv-${m.producto_id}`}>Ver en Inventario</Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
