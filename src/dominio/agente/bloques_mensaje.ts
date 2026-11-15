// Mensajes muy largos (lotes de decenas de renglones): se dividen POR LINEAS en bloques, cada uno con su propia llamada al modelo, para que ninguna linea se pierda ni se recorte.
// Decision del dueno (14-nov): sin topes ocultos y siempre un aviso final "recibi N lineas: registre N, pregunte M, no entendi K". Piezas PURAS; el cableado a agente.ts lo hace el carril de flujo.

export interface Bloque {
  /** Numero de linea (1) del primer renglon del bloque dentro del mensaje original. */
  desde: number;
  lineas: string[];
  texto: string;
}

/** Cuantas lineas con contenido lleva un mensaje. */
export function contarLineas(texto: string): number {
  return texto.split('\n').filter((l) => l.trim() !== '').length;
}

/**
 * Divide en bloques de hasta `maxLineas` lineas con contenido y `maxCaracteres`. La primera linea (el encabezado: "pedidos de hoy:", "guias Estafeta:") se repite al inicio de cada bloque
 * para que el contexto no se pierda. Un mensaje que cabe en un solo bloque se devuelve tal cual.
 */
export function dividirEnBloques(texto: string, opciones: { maxLineas?: number; maxCaracteres?: number } = {}): Bloque[] {
  const maxLineas = opciones.maxLineas ?? 40;
  const maxCaracteres = opciones.maxCaracteres ?? 3500;
  const lineas = texto.split('\n').filter((l) => l.trim() !== '');
  if (lineas.length <= maxLineas && texto.length <= maxCaracteres) return [{ desde: 1, lineas, texto }];
  const encabezado = /:\s*$/.test(lineas[0] ?? '') ? lineas[0]! : null;
  const cuerpo = encabezado === null ? lineas : lineas.slice(1);
  const base = encabezado === null ? 0 : 1;
  const bloques: Bloque[] = [];
  let actual: string[] = [];
  let desde = base + 1;
  const volcar = () => {
    if (actual.length === 0) return;
    const ls = encabezado === null ? actual : [encabezado, ...actual];
    bloques.push({ desde, lineas: ls, texto: ls.join('\n') });
    desde += actual.length;
    actual = [];
  };
  for (const l of cuerpo) {
    const prueba = [...(encabezado === null ? [] : [encabezado]), ...actual, l].join('\n');
    if (actual.length >= maxLineas - (encabezado === null ? 0 : 1) || (actual.length > 0 && prueba.length > maxCaracteres)) volcar();
    actual.push(l);
  }
  volcar();
  return bloques;
}

export interface ResumenLote {
  lineasRecibidas: number;
  registradas: number;
  preguntadas: number;
  noEntendidas: number;
}

/** Aviso final obligatorio de un lote: nunca se pierde una linea sin decirlo. Todas las cifras las cuenta el codigo. */
export function resumenDeLote(r: ResumenLote): string {
  const sin = Math.max(0, r.lineasRecibidas - r.registradas - r.preguntadas - r.noEntendidas);
  const resto = sin > 0 ? `, sin respuesta ${sin}` : '';
  return `Recibi ${r.lineasRecibidas} lineas: registre ${r.registradas}, pregunte ${r.preguntadas}, no entendi ${r.noEntendidas}${resto}.`;
}
