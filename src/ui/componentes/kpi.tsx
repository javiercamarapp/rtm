import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { Delta } from '../graficas/delta';
import { Sparkline } from '../graficas/sparkline';
import type { DeltaTexto } from '../graficas/tipos';

export interface ParteBarra { etiqueta: string; valor: number; estado?: 'real' | 'parcial' }
export interface KpiCelda {
  id: string;
  etiqueta: string;
  /** Texto ya formateado por el servidor (o CifraComprobada). null = sin dato: palabra, nunca un cero. */
  valor: ReactNode | null;
  delta?: DeltaTexto;
  /** Serie para el sparkline; solo si existe de verdad. Con menos de 2 puntos no se dibuja. */
  spark?: { etiquetas: readonly string[]; valores: readonly number[]; textos: readonly string[] };
  /** Barra segmentada de partes (parcial = trama). */
  partes?: ParteBarra[];
  /** Barra de progreso 0 a 100 con marca de meta opcional. */
  progreso?: { pct: number; meta?: number };
  nota?: ReactNode;
  /** 1 a 8: filete superior de la paleta de datos (--rtm-d-n). */
  categoria?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  href?: string;
  ayuda?: string;
  testid?: string;
}

const pct = (n: number) => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));

function BarraPartes({ partes }: { partes: ParteBarra[] }) {
  const uid = `p${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const total = partes.reduce((a, p) => a + Math.max(0, p.valor), 0);
  if (total <= 0) return null;
  let x = 0;
  return (
    <span className="rtm-kpi-partes">
      <svg width="100%" height="100%" role="img" aria-label={partes.map((p) => `${p.etiqueta}${p.estado === 'parcial' ? ' (parcial)' : ''}`).join(', ')} focusable="false">
        <defs>
          <pattern id={`${uid}-t`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" className="rtm-kpi-trama" /></pattern>
        </defs>
        {partes.map((p, i) => {
          const w = (Math.max(0, p.valor) / total) * 100;
          const el = (
            <g key={p.etiqueta}>
              <rect x={`${x}%`} y="0" width={`${Math.max(0, w - 0.8)}%`} height="100%" className="rtm-kpi-parte" data-i={i % 4} />
              {p.estado === 'parcial' && <rect x={`${x}%`} y="0" width={`${Math.max(0, w - 0.8)}%`} height="100%" fill={`url(#${uid}-t)`} />}
            </g>
          );
          x += w;
          return el;
        })}
      </svg>
    </span>
  );
}

function Celda({ c }: { c: KpiCelda }) {
  const sinDato = c.valor === null || c.valor === undefined;
  const cuerpo = (
    <>
      <span className="rtm-kpi-etiqueta">{c.etiqueta}</span>
      <strong className="rtm-kpi-cifra" data-sin-dato={sinDato || undefined}>{sinDato ? 'Sin dato' : c.valor}</strong>
      {!sinDato && c.delta && <Delta delta={c.delta} />}
      {!sinDato && c.spark && c.spark.valores.length >= 2 && (
        <span className="rtm-kpi-spark">
          <Sparkline titulo={c.etiqueta} descripcion={`Tendencia de ${c.etiqueta}`} etiquetas={c.spark.etiquetas} valores={c.spark.valores} textos={c.spark.textos} ancho={72} alto={24} />
        </span>
      )}
      {!sinDato && c.partes && <BarraPartes partes={c.partes} />}
      {!sinDato && c.progreso && (
        <span className="rtm-kpi-progreso">
          <svg width="100%" height="100%" role="img" aria-label={`${Math.round(pct(c.progreso.pct))} %${c.progreso.meta !== undefined ? `, meta ${Math.round(pct(c.progreso.meta))} %` : ''}`} focusable="false">
            <rect x="0" y="0" width="100%" height="6" rx="3" className="rtm-kpi-pista" />
            <rect x="0" y="0" width={`${pct(c.progreso.pct)}%`} height="6" rx="3" className="rtm-kpi-valor" />
            {c.progreso.meta !== undefined && <rect x={`${pct(c.progreso.meta)}%`} y="0" width="2" height="6" className="rtm-kpi-meta" />}
          </svg>
        </span>
      )}
      {c.nota && <span className="rtm-kpi-nota">{c.nota}</span>}
    </>
  );
  const atributos = {
    className: 'rtm-kpi-celda',
    title: c.ayuda,
    'data-testid': c.testid,
    'data-categoria': c.categoria,
  };
  return c.href ? <Link href={c.href} {...atributos} data-enlace="true">{cuerpo}</Link> : <div {...atributos}>{cuerpo}</div>;
}

/** Tira de indicadores. `linea`: UNA tarjeta con celdas separadas por filete (4 o 5). `tarjetas`: tarjetas sueltas para metricas de dominios distintos. */
export function KpiLinea({ celdas, variante = 'linea', etiquetaAria }: { celdas: KpiCelda[]; variante?: 'linea' | 'tarjetas'; etiquetaAria: string }) {
  return (
    <section className="rtm-kpi-linea rtm-entra rtm-i-1" data-variante={variante} data-n={Math.min(6, Math.max(2, celdas.length))} aria-label={etiquetaAria}>
      {celdas.map((c) => <Celda key={c.id} c={c} />)}
    </section>
  );
}

/** Razones secundarias en texto compacto bajo la tira de KPI. Sin caja. */
export function FilaRatios({ etiqueta, items }: { etiqueta: string; items: { etiqueta: string; valor: ReactNode | null; delta?: DeltaTexto }[] }) {
  return (
    <dl className="rtm-ratios" aria-label={etiqueta}>
      {items.map((r) => (
        <div key={r.etiqueta}>
          <dt>{r.etiqueta}</dt>
          <dd>{r.valor ?? <span className="rtm-sin-dato">Sin dato</span>}{r.valor !== null && r.delta && <Delta delta={r.delta} />}</dd>
        </div>
      ))}
    </dl>
  );
}
