'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as TecladoReact, type ReactNode } from 'react';
import type { Explicacion } from '@/dominio/catalogo/tipos';
import { armarVista, type Modo } from '@/dominio/explicar/vista';
import { leerModoMovimiento } from '@/ui/movimiento/cliente';
import { CuerpoCifra, EncabezadoCifra, IconoCerrar } from './explicar-panel';

type Explicar = (cifra: string) => Promise<Explicacion>;
interface Ctx { abrir: (cifra: string, disparador: HTMLElement | null) => void }
const Contexto = createContext<Ctx | null>(null);

export function useExplicar(): Ctx {
  const c = useContext(Contexto);
  if (!c) throw new Error('CifraComprobada necesita un ExplicarProvider');
  return c;
}

type Estado = { fase: 'cerrado' } | { fase: 'cargando'; cifra: string } | { fase: 'error'; cifra: string } | { fase: 'listo'; datos: Explicacion };

const SALIDA_MS = 200;
const FOCALIZABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Un solo panel para toda la pagina: hoja derecha curva (hoja inferior en movil) con la cifra, su definicion, de donde sale, comprobacion por dos vias, detalle y glosario.
 *  `modo="omar"` apaga costos, cuentas y enlaces a paginas de socios: Omar nunca los ve. */
export function ExplicarProvider({ explicar, children, modo = 'socio' }: { explicar: Explicar; children: ReactNode; modo?: Modo }) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cerrado' });
  const [saliendo, setSaliendo] = useState(false);
  const disparador = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const cerrar = useRef<HTMLButtonElement>(null);
  const cifraAbierta = useRef('');
  const peticion = useRef(0); // la respuesta de una cifra cerrada o reemplazada no debe reabrir el panel
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const abrir = useCallback((cifra: string, d: HTMLElement | null) => {
    if (temporizador.current) clearTimeout(temporizador.current);
    setSaliendo(false);
    disparador.current = d ?? disparador.current;
    cifraAbierta.current = cifra;
    const mia = ++peticion.current;
    setEstado({ fase: 'cargando', cifra });
    explicar(cifra).then((datos) => { if (peticion.current === mia) setEstado({ fase: 'listo', datos }); }, () => { if (peticion.current === mia) setEstado({ fase: 'error', cifra }); });
  }, [explicar]);

  const cerrarPanel = useCallback(() => {
    peticion.current += 1;
    const terminar = () => {
      setSaliendo(false);
      setEstado({ fase: 'cerrado' });
      // Si la pantalla se repinto mientras estaba abierto, el boton de origen puede ser otro nodo: se vuelve a buscar por el identificador de la cifra.
      const destino = disparador.current?.isConnected ? disparador.current : document.querySelector<HTMLElement>(`[data-cifra="${CSS.escape(cifraAbierta.current)}"]`);
      destino?.focus();
    };
    if (leerModoMovimiento() !== 'full') { terminar(); return; }
    setSaliendo(true);
    temporizador.current = setTimeout(terminar, SALIDA_MS);
  }, []);

  const abierto = estado.fase !== 'cerrado';
  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current); }, []);

  useEffect(() => {
    if (!abierto) return;
    cerrar.current?.focus();
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); cerrarPanel(); } };
    window.addEventListener('keydown', alTeclear);
    return () => { window.removeEventListener('keydown', alTeclear); document.body.style.overflow = previo; };
  }, [abierto, cerrarPanel]);

  // Foco atrapado: Tab y Mayus+Tab ciclan dentro del panel (se ignoran las secciones colapsadas).
  const atrapar = (e: TecladoReact<HTMLElement>) => {
    if (e.key !== 'Tab' || !panel.current) return;
    const lista = [...panel.current.querySelectorAll<HTMLElement>(FOCALIZABLES)].filter((el) => !el.closest('[hidden]'));
    if (lista.length === 0) { e.preventDefault(); return; }
    const primero = lista[0]!;
    const ultimo = lista[lista.length - 1]!;
    const activo = document.activeElement;
    if (e.shiftKey && (activo === primero || !panel.current.contains(activo))) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && (activo === ultimo || !panel.current.contains(activo))) { e.preventDefault(); primero.focus(); }
  };

  const vista = useMemo(() => {
    if (estado.fase !== 'listo') return null;
    try { return armarVista(estado.datos, modo); } catch { return null; }
  }, [estado, modo]);

  return (
    <Contexto.Provider value={{ abrir }}>
      {children}
      {abierto && (
        <>
          <button type="button" className="rtm-velo rtm-velo-cajon xp-velo" data-saliendo={saliendo || undefined} aria-label="Cerrar explicación" onClick={cerrarPanel} tabIndex={-1} />
          <div ref={panel} className="xp-panel" data-saliendo={saliendo || undefined} role="dialog" aria-modal="true" aria-labelledby={vista ? 'xp-etq cajon-titulo' : 'xp-etq'} data-testid="explicar-cajon" onKeyDown={atrapar}>
            <span className="xp-asa" aria-hidden="true" />
            <header className="xp-cabecera">
              <p className="rtm-eyebrow xp-etq" id="xp-etq">Explicar este número</p>
              <button ref={cerrar} type="button" className="xp-cerrar" aria-label="Cerrar" onClick={cerrarPanel}><IconoCerrar /></button>
            </header>
            {estado.fase === 'cargando' && <div className="xp-estado" role="status" aria-live="polite"><span className="xp-esq xp-esq-cifra" aria-hidden="true" /><span className="xp-esq xp-esq-linea" aria-hidden="true" /><span className="xp-esq xp-esq-linea xp-esq-corta" aria-hidden="true" />Buscando los movimientos que forman esta cifra…</div>}
            {(estado.fase === 'error' || (estado.fase === 'listo' && !vista)) && (
              <div className="xp-estado" role="alert">No se pudo explicar esta cifra.
                <button type="button" className="xp-boton" onClick={() => abrir(cifraAbierta.current, null)}>Reintentar</button>
              </div>
            )}
            {vista && (<>
              <div className="xp-encabezado"><EncabezadoCifra vista={vista} idTitulo="cajon-titulo" /></div>
              <CuerpoCifra key={vista.cifra} vista={vista} modo={modo} />
            </>)}
          </div>
        </>
      )}
    </Contexto.Provider>
  );
}
