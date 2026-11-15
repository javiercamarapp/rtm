'use client';

import { useRef } from 'react';
import { FiltrosPlegables } from './filtros-plegables';
import { atajosPeriodo } from './periodo';

interface Props {
  desde: string | null;
  hasta: string | null;
  etiqueta?: string;
  titulo?: string;
}

/** Desplegable de periodo para un formulario GET: Desde y Hasta en una grilla de dos columnas, atajos (Hoy, 7 dias, 30 dias, Este mes) y acciones Limpiar y Aplicar alineadas a la derecha. Debe ir dentro de un `<form method="get">`. */
export function FiltroPeriodo({ desde, hasta, etiqueta = 'Periodo', titulo = 'Filtrar por periodo (desde y hasta)' }: Props) {
  const d = useRef<HTMLInputElement>(null);
  const h = useRef<HTMLInputElement>(null);
  const aplicar = (a: string, b: string) => {
    if (!d.current || !h.current) return;
    d.current.value = a;
    h.current.value = b;
    d.current.form?.requestSubmit();
  };
  return (
    <FiltrosPlegables etiqueta={etiqueta} titulo={titulo} activos={(desde ? 1 : 0) + (hasta ? 1 : 0)}>
      <div className="rtm-fp-periodo">
        <label className="rtm-etiqueta-campo">Desde<input ref={d} className="rtm-campo" type="date" name="desde" defaultValue={desde ?? ''} /></label>
        <label className="rtm-etiqueta-campo">Hasta<input ref={h} className="rtm-campo" type="date" name="hasta" defaultValue={hasta ?? ''} /></label>
        <div className="rtm-fp-atajos" role="group" aria-label="Atajos de periodo">
          {atajosPeriodo(new Date()).map((a) => <button key={a.id} type="button" className="rtm-boton rtm-boton-chico" onClick={() => aplicar(a.desde, a.hasta)} data-testid={`periodo-${a.id}`}>{a.etiqueta}</button>)}
        </div>
        <div className="rtm-fp-acciones">
          <button type="button" className="rtm-boton rtm-boton-terciario" onClick={() => aplicar('', '')} data-testid="periodo-limpiar">Limpiar</button>
          <button type="submit" className="rtm-boton rtm-boton-primario" data-testid="periodo-aplicar">Aplicar</button>
        </div>
      </div>
    </FiltrosPlegables>
  );
}
