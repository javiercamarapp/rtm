'use client';

// Piezas comunes de las graficas: patrones (para no depender solo del color), marcadores de forma, delta con flecha, marca de procedencia
// y navegacion por teclado con indice itinerante.
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { siguienteIndice, r2, type SentidoDelta } from './geo';
import { palabraSentido } from './formato';
import { FORMAS_SERIE, PATRONES_SERIE, type DeltaTexto, type FormaMarcador, type NombrePatron, type Procedencia } from './tipos';

/** Identificador seguro para referencias url(#...) dentro de un SVG. */
export function useUidSvg(): string {
  return `g${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

// ---------- Patrones ----------
function UnaFamilia({ uid, sufijo }: { uid: string; sufijo: '' | '-t' }) {
  const l = sufijo === '' ? 'rtm-g-pat-linea' : 'rtm-g-pat-linea-t';
  const p = sufijo === '' ? 'rtm-g-pat-punto' : 'rtm-g-pat-punto-t';
  return (
    <>
      <pattern id={`${uid}-rayas${sufijo}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" className={l} />
      </pattern>
      <pattern id={`${uid}-puntos${sufijo}`} width="6" height="6" patternUnits="userSpaceOnUse">
        <circle cx="3" cy="3" r="1.1" className={p} />
      </pattern>
      <pattern id={`${uid}-cuadros${sufijo}`} width="8" height="8" patternUnits="userSpaceOnUse">
        <rect x="0" y="0" width="4" height="4" className={p} />
        <rect x="4" y="4" width="4" height="4" className={p} />
      </pattern>
      <pattern id={`${uid}-cruz${sufijo}`} width="7" height="7" patternUnits="userSpaceOnUse">
        <line x1="0" y1="3.5" x2="7" y2="3.5" className={l} />
        <line x1="3.5" y1="0" x2="3.5" y2="7" className={l} />
      </pattern>
    </>
  );
}

/** Definiciones de trama en dos familias: clara (sobre marcas de color pleno) y tinta (sobre rellenos suaves). */
export function DefsPatrones({ uid }: { uid: string }) {
  return (
    <defs>
      <UnaFamilia uid={uid} sufijo="" />
      <UnaFamilia uid={uid} sufijo="-t" />
    </defs>
  );
}

export function urlPatron(uid: string, patron: NombrePatron, tinta: boolean = false): string | undefined {
  return patron === 'liso' ? undefined : `url(#${uid}-${patron}${tinta ? '-t' : ''})`;
}

export function patronDeSerie(i: number): NombrePatron {
  return PATRONES_SERIE[i % PATRONES_SERIE.length]!;
}

export function formaDeSerie(i: number): FormaMarcador {
  return FORMAS_SERIE[i % FORMAS_SERIE.length]!;
}

/** Muestra de leyenda: el color Y la trama de la serie, para que la leyenda tampoco dependa solo del color. */
export function MuestraLeyenda({ uid, indice, redonda = false, suave = false }: { uid: string; indice: number; redonda?: boolean; suave?: boolean }) {
  const patron = patronDeSerie(indice);
  const clase = `${suave ? 'rtm-g-suave ' : ''}rtm-g-s${indice % 8}`;
  const capa = urlPatron(uid, patron, suave);
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" className="rtm-g-muestra">
      {redonda ? <circle cx="8" cy="8" r="7" className={clase} /> : <rect x="1" y="1" width="14" height="14" rx="3" className={clase} />}
      {capa && (redonda ? <circle cx="8" cy="8" r="7" fill={capa} className="rtm-g-trama-capa" /> : <rect x="1" y="1" width="14" height="14" rx="3" fill={capa} className="rtm-g-trama-capa" />)}
    </svg>
  );
}

// ---------- Marcadores ----------
interface PropsMarcador { forma: FormaMarcador; x: number; y: number; r: number; className?: string }

