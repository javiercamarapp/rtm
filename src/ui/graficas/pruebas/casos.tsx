// Un caso por tipo de grafica, con datos ilustrativos y lo que su tabla alterna debe contener. Compartido por las pruebas de accesibilidad, movimiento y color.
import type { ReactElement } from 'react';
import {
  AntiguedadSaldos, BarrasDelta, Bump, Burbujas, Cascada, CoberturaDias, LineaProyeccion, MapaCalor, Pareto, Radar, Sparkline, Treemap,
  type BaseGrafica, type FormaEsqueleto,
} from '../index';
import {
  EJ_ANTIGUEDAD, EJ_BARRAS, EJ_BUMP, EJ_BUMP_PERIODOS, EJ_BURBUJAS, EJ_CALOR, EJ_CALOR_COLUMNAS, EJ_CALOR_FILAS, EJ_CASCADA, EJ_COBERTURA, EJ_GRUPOS_BURBUJA,
  EJ_LINEA, EJ_PARETO, EJ_RADAR, EJ_RADAR_EJES, EJ_SPARK, EJ_TREEMAP, EJ_TREEMAP_GRUPOS, EJ_UMBRALES,
} from '../ejemplos';

export type Extra = Partial<BaseGrafica> & { tablaAbierta?: boolean };

export interface Caso {
  id: string;
  forma: FormaEsqueleto;
  crear: (extra?: Extra) => ReactElement;
  /** Textos que la tabla alterna debe contener (etiquetas y cifras de los datos). */
  esperados: string[];
  /** Cuantas marcas con data-marca tiene la grafica (null = no aplica). */
  marcas: number | null;
  /** Filas de datos de la tabla alterna. */
  filas: number;
}

const base = (titulo: string): BaseGrafica => ({ titulo, descripcion: `Resumen de ${titulo}` });

export const CASOS: Caso[] = [
  {
    id: 'barras', forma: 'barras', marcas: EJ_BARRAS.length, filas: EJ_BARRAS.length,
    esperados: EJ_BARRAS.flatMap((d) => [d.etiqueta, d.texto, d.delta!.texto]),
    crear: (x) => <BarrasDelta {...base('Barras con delta')} datos={EJ_BARRAS} unidad="Piezas" {...x} />,
  },
  {
    id: 'linea', forma: 'linea', marcas: EJ_LINEA.length, filas: EJ_LINEA.length,
    esperados: EJ_LINEA.flatMap((d) => [d.etiqueta, d.texto]),
    crear: (x) => <LineaProyeccion {...base('Linea con proyeccion')} puntos={EJ_LINEA} unidad="Piezas" anotacion={{ id: 's5', texto: 'Mayor caída' }} {...x} />,
  },
  {
    id: 'cascada', forma: 'cascada', marcas: EJ_CASCADA.length, filas: EJ_CASCADA.length,
    esperados: EJ_CASCADA.flatMap((d) => [d.etiqueta, d.texto]),
    crear: (x) => <Cascada {...base('Cascada')} pasos={EJ_CASCADA} unidad="Importe" {...x} />,
  },
  {
    id: 'pareto', forma: 'pareto', marcas: EJ_PARETO.length, filas: EJ_PARETO.length,
    esperados: EJ_PARETO.flatMap((d) => [d.etiqueta, d.texto]),
    crear: (x) => <Pareto {...base('Pareto')} datos={EJ_PARETO} unidad="Utilidad" sustantivo="clientes" {...x} />,
  },
  {
    id: 'calor', forma: 'calor', marcas: EJ_CALOR_FILAS.length * EJ_CALOR_COLUMNAS.length, filas: EJ_CALOR_FILAS.length,
    esperados: [...EJ_CALOR_FILAS, ...EJ_CALOR_COLUMNAS, 'Sin dato', '48', '41'],
    crear: (x) => <MapaCalor {...base('Mapa de calor')} filas={EJ_CALOR_FILAS} columnas={EJ_CALOR_COLUMNAS} celdas={EJ_CALOR} unidad="Piezas" {...x} />,
  },
  {
    id: 'burbujas', forma: 'burbujas', marcas: EJ_BURBUJAS.length, filas: EJ_BURBUJAS.length,
    esperados: EJ_BURBUJAS.flatMap((d) => [d.etiqueta, d.grupo, d.textoX, d.textoY, d.textoTamano]),
    crear: (x) => <Burbujas {...base('Burbujas')} puntos={EJ_BURBUJAS} ejeX="Piezas" ejeY="Margen" ejeTamano="Venta" grupos={EJ_GRUPOS_BURBUJA} umbralX={200} umbralY={20} {...x} />,
  },
  {
    id: 'treemap', forma: 'treemap', marcas: EJ_TREEMAP.length, filas: EJ_TREEMAP.length,
    esperados: EJ_TREEMAP.flatMap((d) => [d.etiqueta, d.texto, d.grupo!]),
    crear: (x) => <Treemap {...base('Treemap')} nodos={EJ_TREEMAP} grupos={EJ_TREEMAP_GRUPOS} unidad="Gasto" {...x} />,
  },
  {
    id: 'radar', forma: 'radar', marcas: EJ_RADAR_EJES.length, filas: EJ_RADAR_EJES.length,
    esperados: [...EJ_RADAR_EJES, ...EJ_RADAR.flatMap((s) => [s.etiqueta, ...s.textos])],
    crear: (x) => <Radar {...base('Radar')} ejes={EJ_RADAR_EJES} series={EJ_RADAR} maximo={70} {...x} />,
  },
  {
    id: 'bump', forma: 'bump', marcas: EJ_BUMP.length, filas: EJ_BUMP.length,
    esperados: [...EJ_BUMP.map((s) => s.etiqueta), ...EJ_BUMP_PERIODOS],
    crear: (x) => <Bump {...base('Bump')} periodos={EJ_BUMP_PERIODOS} series={EJ_BUMP} {...x} />,
  },
  {
    id: 'antiguedad', forma: 'apilada', marcas: EJ_ANTIGUEDAD.length, filas: EJ_ANTIGUEDAD.length,
    esperados: EJ_ANTIGUEDAD.flatMap((f) => [f.etiqueta, f.total, ...f.textos]),
    crear: (x) => <AntiguedadSaldos {...base('Antigüedad de saldos')} filas={EJ_ANTIGUEDAD} {...x} />,
  },
  {
    id: 'cobertura', forma: 'cobertura', marcas: EJ_COBERTURA.length, filas: EJ_COBERTURA.length,
    esperados: [...EJ_COBERTURA.map((f) => f.etiqueta), 'Urge pedir', 'Sobrestock', 'Sin historia (< 28 d)', '6 d', 'Sin dato'],
    crear: (x) => <CoberturaDias {...base('Cobertura en días')} filas={EJ_COBERTURA} umbrales={EJ_UMBRALES} {...x} />,
  },
  {
    id: 'sparkline', forma: 'sparkline', marcas: null, filas: EJ_SPARK.valores.length,
    esperados: [...EJ_SPARK.etiquetas, ...EJ_SPARK.textos],
    crear: () => <Sparkline titulo="Sparkline" descripcion="De 12 a 24 piezas en 8 semanas" etiquetas={EJ_SPARK.etiquetas} valores={EJ_SPARK.valores} textos={EJ_SPARK.textos} />,
  },
];

/** Casos que son un MarcoGrafica (todos menos la sparkline en linea). */
export const CASOS_CON_MARCO = CASOS.filter((c) => c.id !== 'sparkline');
