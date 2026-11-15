// Mensaje final de un pedido registrado (decision del dueno, 14-nov): "Pedido registrado en sistema con folio X" con TODOS los datos.
// Las cifras salen de agente.resumen_pedido_registrado (SQL); aqui solo se les da formato. Marcas, modelos y sabores ya vienen en MAYUSCULAS desde SQL.
// Es un mensaje para el grupo de los socios: lleva costos y utilidad, asi que NUNCA se manda al chat de Omar.
import { RegistroCifras } from '@/dominio/agente/cifras';
import { VENTANA_DESHACER_MIN } from '@/dominio/agente/deshacer';
import type { Persona } from '@/dominio/agente/tipos';
import type { MensajeListo } from './plantillas';

export interface ResumenPedidoSql {
  folio: string;
  cliente: string;
  origen: string;
  tipo_venta: string;
  lineas: Array<{ modelo: string; sabor: string; piezas: number; precio_cent: number | string; importe_cent: number | string }>;
  piezas: number;
  subtotal_cent: number | string;
  envio_cent: number | string;
  recargo_cent: number | string;
  descuento_cent: number | string;
  total_cent: number | string;
  plazo_dias: number | null;
  de_contado: boolean | null;
  vence: string | null;
  vence_estimado: boolean | null;
  saldo_pedido_cent: number | string;
  por_cobrar_cliente_cent: number | string;
  por_cobrar_cliente_con_pedido_cent: number | string;
  proveedor: string | null;
  por_pagar_proveedor_cent: number | string | null;
  costo_pedido_estimado_cent: number | string | null;
  por_pagar_proveedor_con_pedido_cent: number | string | null;
  utilidad_estimada_cent: number | string;
  inventario: Array<{ modelo: string; sabor: string; disponible: number; piezas_pedidas: number }> | null;
  avisos: string[];
}

const N = (v: number | string): bigint => BigInt(v);

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

const NOMBRE_PERSONA: Readonly<Record<Persona, string>> = { angelo: 'Angelo', javier: 'Javier', omar: 'Omar' };

/** Todos los numeros salen de `resumen` (SQL) y se registran en el RegistroCifras: el guardia de cifras del comunicador los acepta. */
export function mensajePedidoRegistrado(resumen: ResumenPedidoSql, autor: Persona, avisoFinal?: string): MensajeListo {
  const r = new RegistroCifras();
  const p: string[] = [`Pedido registrado en sistema con folio ${r.folio(resumen.folio)} por ${NOMBRE_PERSONA[autor]}`];
  p.push(`Cliente: ${r.servidor(resumen.cliente)}`);
  p.push('Piezas:');
  for (const l of resumen.lineas) p.push(`- ${r.servidor(l.modelo)} / ${r.servidor(l.sabor)}: ${r.piezas(l.piezas)} x ${r.pesos(N(l.precio_cent))} = ${r.pesos(N(l.importe_cent))}`);
  if (N(resumen.envio_cent) > 0n) p.push(`Envío cobrado: ${r.pesos(N(resumen.envio_cent))}`);
  if (N(resumen.recargo_cent) > 0n) p.push(`Recargo: ${r.pesos(N(resumen.recargo_cent))}`);
  if (N(resumen.descuento_cent) > 0n) p.push(`Descuento: ${r.pesos(N(resumen.descuento_cent))}`);
  p.push(`Total: ${r.pesos(N(resumen.total_cent))}`);
  if (resumen.plazo_dias === null) p.push('Plazo: sin plazo registrado');
  else if (resumen.plazo_dias === 0) p.push('Plazo: de contado');
  else p.push(`Plazo: a crédito, ${r.config(resumen.plazo_dias)} días${resumen.vence ? `; vence el ${r.servidor(fechaCorta(resumen.vence))}${resumen.vence_estimado ? ' (estimado: los días corren desde el envío)' : ''}` : ''}`);
  p.push(`Saldo del pedido: ${r.pesos(N(resumen.saldo_pedido_cent))}`);
  p.push(`Por cobrar al cliente: ${r.pesos(N(resumen.por_cobrar_cliente_cent))}; con este pedido: ${r.pesos(N(resumen.por_cobrar_cliente_con_pedido_cent))}`);
  if (resumen.proveedor !== null && resumen.por_pagar_proveedor_cent !== null && resumen.por_pagar_proveedor_con_pedido_cent !== null) {
    p.push(`Por pagar a ${r.servidor(resumen.proveedor)}: ${r.pesos(N(resumen.por_pagar_proveedor_cent))}; con este pedido queda en ${r.pesos(N(resumen.por_pagar_proveedor_con_pedido_cent))}`);
  }
  p.push(`Utilidad estimada: ${r.pesos(N(resumen.utilidad_estimada_cent))}`);
  if (resumen.inventario !== null) {
    p.push('Inventario disponible:');
    for (const i of resumen.inventario) p.push(`- ${r.servidor(i.modelo)} / ${r.servidor(i.sabor)}: ${r.piezas(i.disponible)}`);
  }
  for (const a of resumen.avisos) p.push(`Aviso: ${r.servidor(a)}`);
  if (avisoFinal) p.push(r.servidor(avisoFinal));
  p.push(`Deshacer disponible por ${r.config(VENTANA_DESHACER_MIN)} minutos.`);
  return { texto: p.join('\n'), registro: r };
}