/** Marcador de punto con forma distinta por serie (circulo, cuadrado, triangulo, rombo). */
export function Marcador({ forma, x, y, r, className }: PropsMarcador) {
  switch (forma) {
    case 'circulo':
      return <circle cx={r2(x)} cy={r2(y)} r={r2(r)} className={className} />;
    case 'cuadrado':
      return <rect x={r2(x - r)} y={r2(y - r)} width={r2(2 * r)} height={r2(2 * r)} className={className} />;
    case 'triangulo':
      return <polygon points={`${r2(x)},${r2(y - r * 1.2)} ${r2(x + r * 1.15)},${r2(y + r * 0.9)} ${r2(x - r * 1.15)},${r2(y + r * 0.9)}`} className={className} />;
    case 'rombo':
      return <polygon points={`${r2(x)},${r2(y - r * 1.3)} ${r2(x + r * 1.3)},${r2(y)} ${r2(x)},${r2(y + r * 1.3)} ${r2(x - r * 1.3)},${r2(y)}`} className={className} />;
  }
}

// ---------- Delta ----------
const FLECHAS: Record<SentidoDelta, string> = { sube: '▲', baja: '▼', igual: '■' };

export function flechaDe(sentido: SentidoDelta): string {
  return FLECHAS[sentido];
}

/** Cambio entre periodos: flecha, signo (en el texto) y palabra. Sin semaforo: ni rojo ni verde. */
export function Delta({ delta }: { delta: DeltaTexto }) {
  return (
    <span className="rtm-g-delta" data-sentido={delta.sentido}>
      <span aria-hidden="true" className="rtm-g-delta-flecha">{flechaDe(delta.sentido)}</span>
      <span className="rtm-num">{delta.texto}</span>
      <span className="rtm-solo-lectores">{palabraSentido(delta.sentido)}</span>
    </span>
  );
}

// ---------- Procedencia ----------
const PROCEDENCIAS: Record<Procedencia, { palabra: string; ayuda: string }> = {
  observado: { palabra: 'Observado', ayuda: 'Leído de hechos registrados en el sistema' },
  estimado: { palabra: 'Estimado', ayuda: 'Calculado con un modelo de proyección' },
  inferido: { palabra: 'Inferido', ayuda: 'Deducido de un patrón; no es un hecho registrado' },
};

export function palabraProcedencia(p: Procedencia): string {
  return PROCEDENCIAS[p].palabra;
}

/** Marca de procedencia: palabra + glifo distinto (circulo lleno, circulo discontinuo, rombo vacio). */
export function MarcaProcedencia({ procedencia }: { procedencia: Procedencia }) {
  const { palabra, ayuda } = PROCEDENCIAS[procedencia];
  return (
    <span className="rtm-g-procedencia" data-procedencia={procedencia} title={ayuda}>
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
        {procedencia === 'observado' && <circle cx="6" cy="6" r="4" className="rtm-g-proc-lleno" />}
        {procedencia === 'estimado' && <circle cx="6" cy="6" r="4" className="rtm-g-proc-discontinuo" />}
        {procedencia === 'inferido' && <polygon points="6,1.5 10.5,6 6,10.5 1.5,6" className="rtm-g-proc-vacio" />}
      </svg>
      {palabra}
    </span>
  );
}

// ---------- Teclado ----------
interface Navegacion {
  activo: number;
  /** Propiedades para el elemento i: ref, tabIndex itinerante, teclas y foco. */
  props: (i: number) => { ref: (el: Element | null) => void; tabIndex: number; onKeyDown: (e: KeyboardEvent<Element>) => void; onFocus: () => void };
}

/** Indice itinerante: una sola parada de Tab en la grafica; flechas, Inicio y Fin recorren las marcas. `columnas` habilita arriba/abajo por filas. */
export function useNavegacionTeclado(total: number, columnas: number = 1): Navegacion {
  const [activoCrudo, setActivo] = useState(0);
  const refs = useRef<Array<Element | null>>([]);
  const activo = Math.min(activoCrudo, Math.max(0, total - 1));
  const alTeclear = (e: KeyboardEvent<Element>) => {
    const sig = siguienteIndice(activo, total, e.key, columnas);
    if (sig === null) return;
    e.preventDefault();
    setActivo(sig);
    const el = refs.current[sig];
    if (el && 'focus' in el && typeof el.focus === 'function') el.focus();
  };
  return {
    activo,
    props: (i) => ({
      ref: (el) => {
        refs.current[i] = el;
      },
      tabIndex: i === activo ? 0 : -1,
      onKeyDown: alTeclear,
      onFocus: () => setActivo(i),
    }),
  };
}
