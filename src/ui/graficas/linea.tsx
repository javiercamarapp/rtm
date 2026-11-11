import { DataTable } from '../componentes/data-table';

export interface PuntoLinea { etiqueta: string; valor: number; texto: string }

interface Props { titulo: string; puntos: PuntoLinea[]; descripcion: string; unidad: string }

const ANCHO = 600;
const ALTO = 180;
const MARGEN = 16;

/** Linea escalonada SVG propia (el precio rige hasta que cambia). Con menos de 2 puntos no se dibuja: estado honesto, sin linea inventada. */
export function GraficaLinea({ titulo, puntos, descripcion, unidad }: Props) {
  if (puntos.length < 2) {
    return (
      <figure className="rtm-grafica" aria-label={titulo}>
        <figcaption className="rtm-grafica-titulo">{titulo}</figcaption>
        <p className="rtm-nota">Sin historia suficiente: hace falta más de un precio para dibujar la línea.</p>
      </figure>
    );
  }
  const min = Math.min(...puntos.map((p) => p.valor));
  const max = Math.max(...puntos.map((p) => p.valor));
  const rango = Math.max(1, max - min);
  const x = (i: number) => MARGEN + (i / (puntos.length - 1)) * (ANCHO - 2 * MARGEN);
  const y = (v: number) => ALTO - MARGEN - ((v - min) / rango) * (ALTO - 2 * MARGEN);
  let d = `M ${x(0).toFixed(1)} ${y(puntos[0]!.valor).toFixed(1)}`;
  for (let i = 1; i < puntos.length; i += 1) d += ` H ${x(i).toFixed(1)} V ${y(puntos[i]!.valor).toFixed(1)}`;
  return (
    <figure className="rtm-grafica" aria-label={titulo}>
      <figcaption className="rtm-grafica-titulo">{titulo}</figcaption>
      <svg className="rtm-linea" viewBox={`0 0 ${ANCHO} ${ALTO}`} role="img" aria-label={descripcion} focusable="false">
        <line x1={MARGEN} x2={ANCHO - MARGEN} y1={ALTO - MARGEN} y2={ALTO - MARGEN} className="rtm-eje" />
        <path d={d} pathLength={1} className="rtm-linea-trazo" fill="none" />
        {puntos.map((p, i) => (
          <circle key={`${p.etiqueta}-${i}`} cx={x(i)} cy={y(p.valor)} r={i === puntos.length - 1 ? 4.5 : 3} className={i === puntos.length - 1 ? 'rtm-punto-foco' : 'rtm-punto-linea'} />
        ))}
        <text x={MARGEN} y={12} className="rtm-eje-texto">{puntos.find((p) => p.valor === max)!.texto}</text>
        <text x={MARGEN} y={ALTO - 2} className="rtm-eje-texto">{puntos[0]!.etiqueta}</text>
        <text x={ANCHO - MARGEN} y={ALTO - 2} textAnchor="end" className="rtm-eje-texto">{puntos[puntos.length - 1]!.etiqueta}</text>
      </svg>
      <details className="rtm-grafica-tabla">
        <summary>Ver como tabla</summary>
        <DataTable etiqueta={`${titulo} (tabla equivalente)`} clave={(p) => p.etiqueta} filas={puntos}
          columnas={[{ id: 'e', titulo: 'Desde', celda: (p) => p.etiqueta }, { id: 'v', titulo: unidad, numerica: true, celda: (p) => p.texto }]} />
      </details>
    </figure>
  );
}
