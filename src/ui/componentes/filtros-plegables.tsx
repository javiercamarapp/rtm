'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import '@/ui/estilos/barrido-a.css';
import { atraparTab, enfocarPrimero, useColision } from './colision';

interface Props {
  /** Texto corto del disparador (por omision "Filtros"). */
  etiqueta?: string;
  /** Cuantos filtros del panel estan aplicados: se muestra como contador y no se pierde al cerrar. */
  activos?: number;
  /** Descripcion larga para title y lectores de pantalla. */
  titulo?: string;
  children: ReactNode;
}

/** Filtros agrupados en un desplegable flotante (no ocupa alto en la pagina). Los campos siguen montados al cerrar, asi que un formulario que los contiene los envia igual. Cierra con Escape o al pulsar fuera. */
export function FiltrosPlegables({ etiqueta = 'Filtros', activos = 0, titulo, children }: Props) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const disparo = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useColision(abierto, panel);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    enfocarPrimero(panel.current);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  return (
    <div className="rtm-ba-fp" ref={raiz} onKeyDown={(e) => { if (e.key === 'Escape' && abierto) { setAbierto(false); disparo.current?.focus(); } else if (abierto) atraparTab(e, panel.current); }}>
      <button ref={disparo} type="button" className="rtm-boton rtm-ba-fp-disparo" aria-expanded={abierto} aria-haspopup="true" aria-controls={id} title={titulo} onClick={() => setAbierto((a) => !a)} data-testid="filtros-plegables">
        {etiqueta}
        {activos > 0 && <small aria-label={`${activos} aplicados`}>{activos}</small>}
        <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      <div id={id} ref={panel} className="rtm-ba-fp-panel" data-flota hidden={!abierto} role="group" aria-label={titulo ?? etiqueta}>{children}</div>
    </div>
  );
}
