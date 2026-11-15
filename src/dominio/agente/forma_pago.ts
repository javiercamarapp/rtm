// Forma de pago de un pedido a un cliente, DERIVADA por el codigo (decision del dueno: todo credito exige plazo; de contado = 0 dias).
// El modelo copia la frase del plazo y, si el socio lo dijo, marca contado o credito; lo que el mensaje implica ("a 8 dias" es credito) lo decide el codigo con plazo_pedido.ts.
import { interpretarPlazo } from './plazo_pedido';

export type FormaPagoEfectiva = 'contado' | 'credito' | null;

/** null = no se sabe o se contradice: el bot pregunta "es de contado o a credito?" y, si es credito, el plazo. */
export function formaPagoEfectiva(a: { forma_pago: 'contado' | 'credito' | null; plazo_texto: string | null }, ahora: Date): FormaPagoEfectiva {
  const p = a.plazo_texto === null ? null : interpretarPlazo(a.plazo_texto, ahora);
  const porPlazo: FormaPagoEfectiva = p === null || p.tipo !== 'ok' ? null : p.dias === 0 ? 'contado' : 'credito';
  if (a.forma_pago === null) return porPlazo;
  if (porPlazo !== null && porPlazo !== a.forma_pago) return null; // "de contado, a 15 dias": se contradice, se pregunta
  return a.forma_pago;
}
