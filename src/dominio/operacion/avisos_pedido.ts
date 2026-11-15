import type { AvisoVigente } from './tipos';

/** Renglones y modelos de un aviso agrupado: "3 renglones · Modelo A, Modelo B". Un aviso del pedido completo (sin renglones) no lleva conteo. */
export function textoRenglones(a: Pick<AvisoVigente, 'renglones' | 'modelos'>): string | null {
  if (a.renglones <= 0) return null;
  const n = `${a.renglones} ${a.renglones === 1 ? 'renglón' : 'renglones'}`;
  return a.modelos.length > 0 ? `${n} · ${a.modelos.join(', ')}` : n;
}

/** "Aceptado por X" solo cuando una persona aceptó todos los avisos del grupo; si aceptó solo una parte lo dice; si nadie, avisa que no bloquea. */
export function textoAceptacion(a: Pick<AvisoVigente, 'avisos' | 'aceptados' | 'decidido_por'>): string {
  const quien = a.decidido_por.join(' y ');
  if (a.aceptados > 0 && a.aceptados >= a.avisos) return `Aceptado por ${quien}`;
  if (a.aceptados > 0) return `Aceptado por ${quien} en ${a.aceptados} de ${a.avisos}; el resto se acepta con “Enviar de todos modos”.`;
  return 'No bloquea: se acepta con “Enviar de todos modos”.';
}
