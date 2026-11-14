'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface VistaAccion { href: string; etiqueta: string; /** Texto largo para title y lectores de pantalla. */ titulo?: string; testid?: string }

interface Props {
  /** Una o dos acciones primarias, siempre visibles (botones o enlaces con etiqueta corta). */
  primarias?: ReactNode;
  /** Acciones secundarias: se agrupan en el menu "Mas". Cada hijo es un boton o enlace (clase rtm-boton-item o variante="item"). */
  secundarias?: ReactNode;
  /** Navegacion entre vistas: control segmentado compacto; en movil pasa al menu. */
  vistas?: VistaAccion[];
  etiquetaMas?: string;
  etiquetaAria?: string;
}

const FOCALIZABLES = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled)';

/** Barra de acciones de una sola fila: 1 o 2 primarias, vistas en segmentado y el resto en "Mas" (desplegable con teclado). Nunca se parte en dos filas. */
export function BarraAcciones({ primarias, secundarias, vistas = [], etiquetaMas = 'Más', etiquetaAria = 'Acciones de la página' }: Props) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const disparo = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    panel.current?.querySelector<HTMLElement>(FOCALIZABLES)?.focus();
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  const teclas = (e: KeyboardEvent) => {
    if (!abierto) return;
    if (e.key === 'Escape') { setAbierto(false); disparo.current?.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>(FOCALIZABLES) ?? [])].filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (items.length === 0) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  // Al elegir un elemento el menu se cierra y el foco queda en "Mas" (el dialogo que abra devuelve el foco ahi).
  const alElegir = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a[href], button')) { setAbierto(false); disparo.current?.focus(); }
  };
  const hayMenu = secundarias !== undefined && secundarias !== null && secundarias !== false;

  return (
    <div className="rtm-ba" role="group" aria-label={etiquetaAria} ref={raiz} onKeyDown={teclas}>
      {vistas.length > 0 && (
        <nav className="rtm-ba-vistas" aria-label="Vistas relacionadas">
          {vistas.map((v) => <Link key={v.href} href={v.href} title={v.titulo} data-testid={v.testid}>{v.etiqueta}</Link>)}
        </nav>
      )}
      {(hayMenu || vistas.length > 0) && (
        <div className="rtm-ba-mas">
          <button ref={disparo} type="button" className="rtm-boton rtm-ba-disparo" aria-expanded={abierto} aria-controls={id} aria-haspopup="true" onClick={() => setAbierto((a) => !a)} data-testid="barra-mas">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="3" cy="8" r="1.4" fill="currentColor" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /><circle cx="13" cy="8" r="1.4" fill="currentColor" /></svg>
            <span className="rtm-ba-etq">{etiquetaMas}</span>
          </button>
          {/* El panel siempre esta montado: los dialogos de sus acciones conservan su estado al cerrar el menu. */}
          <div id={id} className="rtm-ba-panel" data-cerrado={abierto ? undefined : ''} ref={panel} onClick={alElegir}>
            {vistas.length > 0 && (
              <div className="rtm-ba-panel-vistas" role="group" aria-label="Ir a">
                {vistas.map((v) => <Link key={v.href} href={v.href} className="rtm-boton-item" title={v.titulo}>{v.titulo ?? v.etiqueta}</Link>)}
              </div>
            )}
            {secundarias}
          </div>
        </div>
      )}
      {primarias && <div className="rtm-ba-primarias">{primarias}</div>}
    </div>
  );
}
