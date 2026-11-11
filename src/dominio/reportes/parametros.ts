// Parametros del motor de reportes. Viven en `config` con vigencia (spec 16, 4.1) y se imprimen en el anexo.
// Los umbrales [CAL] se recalibran con 8 a 12 semanas de datos reales.

export const PARAMETROS = {
  vigenteDesde: '2026-11-10',
  /** Renta de bodega por pieza surtida desde la bodega (centavos). */
  rentaBodegaCentPorPz: 200n,
  /** Promedio movil exponencial. */
  alfaEma: 0.3,
  ventanaEma: 8,
  minSemanasEma: 6,
  minErroresRango: 5,
  maxErroresRango: 8,
  /** Cuantil normal al 80 % (dos colas). */
  z80: 1.28,
  tendencia: { minSemanas: 8, maxSemanas: 13, tMinimo: 2, horizonteMax: 4 },
  estacionalidad: { minMesesDescriptiva: 12, minMesesAplicada: 24 },
  reorden: { minSemanasModelo: 4, minSemanasConVenta: 3, minPiezas: 40, minReposicionesLT: 3, z: 1.28, revisionDias: 7 },
  proximoPedido: { minPedidos: 4 },
  flujo: { minSemanasCobros: 8, semanas: 4 },
  finMesOmar: { minDias: 14, renta: 200n },
  escenarios: { deltasCostoCent: [500n, 1000n, 2000n], mezclaPuntosPct: 10, retrasoCobroDias: 14, semanasConcentracion: 4, minSemanasConcentracion: 13 },
  /** Banderas de cobertura en dias. */
  cobertura: { minimo: 7, maximo: 56, objetivoBajo: 7, objetivoAlto: 28 },
  carteraBuckets: [
    { id: 'b0_7', etiqueta: '0-7 d', desde: 0, hasta: 7 },
    { id: 'b8_14', etiqueta: '8-14 d', desde: 8, hasta: 14 },
    { id: 'b15_30', etiqueta: '15-30 d', desde: 15, hasta: 30 },
    { id: 'b31_60', etiqueta: '31-60 d', desde: 31, hasta: 60 },
    { id: 'b60_mas', etiqueta: 'más de 60 d', desde: 61, hasta: 100_000 },
  ],
  /** Comprobaciones que impiden emitir el PDF (spec 14 sec. 12 y 16 sec. 8). */
  bloqueantes: ['C3', 'C4', 'C5', 'C10', 'C11', 'C12'],
  /** Comprobaciones que bloquean el reporte de Omar. */
  bloqueantesOmar: ['C8', 'C9'],
  maxRenglonesTabla: 8,
  maxCaracteresTelegram: 900,
  maxPalabrasTitular: 22,
  /** Umbral de salida de PRELIMINAR: cobertura de L1 verde desde este valor (milesimas). */
  coberturaViernesVerde: 1200n,
} as const;
