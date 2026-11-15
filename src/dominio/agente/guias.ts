// Envio y guias en dos tiempos (decision del dueno, 14-nov, punto 6): primero SALEN los pedidos con una paqueteria del catalogo cerrado; la guia llega despues y se agrupa por pedido.
// Este modulo es puro: lee lo que el socio escribio (lista de folios, lista de guias o texto pegado) y EMPAREJA cada guia con un pedido por folio, folio del proveedor o cliente.
// Si hay duda (varios pedidos del mismo cliente, o ninguna pista) NO adivina: devuelve la duda para que el bot pregunte. Nunca calcula dinero.
import { normalizar } from '@/dominio/catalogo/normalizar';

export const PAQUETERIAS_CATALOGO = ['Castores', 'Pitic', 'DHL', 'Estafeta'] as const;

/** Espejo de operacion.paqueteria_nombre (SQL): null si no es del catalogo cerrado. */
export function paqueteriaDeCatalogo(texto: string | null | undefined): (typeof PAQUETERIAS_CATALOGO)[number] | null {
  if (!texto) return null;
  const t = normalizar(texto).replace(/\s+/g, '');
  return PAQUETERIAS_CATALOGO.find((p) => normalizar(p) === t) ?? null;
}

export interface PedidoCandidato {
  folio: string;
  cliente: string;
  folioExterno: string | null;
  paqueteria: string | null;
}

export interface RenglonGuia {
  pedidoFolio: string | null;
  clienteTexto: string | null;
  guia: string;
}

export interface GuiaEmparejada {
  folio: string;
  guia: string;
}

export interface DudaGuia {
  guia: string;
  clienteTexto: string | null;
  /** 'ninguno' = ninguna pista; 'varios' = mas de un pedido posible; 'no_pendiente' = el folio no esta entre los pedidos que esperan guia. */
  motivo: 'ninguno' | 'varios' | 'no_pendiente';
  candidatos: PedidoCandidato[];
}

export interface ResultadoEmparejo {
  emparejadas: GuiaEmparejada[];
  dudas: DudaGuia[];
}

const FOLIO = /^[a-zA-Z]{1,3}-?\d{1,6}$/;

export function normalizarFolio(t: string): string {
  return t.toUpperCase().replace(/^([A-Z]{1,3})-?(\d)/, '$1-$2');
}

export function esFolio(t: string): boolean {
  return FOLIO.test(t.trim());
}

/** Lista de folios escrita libremente: "MG-001, LS-002 y p-0003". Devuelve folios normalizados sin repetir. */
export function parsearFolios(texto: string): string[] {
  const fuera: string[] = [];
  for (const m of texto.matchAll(/\b([a-zA-Z]{1,3})-?(\d{1,6})\b/g)) {
    const f = normalizarFolio(`${m[1]}-${m[2]}`);
    if (!fuera.includes(f)) fuera.push(f);
  }
  return fuera;
}

/**
 * Texto pegado con guias: una por linea (o separadas por ;). Cada linea puede traer un folio, un nombre de cliente y el numero de guia, en cualquier orden:
 * "MG-001 5551234", "5551234 MG-001", "Memo Garcia: 5551234". El numero de guia es el ultimo bloque de 4 o mas caracteres con digitos que no sea un folio.
 */
