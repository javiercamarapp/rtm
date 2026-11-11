import { formatearPesosCorto } from '../formato';
import type { NotaClienteSnap } from '../operacion/tipos';

/**
 * Texto de WhatsApp de la nota (formato corto de Angelo, por modelo). La base lo guarda al emitir la nota (`operacion.texto_nota`);
 * esta funcion es su ORACULO en pruebas y la vista previa: ambas deben dar exactamente lo mismo.
 */
export function textoNota(n: NotaClienteSnap): string {
  const l: string[] = [`Nota ${n.cliente}`];
  for (const x of n.lineas_texto) l.push(`${x.modelo} ${x.piezas}pz x $${formatearPesosCorto(x.precio_cent)} = ${formatearPesosCorto(x.total_cent)}`);
  if (n.envio_cent > 0n) l.push(`Envío $${formatearPesosCorto(n.envio_cent)}`);
  if (n.recargo_cent > 0n) l.push(`Recargo $${formatearPesosCorto(n.recargo_cent)}`);
  if (n.descuento_cent > 0n) l.push(`Descuento -$${formatearPesosCorto(n.descuento_cent)}`);
  return `${l.join('\n')}\n\ntotal a saldar ${formatearPesosCorto(n.total_cent, true)}`;
}
