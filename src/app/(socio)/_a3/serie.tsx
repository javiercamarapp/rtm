// Grafica de una serie semanal de contabilidad. Columnas por periodo si todo es positivo; con valores negativos una lista de barras con signo escrito
// (las columnas no pintan negativos y un cero falso seria deshonesto). Menos de 2 semanas con movimientos: estado vacio honesto.
import { ColumnasPesos } from './graficas-pesos';
import type { SemanaSerie } from '@/dominio/contabilidad/serie';
import { BarList } from '@/ui/componentes/datos';

import { abs, fechaCorta, m, pct } from './util';

interface Props {
  titulo: string;
  descripcion: string;
  semanas: readonly SemanaSerie[];
  valor: (s: SemanaSerie) => bigint;
  pie: string;
  alto?: number;
  /** 2 = la lista de semanas con signo en dos columnas (tarjetas de ancho completo). */
  columnas?: 1 | 2;
}

export function GraficaSemanas({ titulo, descripcion, semanas: todas, valor, pie, alto, columnas = 1 }: Props) {
  // Las semanas anteriores al primer movimiento no son historia: no se dibujan.
  const primera = todas.findIndex((s) => s.con_movimientos);
  const semanas = primera < 0 ? [] : todas.slice(primera);
  const conDato = semanas.filter((s) => s.con_movimientos);
  if (conDato.length < 2) {
    return <p className="a3-grafica-vacia"><strong>Pocos datos para hablar de esto</strong>Hay {conDato.length} {conDato.length === 1 ? 'semana' : 'semanas'} con movimientos; con dos o más se dibuja la serie.</p>;
  }
  const hayNegativos = semanas.some((s) => valor(s) < 0n);
  if (!hayNegativos) {
    return (
      <ColumnasPesos titulo={titulo} descripcion={descripcion} procedencia="observado" pie={pie} alto={alto}
        datos={semanas.map((s) => ({ id: s.ini, etiqueta: fechaCorta(s.ini), valor: Number(valor(s)), texto: m(valor(s)), parcial: s.parcial, detalle: `Semana del ${fechaCorta(s.ini)} al ${fechaCorta(s.fin)}` }))} />
    );
  }
  const max = semanas.reduce((a, s) => (abs(valor(s)) > a ? abs(valor(s)) : a), 0n);
  return (
    <>
      <BarList columnas={columnas} etiquetaAria={titulo} items={[...semanas].reverse().map((s) => ({ id: s.ini, etiqueta: `Semana del ${fechaCorta(s.ini)}${s.parcial ? ' (en curso)' : ''}`, texto: s.con_movimientos ? m(valor(s), true) : 'Sin movimientos', pct: s.con_movimientos ? pct(abs(valor(s)), max) : null, tono: valor(s) < 0n ? ('malo' as const) : undefined }))} />
      <p className="a3-pie">{pie}</p>
    </>
  );
}