export function parsearGuiasTexto(texto: string): RenglonGuia[] {
  const lineas = texto.split(/\n|;/).map((l) => l.trim()).filter(Boolean);
  const salida: RenglonGuia[] = [];
  for (const l of lineas) {
    const folio = /\b([a-zA-Z]{1,3})-?(\d{1,6})\b(?=\s|$|[:,.])/.exec(l.replace(/\b\d{4,}\b/g, (x) => ` ${x} `));
    const sinFolio = folio ? l.replace(folio[0], ' ') : l;
    const nums = [...sinFolio.matchAll(/[A-Za-z0-9-]*\d[A-Za-z0-9-]{3,}/g)].map((m) => m[0]);
    const guia = nums.length > 0 ? nums[nums.length - 1]! : null;
    if (guia === null) continue;
    const resto = sinFolio.replace(guia, ' ').replace(/[:,=\-–>]+/g, ' ').replace(/\b(guia|gu[ií]a|numero|número|pedido|de|del|la|el)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    salida.push({ pedidoFolio: folio ? normalizarFolio(`${folio[1]}-${folio[2]}`) : null, clienteTexto: resto.length >= 2 ? resto : null, guia });
  }
  return salida;
}

function clienteCoincide(texto: string, cliente: string): boolean {
  const t = normalizar(texto);
  const c = normalizar(cliente);
  if (t === '' || c === '') return false;
  return c === t || c.includes(t) || t.includes(c) || t.split(' ').every((p) => p.length >= 2 && c.split(' ').some((q) => q.startsWith(p)));
}

/**
 * Empareja cada renglon con un pedido que espera guia. Una guia por pedido: si dos renglones caen en el mismo pedido, el segundo queda en duda.
 * Un renglon sin folio ni cliente solo se empareja si hay UN solo pedido esperando guia y UN solo renglon.
 */
export function emparejarGuias(renglones: readonly RenglonGuia[], pendientes: readonly PedidoCandidato[]): ResultadoEmparejo {
  const emparejadas: GuiaEmparejada[] = [];
  const dudas: DudaGuia[] = [];
  const usados = new Set<string>();
  for (const r of renglones) {
    let cands: PedidoCandidato[] = [];
    let motivo: DudaGuia['motivo'] = 'ninguno';
    const porExterno = r.pedidoFolio === null && r.clienteTexto !== null ? pendientes.filter((p) => p.folioExterno !== null && normalizar(p.folioExterno) === normalizar(r.clienteTexto!)) : [];
    if (porExterno.length > 0) {
      cands = porExterno;
    } else if (r.pedidoFolio !== null) {
      const f = normalizarFolio(r.pedidoFolio);
      cands = pendientes.filter((p) => normalizarFolio(p.folio) === f || (p.folioExterno !== null && normalizar(p.folioExterno) === normalizar(r.pedidoFolio!)));
      if (cands.length === 0) motivo = 'no_pendiente';
    } else if (r.clienteTexto !== null) {
      cands = pendientes.filter((p) => clienteCoincide(r.clienteTexto!, p.cliente) && !usados.has(p.folio));
      motivo = cands.length === 0 ? 'ninguno' : 'varios';
    } else if (renglones.length === 1 && pendientes.length === 1) {
      cands = [...pendientes];
    }
    const libres = cands.filter((p) => !usados.has(p.folio));
    if (libres.length === 1 && (r.pedidoFolio !== null || cands.length === 1 || r.clienteTexto === null)) {
      usados.add(libres[0]!.folio);
      emparejadas.push({ folio: libres[0]!.folio, guia: r.guia });
    } else {
      dudas.push({ guia: r.guia, clienteTexto: r.clienteTexto, motivo: libres.length > 1 ? 'varios' : motivo, candidatos: libres.length > 0 ? libres : r.pedidoFolio === null ? [...pendientes].filter((p) => !usados.has(p.folio)).slice(0, 8) : [] });
    }
  }
  return { emparejadas, dudas };
}

/** Texto de la pregunta cuando hay duda: lista cada guia dudosa con los pedidos posibles. Lo que ya se emparejo se confirma al final, no se vuelve a preguntar. */
export function textoDudasGuias(dudas: readonly DudaGuia[], ya: readonly GuiaEmparejada[]): string {
  const partes: string[] = [];
  if (ya.length > 0) partes.push(`Ya emparejé: ${ya.map((g) => `${g.folio} con la guía ${g.guia}`).join(', ')}.`);
  partes.push('No pude emparejar con seguridad:');
  for (const d of dudas) {
    const quien = d.clienteTexto !== null ? ` (dice «${d.clienteTexto}»)` : '';
    const opciones = d.candidatos.length > 0 ? ` Pedidos posibles: ${d.candidatos.map((c) => `${c.folio} ${c.cliente}`).join('; ')}.` : d.motivo === 'no_pendiente' ? ' Ese pedido no espera guía.' : ' No encuentro un pedido por esa pista.';
    partes.push(`- Guía ${d.guia}${quien}.${opciones}`);
  }
  partes.push('Escríbeme cada una como «FOLIO GUÍA», por ejemplo MG-001 5551234.');
  return partes.join('\n');
}
