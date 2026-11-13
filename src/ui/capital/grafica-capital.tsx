// Grafica sobria de capital: por mes, tres columnas (aportaciones de capital acumuladas, utilidad generada acumulada y valuacion al cierre) del total de los socios.
// Blanco y negro: se distinguen por tinta y trama, no solo por color. La tabla alterna trae los mismos datos en texto. Todo viene calculado por la base.
import { formatearMoneda } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';

export interface PuntoCapital { id: string; etiqueta: string; aportaciones: bigint; utilidad: bigint; valuacion: bigint }

const SERIES = [
  { k: 'aportaciones', nombre: 'Aportaciones de capital', relleno: 'url(#cap-rayas)', trazo: 'var(--rtm-ink)' },
  { k: 'utilidad', nombre: 'Utilidad generada', relleno: 'var(--rtm-ink-3)', trazo: 'var(--rtm-ink-3)' },
  { k: 'valuacion', nombre: 'Valuación', relleno: 'var(--rtm-ink)', trazo: 'var(--rtm-ink)' },
] as const;

const compacto = (c: bigint): string => {
  const p = Number(c) / 100;
  const a = Math.abs(p);
  return a >= 1_000_000 ? `${(p / 1_000_000).toFixed(1)} M` : a >= 1000 ? `${Math.round(p / 1000)} mil` : String(Math.round(p));
};

export function GraficaCapital({ puntos, titulo, descripcion, pie }: { puntos: readonly PuntoCapital[]; titulo: string; descripcion: string; pie: string }) {
  const W = 640, H = 220, MI = 56, MB = 28, MS = 12;
  const max = puntos.reduce((a, p) => [p.aportaciones, p.utilidad, p.valuacion].reduce((b, x) => (x > b ? x : b), a), 0n);
  const tope = max > 0n ? Number(max) : 1;
  const paso = (W - MI - 8) / Math.max(1, puntos.length);
  const grupo = Math.min(120, paso * 0.8);
  const col = grupo / 3 - 2;
  const y = (v: bigint) => H - MB - (Math.max(0, Number(v)) / tope) * (H - MB - MS);
  const marcas = [0, 0.5, 1].map((f) => BigInt(Math.round(tope * f)));
  return (
    <figure className="rtm-capital-grafica" data-testid="grafica-capital">
      <figcaption className="rtm-capital-titulo">{titulo}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={descripcion} className="rtm-capital-svg">
        <defs>
          <pattern id="cap-rayas" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--rtm-surface)" /><rect width="2.5" height="6" fill="var(--rtm-ink)" /></pattern>
        </defs>
        {marcas.map((m) => (
          <g key={String(m)}><line x1={MI} x2={W - 4} y1={y(m)} y2={y(m)} stroke="var(--rtm-line)" strokeWidth="1" /><text x={MI - 6} y={y(m) + 4} textAnchor="end" className="rtm-capital-eje">{compacto(m)}</text></g>
        ))}
        {puntos.map((p, i) => {
          const x0 = MI + paso * i + (paso - grupo) / 2;
          return (
            <g key={p.id}>
              {SERIES.map((s, j) => {
                const v = p[s.k];
                return <rect key={s.k} x={x0 + j * (col + 2)} y={y(v)} width={col} height={Math.max(1, H - MB - y(v))} fill={s.relleno} stroke={s.trazo} strokeWidth="1"><title>{`${p.etiqueta}: ${s.nombre} ${formatearMoneda(v)}`}</title></rect>;
              })}
              <text x={MI + paso * i + paso / 2} y={H - 8} textAnchor="middle" className="rtm-capital-eje">{p.etiqueta}</text>
            </g>
          );
        })}
      </svg>
      <ul className="rtm-capital-leyenda" aria-label="Series">
        {SERIES.map((s) => (
          <li key={s.k}><svg width="14" height="14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" fill={s.relleno} stroke={s.trazo} /></svg>{s.nombre}</li>
        ))}
      </ul>
      <details className="rtm-capital-tabla-alterna">
        <summary>Ver como tabla</summary>
        <DataTable
          etiqueta="Aportaciones, utilidad y valuación por mes" clave={(p) => p.id} filas={[...puntos]} densidad="densa" plana
          columnas={[
            { id: 'm', titulo: 'Mes', celda: (p) => p.etiqueta },
            { id: 'a', titulo: 'Aportaciones de capital', numerica: true, etiquetaMovil: 'Capital', celda: (p) => formatearMoneda(p.aportaciones) },
            { id: 'u', titulo: 'Utilidad generada', numerica: true, etiquetaMovil: 'Utilidad', celda: (p) => formatearMoneda(p.utilidad) },
            { id: 'v', titulo: 'Valuación', numerica: true, celda: (p) => formatearMoneda(p.valuacion) },
          ]}
        />
      </details>
      <p className="rtm-nota">{pie}</p>
    </figure>
  );
}
