// Reglas de la evidencia de pago (espejo de las de la base, que manda): imagen PNG o JPEG, o PDF, de 1 byte a 2 MB. Sin I/O.
export const EVIDENCIA_MAX_BYTES = 2 * 1024 * 1024;
export const EVIDENCIA_TIPOS = ['image/png', 'image/jpeg', 'application/pdf'] as const;

export function validarEvidencia(tipo: string, tamBytes: number): string | null {
  if (!(EVIDENCIA_TIPOS as readonly string[]).includes(tipo)) return 'La evidencia debe ser imagen PNG o JPEG, o PDF.';
  if (!Number.isFinite(tamBytes) || tamBytes < 1) return 'El archivo está vacío.';
  if (tamBytes > EVIDENCIA_MAX_BYTES) return 'La evidencia pesa más de 2 MB.';
  return null;
}

export type EstadoPago = 'pagado' | 'no_pagado' | 'pago_reportado' | 'por_confirmar';
export const TEXTO_ESTADO_PAGO: Record<EstadoPago, string> = { pagado: 'Pagado', no_pagado: 'Pendiente de pago', pago_reportado: 'Pago reportado', por_confirmar: 'Por confirmar' };

/**
 * Politica de confirmacion (espejo de operacion.ds_reportar_pago_menudeo): con evidencia, o si lo registra el OTRO socio, se aplica de inmediato;
 * si no, queda "Pago reportado" y el pedido sigue pendiente hasta que el otro socio confirme.
 */
export function seAplicaDeInmediato(conEvidencia: boolean, quienReporta: string, duenioDelPedido: string): boolean {
  return conEvidencia || quienReporta !== duenioDelPedido;
}

/** Un pago solo deja el pedido pagado cuando el total cubre el costo; el saldo nunca es negativo. */
export function pendienteTras(costoCent: bigint, aplicadoCent: bigint): bigint {
  const p = costoCent - aplicadoCent;
  return p > 0n ? p : 0n;
}
