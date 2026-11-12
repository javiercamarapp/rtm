'use client';

// Capa de navegador de la DataTable v2: busqueda, paginacion, grupos colapsables y exportacion CSV. Las filas llegan ya pintadas por el servidor
// (sin JS se ven todas); aqui solo se alterna el atributo `hidden`. Las acciones de las celdas no se tocan.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export interface OpcionesInteractiva {
  /** Marcador del campo de busqueda; si falta no hay busqueda. */
  busqueda?: string;
  /** Filas por pagina (se ofrece 25, 50 y 100); 0 o ausente = sin paginar. */
  porPagina?: number;
  /** Nombre de archivo del CSV (sin extension); si falta no hay boton Exportar. */
  exportar?: string;
}

const normalizar = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** Neutraliza formulas de hoja de calculo (=, +, @, tab, retorno). El signo menos tipografico (U+2212) no es operador. */
const neutralizar = (t: string) => (/^[=+@\t\r]/.test(t) ? `'${t}` : t);
const celdaCsv = (t: string) => `"${neutralizar(t.replace(/\s+/g, ' ').trim()).replaceAll('"', '""')}"`;

export function TablaInteractiva({ children, opciones, etiqueta, cerradosPorDefecto = false }: { children: ReactNode; opciones: OpcionesInteractiva; etiqueta: string; cerradosPorDefecto?: boolean }) {
  const raiz = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(0);
  const [tam, setTam] = useState(opciones.porPagina ?? 0);
  const [alternados, setAlternados] = useState<Record<string, boolean>>({});
  const [resumen, setResumen] = useState<{ visibles: number; total: number } | null>(null);

  const aplicar = useCallback(() => {
    const el = raiz.current;
    if (!el) return;
    const filas = [...el.querySelectorAll<HTMLElement>('[data-fila]')];
    const aguja = normalizar(q.trim());
    // Unidades: un grupo (cabecera + hijos) o una fila suelta.
    const unidades: { filas: HTMLElement[]; cab?: HTMLElement; coincide: boolean }[] = [];
    for (const f of filas) {
      if (f.dataset.enGrupo !== undefined) continue;
      if (f.dataset.grupoCab !== undefined) {
        const hijos = filas.filter((h) => h.dataset.enGrupo === f.dataset.grupoCab);
        const coincide = !aguja || [f, ...hijos].some((h) => normalizar(h.textContent ?? '').includes(aguja));
        unidades.push({ filas: hijos, cab: f, coincide });
      } else {
        unidades.push({ filas: [f], coincide: !aguja || normalizar(f.textContent ?? '').includes(aguja) });
      }
    }
    const filtradas = unidades.filter((u) => u.coincide);
    const porPag = tam > 0 ? tam : filtradas.length || 1;
    const paginas = Math.max(1, Math.ceil(filtradas.length / porPag));
    const actual = Math.min(pagina, paginas - 1);
    const ventana = new Set(filtradas.slice(actual * porPag, actual * porPag + porPag));
    let visibles = 0;
    for (const u of unidades) {
      const enVentana = ventana.has(u);
      if (u.cab) {
        u.cab.hidden = !enVentana;
        const cab = u.cab.dataset.grupoCab ?? '';
        const abierto = aguja ? true : (alternados[cab] ?? !cerradosPorDefecto);
        u.cab.dataset.abierto = String(abierto);
        u.cab.querySelector('button')?.setAttribute('aria-expanded', String(abierto));
        for (const h of u.filas) h.hidden = !enVentana || !abierto;
        if (enVentana) visibles += 1;
      } else {
        u.filas[0]!.hidden = !enVentana;
        if (enVentana) visibles += 1;
      }
    }
    setResumen({ visibles, total: filtradas.length });
    if (actual !== pagina) setPagina(actual);
  }, [q, pagina, tam, alternados, cerradosPorDefecto]);

  useEffect(() => {
    aplicar();
  }, [aplicar, children]);

  const alClic = (e: React.MouseEvent) => {
    const boton = (e.target as HTMLElement).closest('.rtm-dt-grupo-boton');
    if (!boton) return;
    const cab = boton.closest<HTMLElement>('[data-grupo-cab]');
    const clave = cab?.dataset.grupoCab;
    if (clave === undefined) return;
    setAlternados((a) => ({ ...a, [clave]: !(a[clave] ?? !cerradosPorDefecto) }));
  };

  const exportar = () => {
    const el = raiz.current;
    if (!el || !opciones.exportar) return;
    const lineas: string[] = [];
    const cabeza = [...el.querySelectorAll('[role=columnheader]')].map((c) => celdaCsv(c.textContent ?? ''));
    lineas.push(cabeza.join(','));
    for (const f of el.querySelectorAll<HTMLElement>('.rtm-dt-cuerpo [role=row]')) {
      lineas.push([...f.querySelectorAll('[role=cell]')].map((c) => celdaCsv((c.textContent ?? '').replace(/(Agotado|Negativa)$/, ''))).join(','));
    }
    const pie = el.querySelector('.rtm-dt-pie [role=row]');
    if (pie) lineas.push([...pie.querySelectorAll('[role=cell]')].map((c) => celdaCsv(c.textContent ?? '')).join(','));
    const blob = new Blob([String.fromCharCode(0xfeff), lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${opciones.exportar}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hayBarra = opciones.busqueda || opciones.porPagina || opciones.exportar;
  const porPag = tam > 0 ? tam : resumen?.total || 1;
  const paginas = resumen ? Math.max(1, Math.ceil(resumen.total / porPag)) : 1;
  return (
    <div className="rtm-dt-interactiva" ref={raiz} onClick={alClic}>
      {hayBarra && (
        <div className="rtm-dt-barra">
          {opciones.busqueda && (
            <input type="search" className="rtm-campo rtm-dt-busqueda" placeholder={opciones.busqueda} aria-label={`Buscar en ${etiqueta}`} value={q} onChange={(e) => { setQ(e.target.value); setPagina(0); }} />
          )}
          <span className="rtm-dt-barra-espacio" />
          {opciones.exportar && <button type="button" className="rtm-boton rtm-boton-chico" onClick={exportar}>Exportar CSV</button>}
        </div>
      )}
      {children}
      {(opciones.porPagina || opciones.busqueda) && (
        <div className="rtm-paginador" aria-live="polite">
          <span>{resumen ? `${resumen.visibles} de ${resumen.total} ${q ? 'coinciden' : 'filas'}` : ''}</span>
          {opciones.porPagina ? (
            <span className="rtm-paginador-botones">
              <label className="rtm-paginador-filas">
                Filas
                <select className="rtm-campo rtm-campo-chico" value={tam} onChange={(e) => { setTam(Number(e.target.value)); setPagina(0); }}>
                  {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <button type="button" className="rtm-boton rtm-boton-chico" disabled={pagina <= 0} onClick={() => setPagina((p) => Math.max(0, p - 1))}>Anterior</button>
              <span>{Math.min(pagina, paginas - 1) + 1} / {paginas}</span>
              <button type="button" className="rtm-boton rtm-boton-chico" disabled={pagina >= paginas - 1} onClick={() => setPagina((p) => Math.min(paginas - 1, p + 1))}>Siguiente</button>
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
