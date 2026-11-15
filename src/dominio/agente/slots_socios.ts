// Operaciones de conversacion del carril SOCIOS Y GASTOS (16-nov): retiro de capital, renta de Omar y cargo de servicio con tipo de cambio.
// Mismo contrato que slots.ts: el bot PREGUNTA todo lo que falte (sin topes y sin tarjeta) y solo escribe con todos los datos. Espejo SQL: agente.operacion_slot (migracion 20261116400000).
// Nada aqui calcula dinero.
import type { DefOperacion, OpcionSlot } from './slots';

const SOCIOS: readonly OpcionSlot[] = [{ valor: 'angelo', texto: 'Angelo' }, { valor: 'javier', texto: 'Javier' }];
const VIA: readonly OpcionSlot[] = [{ valor: 'transferencia', texto: 'Transferencia' }, { valor: 'efectivo', texto: 'Efectivo' }];
const MONTO = '¿De cuánto fue? Escribe la cifra completa, por ejemplo 12,500.';

export const OPERACIONES_SOCIOS_CONV = ['retiro_capital', 'renta_omar', 'gasto_servicio'] as const;
export type OperacionSocios = (typeof OPERACIONES_SOCIOS_CONV)[number];

export const OPERACIONES_SOCIOS: Readonly<Record<OperacionSocios, DefOperacion>> = {
  retiro_capital: {
    clave: 'retiro_capital' as never, titulo: 'Retiro de capital',
    slots: [
      { clave: 'socio', tipo: 'opcion', obligatorio: true, pregunta: '¿Quién retira capital, Angelo o Javier?', opciones: SOCIOS, sinonimos: ['socio'] },
      { clave: 'monto', tipo: 'monto', obligatorio: true, pregunta: MONTO, sinonimos: ['monto', 'importe', 'total'] },
    ],
    avisoFinal: 'El retiro de capital lo acuerdan los dos: lo propone quien retira y lo confirma el otro socio con su propio mensaje (el mismo retiro, mismo monto). No se deshace: se corrige con un movimiento inverso.',
  },
  renta_omar: {
    clave: 'renta_omar' as never, titulo: 'Pago de la renta de Omar',
    slots: [
      { clave: 'monto', tipo: 'monto', obligatorio: true, pregunta: MONTO, sinonimos: ['monto', 'importe', 'total'] },
      { clave: 'pagado_por', tipo: 'opcion', obligatorio: true, pregunta: '¿Quién pagó la renta de Omar, Angelo o Javier?', opciones: SOCIOS, sinonimos: ['pagado por', 'quien pago'] },
      { clave: 'via', tipo: 'opcion', obligatorio: true, pregunta: '¿Fue por transferencia o en efectivo?', opciones: VIA, sinonimos: ['via', 'forma de pago'] },
    ],
  },
  gasto_servicio: {
    clave: 'gasto_servicio' as never, titulo: 'Cargo de un servicio',
    slots: [
      { clave: 'servicio', tipo: 'texto', obligatorio: true, pregunta: '¿Qué servicio es? Por ejemplo OpenRouter, Vercel o Supabase.', sinonimos: ['servicio'] },
      { clave: 'moneda', tipo: 'opcion', obligatorio: true, pregunta: '¿Te lo cobraron en dólares o en pesos?', opciones: [{ valor: 'usd', texto: 'Dólares' }, { valor: 'mxn', texto: 'Pesos' }], sinonimos: ['moneda'] },
      { clave: 'monto', tipo: 'monto', obligatorio: true, pregunta: '¿De cuánto fue el cargo? Escribe la cifra completa, por ejemplo 20.00.', sinonimos: ['monto', 'importe', 'total'] },
      { clave: 'pagado_por', tipo: 'opcion', obligatorio: true, pregunta: '¿Quién lo pagó, Angelo o Javier?', opciones: SOCIOS, sinonimos: ['pagado por', 'quien pago'] },
      { clave: 'tipo_cambio', tipo: 'texto', obligatorio: true, si: { slot: 'moneda', valores: ['usd'] }, pregunta: '¿A qué tipo de cambio te lo cobraron? Escribe el número, por ejemplo 18.50.', sinonimos: ['tipo de cambio', 'tc'] },
    ],
  },
};
