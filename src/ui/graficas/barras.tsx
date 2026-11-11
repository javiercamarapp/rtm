import { DataTable } from '../componentes/data-table';

export interface DatoBarra { etiqueta: string; valor: number; texto: string; destacado?: boolean }

interface Props {
  titulo: string;
  datos: DatoBarra[];
  /** Resumen para lectores de pantalla. */
  descripcion: string;
  unidad: string;
}

/** Barras horizontales SVG propias, sin dependencias. Una serie = gris tinta con foco en el acento. Cada grafica trae su tabla equivalente. */
export function GraficaBarras({ titulo, datos, descripcion, unidad }: Props) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  return (
    <figure className="rtm-grafica" aria-label={titulo}>
      <figcaption className="rtm-grafica-titulo">{titulo}</figcaption>
      <ul className="rtm-barras" role="img" aria-label={descripcion}>
        {datos.map((d) => (
          <li key={d.etiqueta} className="rtm-barra-fila">
            <span className="rtm-barra-etiqueta">{d.etiqueta}</span>
            <svg className="rtm-barra-svg" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <rect x="0" y="0" width="100" height="10" className="rtm-barra-fondo" />
              <rect x="0" y="0" width={Math.max(0.6, (d.valor / max) * 100)} height="10" className={d.destacado ? 'rtm-barra-valor rtm-barra-foco' : 'rtm-barra-valor'} />
            </svg>
            <span className="rtm-barra-texto rtm-num">{d.texto}</span>
          </li>
        ))}
      </ul>
      <details className="rtm-grafica-tabla">
        <summary>Ver como tabla</summary>
        <DataTable
          etiqueta={`${titulo} (tabla equivalente)`}
          clave={(d) => d.etiqueta}
          filas={datos}
          columnas={[
            { id: 'e', titulo: 'Concepto', celda: (d) => d.etiqueta },
            { id: 'v', titulo: unidad, numerica: true, celda: (d) => d.texto },
          ]}
        />
      </details>
    </figure>
  );
}
