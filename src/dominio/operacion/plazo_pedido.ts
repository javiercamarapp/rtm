// Plazo obligatorio de un pedido (decision del dueno, 14-nov): todo pedido a credito lleva plazo en dias; de contado = 0. La base lo vuelve a exigir (P0436).
export type CondicionPago = '' | 'contado' | 'credito';

export const MENSAJE_PLAZO_FALTA = 'Indica la condición de pago: de contado, o a crédito con el plazo en días. Sin plazo no se crea el pedido.';
export const MENSAJE_PLAZO_DIAS = 'El plazo a crédito debe ser un número entero de días entre 1 y 365.';

export type ResultadoPlazo = { ok: true; plazo_dias: number } | { ok: false; mensaje: string };

export function plazoDeFormulario(condicion: CondicionPago, dias: string): ResultadoPlazo {
  if (condicion === '') return { ok: false, mensaje: MENSAJE_PLAZO_FALTA };
  if (condicion === 'contado') return { ok: true, plazo_dias: 0 };
  const t = dias.trim();
  if (!/^\d{1,3}$/.test(t)) return { ok: false, mensaje: MENSAJE_PLAZO_DIAS };
  const n = Number(t);
  if (n < 1 || n > 365) return { ok: false, mensaje: MENSAJE_PLAZO_DIAS };
  return { ok: true, plazo_dias: n };
}
