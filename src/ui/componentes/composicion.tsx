import type { ReactNode } from 'react';

export interface SegmentoComposicion {
  id: string;
  etiqueta: string;
  /** Magnitud para la proporcion. null o 0 = sin aporte. */
  valor: number | null;
  /** Texto ya formateado (dinero, piezas) que se muestra junto a la etiqueta. */
  texto: ReactNode;
  nota?: string;
}

export interface GrupoComposicion {
  id: string;
  titulo: string;
  segmentos: SegmentoComposicion[];
}

const MAX_SEGMENTOS = 4;

/** Reparte los segmentos en porcentajes que suman 100 sobre los que si aportan; sin aporte alguno devuelve null (Sin dato). */
export function repartir(segmentos: SegmentoComposicion[]): { seg: SegmentoComposicion; pct: number; x: number }[] | null {
  const utiles = segmentos.slice(0, MAX_SEGMENTOS).filter((s) => s.valor !== null && Number.isFinite(s.valor) && s.valor > 0);
  const total = utiles.reduce((a, s) => a + (s.valor ?? 0), 0);
  if (total <= 0) return null;
  let acum = 0;
  return utiles.map((seg) => {
    const pct = ((seg.valor ?? 0) / total) * 100;
    const fila = { seg, pct, x: acum };
    acum += pct;
    return fila;
  });
}

/**
 * Composicion animada: por cada grupo una barra apilada de 100 % y su leyenda (etiqueta, porcentaje y cifra).
 * Llena el espacio de una tarjeta que comparte fila con otra mas alta: los grupos se reparten la altura disponible.
 * Solo recibe datos que la pagina ya calculo; sin aporte muestra "Sin dato", nunca un cero inventado.
 * Movimiento: la barra crece de izquierda a derecha una vez; con movimiento reducido o apagado pinta el estado final.
 */
export function Composicion({ etiquetaAria, grupos }: { etiquetaAria: string; grupos: GrupoComposicion[] }) {
  return (
    <div className="rtm-comp" role="group" aria-label={etiquetaAria}>
      {grupos.map((g) => {
        const partes = repartir(g.segmentos);
        return (
          <section className="rtm-comp-grupo" key={g.id} aria-label={g.titulo}>
            <p className="rtm-a1-subtitulo">{g.titulo}</p>
            {partes === null ? (
              <p className="rtm-a1-estado-vacio">Sin dato</p>
            ) : (
              <>
                <svg className="rtm-comp-barra" width="100%" height="14" focusable="false" aria-hidden="true">
                  {partes.map((p, i) => (
                    <rect key={p.seg.id} className="rtm-comp-seg" data-tono={i + 1} x={`${p.x}%`} y="0" width={`${Math.max(0.8, p.pct)}%`} height="14" />
                  ))}
                </svg>
                <ul className="rtm-comp-leyenda">
                  {partes.map((p, i) => (
                    <li key={p.seg.id}>
                      <span className="rtm-comp-marca" data-tono={i + 1} aria-hidden="true" />
                      <span className="rtm-comp-nombre">{p.seg.etiqueta}{p.seg.nota && <small>{p.seg.nota}</small>}</span>
                      <span className="rtm-comp-pct">{Math.round(p.pct)} %</span>
                      <span className="rtm-comp-texto">{p.seg.texto}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
