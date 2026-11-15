// Deshacer = contramovimiento enlazado. Nunca se edita ni se borra un hecho.
// Dentro de la ventana y sin dependencias es un toque; con dependencias (o fuera de la ventana) se muestran y se pide indicacion expresa.

export const VENTANA_DESHACER_MIN = 10;

export type DecisionDeshacer =
  | { modo: 'un_toque' }
  | { modo: 'indicacion_expresa'; motivo: 'dependencias' | 'fuera_de_ventana' };

export function evaluarDeshacer(entrada: { ejecutadoEn: Date; ahora: Date; dependencias: number }): DecisionDeshacer {
  if (entrada.dependencias > 0) return { modo: 'indicacion_expresa', motivo: 'dependencias' };
  const minutos = (entrada.ahora.getTime() - entrada.ejecutadoEn.getTime()) / 60_000;
  if (minutos < 0 || minutos > VENTANA_DESHACER_MIN) return { modo: 'indicacion_expresa', motivo: 'fuera_de_ventana' };
  return { modo: 'un_toque' };
}

export interface LineaHecho {
  concepto: string;
  piezas: number;
  centavos: bigint;
}

export interface HechoAplicado {
  folio: string;
  tipo: string;
  lineas: LineaHecho[];
  claveIdem: string;
  /** Folio del hecho que este corrige (solo contramovimientos). */
  corrigeFolio: string | null;
}

/** Contramovimiento: mismas lineas con signo contrario y enlace al folio original. Original + contra = cero. */
export function contramovimiento(original: HechoAplicado, folioNuevo: string, claveIdem: string): HechoAplicado {
  if (original.corrigeFolio !== null) throw new RangeError('Un contramovimiento no se deshace: se registra un hecho nuevo.');
  return {
    folio: folioNuevo,
    tipo: `contra_${original.tipo}`,
    claveIdem,
    corrigeFolio: original.folio,
    lineas: original.lineas.map((l) => ({ concepto: l.concepto, piezas: -l.piezas, centavos: -l.centavos })),
  };
}

export function sumaNeta(hechos: readonly HechoAplicado[]): { piezas: number; centavos: bigint } {
  let piezas = 0;
  let centavos = 0n;
  for (const h of hechos) {
    for (const l of h.lineas) {
      piezas += l.piezas;
      centavos += l.centavos;
    }
  }
  return { piezas, centavos };
}

/**
 * El pago a proveedor hecho por un socio con dinero propio (pagado_por angelo o javier, sin cliente) NO se deshace por Telegram: SQL lo guarda sin referencia anulable
 * (agente.hecho sin ref_tipo) y `agente.deshacer` responde que se corrija desde el software. Decision (19-nov): el eco no ofrece el boton y lo dice; la correccion es un
 * movimiento inverso o la pantalla de pagos a proveedor. El pago de la sociedad y el de un cliente directo al proveedor SI tienen reversa directa.
 */
export function seDeshaceEnTelegram(i: { tipo: string; pagado_por?: string; cliente_texto?: string | null }): boolean {
  if (i.tipo !== 'pago_proveedor') return true;
  return i.cliente_texto !== null && i.cliente_texto !== undefined ? true : i.pagado_por === 'sociedad';
}

export const AVISO_SIN_DESHACER = 'Este pago NO se deshace por Telegram: si hay un error, se corrige desde el software con un movimiento inverso.';
