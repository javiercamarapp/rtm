// Biblioteca de graficas SVG propias (sin dependencias). Los 12 tipos de la especificacion, la tarjeta de insight y el contador.
// Las dos graficas de F1 (GraficaBarras, GraficaLinea) siguen en sus archivos y se importan de ahi.
export { BarrasDelta, type DatoBarraDelta } from './barras-delta';
export { LineaProyeccion, type PuntoLinea } from './linea-proyeccion';
export { Cascada, type PasoCascadaVista } from './cascada';
export { Pareto, type DatoPareto } from './pareto';
export { MapaCalor, type CeldaCalor } from './mapa-calor';
export { Burbujas, type PuntoBurbuja } from './burbujas';
export { Treemap, type NodoTreemap } from './treemap';
export { Radar, type SerieRadar } from './radar';
export { Bump, type SerieBump } from './bump';
export { Sparkline } from './sparkline';
export { AntiguedadSaldos, type FilaAntiguedad } from './antiguedad-saldos';
export { TRAMOS_ANTIGUEDAD } from './tipos';
export { CoberturaDias, type FilaCobertura, type UmbralCobertura } from './cobertura-dias';
export { palabraCobertura, type EstadoCobertura } from './cobertura';
export { TarjetaInsight, type Severidad } from './tarjeta-insight';
export { Contador } from './contador';
export { MarcoGrafica, EsqueletoGrafica, TablaDeGrafica, type FormaEsqueleto } from './marco';
export { Delta, MarcaProcedencia } from './piezas';
export { textoCifra, type TipoCifra } from './formato';
export type { Procedencia, EstadoGrafica, DeltaTexto, BaseGrafica, TablaAlterna } from './tipos';
