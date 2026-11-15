'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import { marcasAParam, marcasDeParam, PARAM_MARCA } from '@/dominio/catalogo/filtro';

export interface MarcaOpcion { nombre: string; cuenta: number }
export interface Segmento { valor: string; etiqueta: string }

interface Props {
  etiquetaAria: string;
  placeholder?: string;
  /** Etiqueta accesible del buscador (por omision, el texto del placeholder). */
  etiquetaBusqueda?: string;
  marcas: MarcaOpcion[];
  /** Marcas mas vendidas como atajos (maximo 5). El resto vive en el desplegable. */
  atajos?: string[];
  /** Control segmentado de estado: parametro de URL y opciones; la primera es "Todos" (valor vacio). */
  segmentos?: { parametro: string; opciones: Segmento[]; etiquetaAria: string };
  /** Parametros que se limpian al cambiar un filtro (por ejemplo la pagina). */
  limpiar?: string[];
}

/** Una sola barra: buscador en vivo, estado segmentado y marcas agrupadas en un desplegable multiseleccion. Todo el estado vive en la URL (compartible). */
export function FiltroCatalogo({ etiquetaAria, placeholder = 'Buscar marca, modelo o alias', etiquetaBusqueda, marcas, atajos = [], segmentos, limpiar = [] }: Props) {
  const router = useRouter();
  const ruta = usePathname();
  const sp = useSearchParams();
  const [, empezar] = useTransition();
  const idPanel = useId();
  const idBusca = useId();
  const seleccion = useMemo(() => marcasDeParam(sp.get(PARAM_MARCA)).filter((m) => marcas.some((x) => x.nombre === m)), [sp, marcas]);
  const urlQ = sp.get('q') ?? '';
  const [q, setQ] = useState(urlQ);
  const [abierto, setAbierto] = useState(false);
  const [busMarca, setBusMarca] = useState('');
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setQ(urlQ); }, [urlQ]);
  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current); }, []);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  const aplicar = (cambios: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(cambios)) { if (v) p.set(k, v); else p.delete(k); }
    for (const k of limpiar) p.delete(k);
    const s = p.toString();
    empezar(() => router.replace(s ? `${ruta}?${s}` : ruta, { scroll: false }));
  };
  const escribir = (v: string) => {
    setQ(v);
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => aplicar({ q: v.trim() }), 250);
  };
  const alternarMarca = (m: string) => aplicar({ [PARAM_MARCA]: marcasAParam(seleccion.includes(m) ? seleccion.filter((x) => x !== m) : [...seleccion, m]) });
  const segActual = segmentos ? (sp.get(segmentos.parametro) ?? '') : '';
  const visibles = marcas.filter((x) => x.nombre.toLowerCase().includes(busMarca.trim().toLowerCase()));
  const hayFiltros = seleccion.length > 0 || q !== '' || segActual !== '';
  const nombresAtajo = atajos.filter((a) => marcas.some((x) => x.nombre === a)).slice(0, 5);

  return (
    <div className="rtm-fc" role="group" aria-label={etiquetaAria} ref={raiz}
      onKeyDown={(e) => { if (e.key === 'Escape' && abierto) { setAbierto(false); boton.current?.focus(); } }}>
      <div className="rtm-fc-barra">
        <div className="rtm-fc-busca" role="search">
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m13.5 13.5 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          <label className="rtm-solo-lectores" htmlFor={idBusca}>{etiquetaBusqueda ?? placeholder}</label>
          <input id={idBusca} type="search" value={q} placeholder={placeholder} autoComplete="off" onChange={(e) => escribir(e.target.value)} data-testid="fc-buscar" />
        </div>
        {segmentos && (
          <div className="rtm-fc-seg" role="group" aria-label={segmentos.etiquetaAria}>
            {segmentos.opciones.map((o) => (
              <button key={o.valor || 'todos'} type="button" aria-pressed={segActual === o.valor} onClick={() => aplicar({ [segmentos.parametro]: o.valor })}>{o.etiqueta}</button>
            ))}
          </div>
        )}
        {nombresAtajo.length > 0 && (
          <div className="rtm-fc-atajos" role="group" aria-label="Marcas destacadas">
            {nombresAtajo.map((m) => <button key={m} type="button" className="rtm-fc-atajo" aria-pressed={seleccion.includes(m)} onClick={() => alternarMarca(m)}>{m}</button>)}
          </div>
        )}
        <div className="rtm-fc-marcas">
          <button ref={boton} type="button" className="rtm-fc-disparo" aria-expanded={abierto} aria-controls={idPanel} aria-haspopup="true" onClick={() => setAbierto((a) => !a)} data-testid="fc-marcas">
            Marcas{seleccion.length > 0 && <small>{seleccion.length}</small>}
            <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="m2.5 4.5 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          {abierto && (
            <div id={idPanel} className="rtm-fc-panel" role="group" aria-label="Marcas">
              <input type="search" className="rtm-fc-panel-busca" value={busMarca} onChange={(e) => setBusMarca(e.target.value)} placeholder="Buscar marca" aria-label="Buscar marca" autoComplete="off" autoFocus />
              <ul>
                {visibles.map((x) => (
                  <li key={x.nombre}>
                    <label><input type="checkbox" checked={seleccion.includes(x.nombre)} onChange={() => alternarMarca(x.nombre)} /><span className="rtm-may-marca">{x.nombre}</span><small>{x.cuenta}</small></label>
                  </li>
                ))}
                {visibles.length === 0 && <li className="rtm-fc-vacio">Ninguna marca coincide</li>}
              </ul>
              <div className="rtm-fc-pie">
                <button type="button" onClick={() => aplicar({ [PARAM_MARCA]: '' })} disabled={seleccion.length === 0}>Limpiar marcas</button>
                <button type="button" onClick={() => { setAbierto(false); boton.current?.focus(); }}>Listo</button>
              </div>
            </div>
          )}
        </div>
        {hayFiltros && <button type="button" className="rtm-fc-limpiar" onClick={() => { setQ(''); aplicar({ q: '', [PARAM_MARCA]: '', ...(segmentos ? { [segmentos.parametro]: '' } : {}) }); }}>Quitar filtros</button>}
      </div>
      {seleccion.length > 0 && (
        <ul className="rtm-fc-chips" aria-label="Marcas seleccionadas">
          {seleccion.map((m) => <li key={m}><button type="button" onClick={() => alternarMarca(m)} aria-label={`Quitar la marca ${m}`}><span className="rtm-may-marca">{m}</span><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="m3 3 6 6m0-6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button></li>)}
        </ul>
      )}
    </div>
  );
}
