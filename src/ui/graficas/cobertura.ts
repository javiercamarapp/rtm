// Palabras y niveles de los estados de cobertura. Archivo sin 'use client' para poder importarlo desde componentes de servidor.
/** Estados de la cobertura en dias (cifra S01 del servidor; ver docs de paridad 3.5). La grafica solo los pinta: nunca los calcula. */
export type EstadoCobertura = 'urge' | 'brevedad' | 'siguiente' | 'buena' | 'excelente' | 'sobrestock' | 'sin_movimiento' | 'sin_historia';

export const ESTADOS_COBERTURA: Record<EstadoCobertura, { palabra: string; nivel: number }> = {
  urge: { palabra: 'Urge pedir', nivel: 1 },
  brevedad: { palabra: 'Pedir a la brevedad', nivel: 2 },
  siguiente: { palabra: 'Pedir siguiente pedido', nivel: 3 },
  buena: { palabra: 'Buena cantidad', nivel: 4 },
  excelente: { palabra: 'Excelente', nivel: 5 },
  sobrestock: { palabra: 'Sobrestock', nivel: 5 },
  sin_movimiento: { palabra: 'Sin movimiento', nivel: 0 },
  sin_historia: { palabra: 'Sin historia (< 28 d)', nivel: 0 },
};

export function palabraCobertura(e: EstadoCobertura): string {
  return ESTADOS_COBERTURA[e].palabra;
}

