'use client';

import { useState } from 'react';
import { useNavegacionTeclado } from './piezas';
import { MarcoGrafica, estadoDe } from './marco';
import { abreviarNombre, calcularPareto, claseEscalonado, elementosHasta, r2, seguro } from './geo';
import { textoCifra } from './formato';
import type { BaseGrafica, TablaAlterna } from './tipos';

export interface DatoPareto {
  id: string;
  etiqueta: string;
  valor: number;
  /** Monto exacto (tooltip, lectura y tabla). */
  texto: string;
  /** Monto compacto para la fila ("$210 mil"). Si falta, se usa `texto`. */
  corto?: string;
}

interface Props extends BaseGrafica {
  datos: readonly DatoPareto[];
  unidad: string;
  /** Umbral de concentracion que se senala (0 a 1). Por omision 0.8. */
  umbral?: number;
  /** Sustantivo en plural para la lectura: "clientes", "modelos". */
  sustantivo: string;
  tablaAbierta?: boolean;
}

/**
 * Pareto en filas horizontales, de mayor a menor: nombre a la izquierda, barra, monto compacto y porcentaje acumulado a la derecha.
 * Las filas que alcanzan el umbral van en el acento y una regla con rotulo propio, fuera del area de datos, marca donde se cruza.
 * Sin etiquetas flotantes sobre las barras: nada puede empalmarse, con 4 o con 40 elementos.
 */
export function Pareto({ datos, unidad, umbral = 0.8, sustantivo, tablaAbierta, ...base }: Props) {
  const nav = useNavegacionTeclado(datos.length, 1);
  const [sobre, setSobre] = useState<string | null>(null);
  const calculo = seguro(() => {
    const filas = calcularPareto(datos);
    const info = new Map(datos.map((d) => [d.id, d]));
    const hasta = elementosHasta(filas, umbral);
    const max = Math.max(1, ...filas.map((f) => f.valor));
    return { filas, info, hasta, max, acumHasta: filas[hasta - 1]!.acumulada };
  });
  const pct = (f: number) => textoCifra(f * 100, 'porcentaje');
  const tabla: TablaAlterna = {
    columnas: [{ id: 'p', titulo: 'Posición', numerica: true }, { id: 'c', titulo: 'Concepto' }, { id: 'v', titulo: unidad, numerica: true }, { id: 'f', titulo: 'Participación', numerica: true }, { id: 'a', titulo: 'Acumulado', numerica: true }],
    filas: calculo.ok ? calculo.valor.filas.map((f, i) => ({ clave: f.id, celdas: [String(i + 1), f.etiqueta, calculo.valor.info.get(f.id)?.texto ?? '', pct(f.fraccion), pct(f.acumulada)] })) : [],
  };
  const lectura = calculo.ok ? `Los ${calculo.valor.hasta} primeros ${sustantivo} concentran ${pct(calculo.valor.acumHasta)} del total.` : '';
  const activo = calculo.ok ? calculo.valor.filas.find((f) => f.id === sobre) : undefined;
  const detalle = (f: { id: string; etiqueta: string; fraccion: number; acumulada: number }, i: number) =>
    `${i + 1}. ${f.etiqueta}: ${calculo.ok ? (calculo.valor.info.get(f.id)?.texto ?? '') : ''}, ${pct(f.fraccion)} del total, acumulado ${pct(f.acumulada)}`;
  return (
    <MarcoGrafica
      {...base}
      forma="pareto"
      tabla={tabla}
      tablaAbierta={tablaAbierta}
      estado={estadoDe(base.estado, calculo.ok)}
      mensajeError={calculo.ok ? undefined : calculo.error.message}
      leyenda={
        calculo.ok ? (
          <>
            <ul className="rtm-g-leyenda" aria-label="Leyenda">
              <li><span className="rtm-g-par-muestra rtm-g-par-muestra-foco" aria-hidden="true" />{`Primeros ${calculo.valor.hasta}: alcanzan ${pct(umbral)}`}</li>
              <li><span className="rtm-g-par-muestra" aria-hidden="true" />Resto</li>
              <li><span className="rtm-g-par-muestra-acum" aria-hidden="true" />Acumulado: parte del total sumada hasta esa fila</li>
            </ul>
            <p className="rtm-g-lectura">{lectura}</p>
            <p className="rtm-g-par-detalle" aria-live="polite">{activo ? detalle(activo, calculo.valor.filas.indexOf(activo)) : 'Pasa el cursor o enfoca una fila para ver el monto exacto.'}</p>
          </>
        ) : undefined
      }
    >
      {calculo.ok && (
        <div className="rtm-g-lienzo rtm-g-par-lienzo">
          <div className="rtm-g-par-cabeza" aria-hidden="true">
            <span />
            <span>Nombre</span>
            <span>{`Proporción de ${unidad.toLowerCase()}`}</span>
            <span className="rtm-g-par-der">{unidad}</span>
            <span className="rtm-g-par-der">Acum.</span>
          </div>
          <ul className="rtm-g-par" aria-label={base.descripcion}>
            {calculo.valor.filas.map((f, i) => {
              const d = calculo.valor.info.get(f.id)!;
              const dentro = i < calculo.valor.hasta;
              const cierra = i === calculo.valor.hasta - 1 && i < calculo.valor.filas.length - 1;
              return (
                <li key={f.id} className="rtm-g-par-item">
                  <div
                    className="rtm-g-par-fila"
                    role="img"
                    aria-label={detalle(f, i)}
                    title={detalle(f, i)}
                    data-marca={f.id}
                    data-dentro={dentro}
                    onMouseEnter={() => setSobre(f.id)}
                    onMouseLeave={() => setSobre(null)}
                    onBlur={() => setSobre(null)}
                    {...nav.props(i)}
                    onFocus={() => {
                      nav.props(i).onFocus();
                      setSobre(f.id);
                    }}
                  >
                    <span className="rtm-g-rango rtm-num" aria-hidden="true">{i + 1}</span>
                    <span className="rtm-g-par-nombre" aria-hidden="true">{abreviarNombre(f.etiqueta)}</span>
                    <svg className="rtm-g-par-barra" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                      <rect x="0" y="0" width="100" height="10" className="rtm-g-fondo" />
                      <rect x="0" y="0" width={r2(Math.max(0.8, (f.valor / calculo.valor.max) * 100))} height="10" className={`rtm-g-crece-x ${claseEscalonado(i)} ${dentro ? 'rtm-g-foco' : 'rtm-g-base'}`} />
                    </svg>
                    <span className="rtm-g-par-monto rtm-num" aria-hidden="true">{d.corto ?? d.texto}</span>
                    <span className="rtm-g-par-acum rtm-num" aria-hidden="true">
                      <svg className="rtm-g-par-mini" viewBox="0 0 100 4" preserveAspectRatio="none" focusable="false">
                        <rect x="0" y="0" width="100" height="4" className="rtm-g-fondo" />
                        <rect x="0" y="0" width={r2(f.acumulada * 100)} height="4" className="rtm-g-total" />
                        <line x1={r2(umbral * 100)} x2={r2(umbral * 100)} y1="0" y2="4" className="rtm-g-umbral" vectorEffect="non-scaling-stroke" />
                      </svg>
                      {pct(f.acumulada)}
                    </span>
                  </div>
                  {cierra && (
                    <div className="rtm-g-par-regla" data-llave="umbral" aria-hidden="true">
                      <span>{`Hasta aquí: ${calculo.valor.hasta} ${sustantivo}, ${pct(calculo.valor.acumHasta)} de las ${unidad.toLowerCase()} (umbral ${pct(umbral)})`}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </MarcoGrafica>
  );
}
