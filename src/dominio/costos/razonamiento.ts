// Razonamiento de cada servicio de Costos del sistema: por que se atribuye a RTM, como se calcula y a donde llega el dinero.
// Solo texto: ninguna cifra se calcula aqui (los montos salen de la base).
import type { CuotaBaseVista } from './vista';
import { textoMicro } from './entrada';

export interface Razonamiento {
  /** Por que se atribuye a RTM. */
  porQue: string;
  /** Como se calcula el monto del mes. */
  comoSeCalcula: string;
}

export const DESTINO_DEL_DINERO = 'Lo paga Javier con su tarjeta y el servicio no cobra a la sociedad. Cada cargo se registra con fecha como aportación de capital de Javier (declarada por él): sube su valuación y el capital contable, sin mover la caja.';

const R: Readonly<Record<string, Razonamiento>> = {
  openrouter: { porQue: 'RTM llama modelos de IA por OpenRouter con su propia llave.', comoSeCalcula: 'Consumo real de RTM medido en el libro de llamadas del mes (gasto, no el saldo de la cuenta); sin libro, solo lo que el dueño declare.' },
  openrouter_comision: { porQue: 'OpenRouter cobra una comisión al recargar saldo.', comoSeCalcula: 'Porcentaje vigente de comisión sobre el consumo de RTM del mes.' },
  vercel: { porQue: 'El sitio de RTM se aloja en un equipo de Vercel compartido con otros proyectos.', comoSeCalcula: 'Se cobra lo MAYOR entre la cuota base (editable, es el piso) y el consumo real de RTM; hoy vale 0 (plan equivalente, sin consumo declarado).' },
  supabase: { porQue: 'La base de RTM corre en una organización de Supabase compartida.', comoSeCalcula: 'Se cobra lo MAYOR entre la cuota base (editable, es el piso) y el consumo real de RTM (horas de cómputo); hoy vale 0 hasta que haya cargo real.' },
  transcripcion: { porQue: 'La transcripción de audios del bot es 100 % de RTM.', comoSeCalcula: 'Llamadas de rol audio del libro propio; hoy 0 hasta que haya cargo real.' },
  resend: { porQue: 'Correos de reportes de RTM.', comoSeCalcula: 'Plan gratuito: 0 hasta que haya cargo real.' },
  dominio: { porQue: 'El dominio se compró y se administra en Vercel.', comoSeCalcula: 'Devengo de un doceavo del costo anual cada mes; vale 0 hasta que Javier dé el costo anual.' },
  telegram: { porQue: 'El bot de Telegram es el canal de los socios.', comoSeCalcula: 'La interfaz de bots no tiene cobro: 0.' },
  github: { porQue: 'El repositorio privado de RTM está en GitHub.', comoSeCalcula: 'Sin costo: 0 hasta que haya cargo real.' },
  higgsfield: { porQue: 'Generaciones de imagen y video etiquetadas RTM.', comoSeCalcula: 'Valor del crédito de lo etiquetado RTM; hoy 0 hasta que haya cargo real.' },
  claude_max: { porQue: 'Claude Max se usa para construir RTM (fase de construcción, opcional).', comoSeCalcula: 'Monto fijo declarado por Javier: 20 USD al mes (no los 200 USD del plan).' },
};

export function razonamientoDe(slug: string): Razonamiento {
  return R[slug] ?? { porQue: 'Servicio atribuido a RTM.', comoSeCalcula: 'Según el método registrado del servicio.' };
}

/** "Se cobra lo MAYOR entre la cuota base de USD 20.00 y el consumo real (vigente desde 2026-11-01)". null si el servicio no tiene cuota base. */
export function textoCuotaBase(c: CuotaBaseVista | null | undefined): string | null {
  if (!c) return null;
  return `Se cobra lo ${c.regla.toUpperCase()} entre la cuota base de USD ${textoMicro(BigInt(c.cuota_orig_micro))} y el consumo real (vigente desde ${c.vigente_desde}).`;
}
