// Guardia de cifras AMPLIADA (carril interprete). Completa cifras.ts:
//  * cifrasDeIntencionAmpliada: las cifras de dinero y piezas de las intenciones nuevas, para que pasen por la misma procedencia ligada (campo, clase y escala).
//  * foliosSinProcedencia: cada folio que el modelo devuelve debe estar escrito en el mensaje (con otro relleno de ceros vale: P-12 = P-0012).
//  * textosConCifraAjena: ningun numero en un texto libre del modelo (cliente_texto, guia_texto, motivo...) que no este en el mensaje.
//  * montosQueSeRepiten: decision del dueno (14-nov): un monto escrito con k, con mil, con palabras o sin cifra completa NO se registra a la primera: el bot lo repite completo y pregunta.
import { cifrasDeMonto, cifrasDePiezas, valoresDeTexto, type CifraExtraida } from './cifras';
import type { Intencion } from './intenciones';

/** Cifras de las intenciones AMPLIADAS (las demas las cubre cifrasDeIntencion de agente.ts). */
export function cifrasDeIntencionAmpliada(a: Intencion): CifraExtraida[] {
  const salida: CifraExtraida[] = [];
  switch (a.tipo) {
    case 'pedido_ds':
      a.lineas.forEach((l, i) => salida.push(cifrasDePiezas(`lineas.${i}.piezas`, l.piezas)));
      if (a.envio_cobrado_centavos !== null && a.envio_cobrado_centavos > 0) salida.push(cifrasDeMonto('envio', a.envio_cobrado_centavos));
      break;
    case 'obsequio':
      a.lineas.forEach((l, i) => salida.push(cifrasDePiezas(`lineas.${i}.piezas`, l.piezas)));
      break;
    case 'entrega_fondos':
    case 'liquidacion_socios':
    case 'retiro_capital':
    case 'renta_omar':
      salida.push(cifrasDeMonto('monto', a.monto_centavos));
      break;
    case 'modelo_alta':
      if (a.costo_centavos !== null) salida.push(cifrasDeMonto('costo', a.costo_centavos));
      break;
    case 'costo_lista':
      salida.push(cifrasDeMonto('costo', a.costo_centavos));
      break;
    default:
      break;
  }
  return salida;
}

function sinAcentos(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function ceros(n: string): string {
  return n.replace(/^0+(?=\d)/, '');
}

/** "P-0012", "p 12" y "P-12" son el mismo folio: letras y numero sin ceros a la izquierda. */
function claveFolio(f: string): string | null {
  const m = /^\s*([a-z]{1,4})\s*-?\s*(\d{1,8})\s*$/.exec(sinAcentos(f.toLowerCase()));
  return m ? `${m[1]}-${ceros(m[2]!)}` : null;
}

function folioEnTexto(folio: string, fuente: string): boolean {
  const clave = claveFolio(folio);
  const t = sinAcentos(fuente.toLowerCase());
  if (clave === null) return t.includes(sinAcentos(folio.toLowerCase()).trim());
  for (const m of t.matchAll(/\b([a-z]{1,4})\s*-?\s*(\d{1,8})\b/g)) if (`${m[1]}-${ceros(m[2]!)}` === clave) return true;
  return false;
}

function recorrer(valor: unknown, ruta: string, visita: (ruta: string, clave: string, v: unknown) => void): void {
  if (Array.isArray(valor)) {
    valor.forEach((x, i) => recorrer(x, `${ruta}.${i}`, visita));
    return;
  }
  if (valor !== null && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) recorrer(v, ruta === '' ? k : `${ruta}.${k}`, (r, kk, vv) => visita(r, kk, vv));
    return;
  }
  const clave = ruta.split('.').filter((p) => !/^\d+$/.test(p)).pop() ?? ruta;
  visita(ruta, clave, valor);
}

/** Campos de folio (pedido_folio, compra_folio, acta_folio, folio, folios[]) cuyo valor no esta escrito en el mensaje: el modelo no puede inventar ni "completar" un folio. */
export function foliosSinProcedencia(a: Intencion, fuente: string): string[] {
  const sin: string[] = [];
  recorrer(a, '', (ruta, clave, v) => {
    if (typeof v !== 'string') return;
    if (clave === 'folio' || clave === 'folios' || clave.endsWith('_folio')) {
      if (!folioEnTexto(v, fuente)) sin.push(ruta);
    }
  });
  return sin;
}

const NO_REVISAR = new Set(['tipo', 'fuente_cita', 'pregunta']);

/**
 * Los digitos de un texto libre del modelo (nombre de cliente, modelo, guia, motivo...) deben estar tal cual en el mensaje: "Zafiro 5K" copia el 5 del nombre, no es una cantidad.
 * Cierra el hueco de un numero que el modelo cuele dentro de un texto en vez de un campo numerico.
 */
export function textosConCifraAjena(a: Intencion, fuente: string): string[] {
  const plano = sinAcentos(fuente.normalize('NFKC').toLowerCase());
  const sin: string[] = [];
  recorrer(a, '', (ruta, clave, v) => {
    if (typeof v !== 'string' || NO_REVISAR.has(clave) || clave === 'folio' || clave === 'folios' || clave.endsWith('_folio')) return;
    for (const m of v.matchAll(/\d[\d.,]*/g)) {
      const num = m[0].replace(/[.,]+$/, '');
      if (!plano.includes(num)) sin.push(`${ruta}:${num}`);
    }
  });
  return sin;
}

export interface MontoARepetir {
  campo: string;
  centavos: bigint;
  /** Lo que escribio el socio que explica la cifra ("12k", "15 mil", "quince mil"). */
  dicho: string;
}

const APROXIMADORES = /\b(como|aprox\w*|casi|mas o menos|alrededor|unos|unas|cerca de|y medio|y pico|pico|ronda)\b/;

/**
 * Montos que se repiten y se preguntan antes de registrar: los que SOLO se explican con una abreviatura (k, mil, millones), con palabras ("quince mil"), o que el mensaje dijo de forma
 * aproximada ("como 3 mil", "casi 5k", "3 y medio"). Una cifra completa con digitos ("15,000") se registra de una vez. El monto que se muestra lo calcula el servidor, no el modelo.
 */
export function montosQueSeRepiten(fuente: string, extraidas: readonly CifraExtraida[]): MontoARepetir[] {
  const t = sinAcentos(fuente.toLowerCase());
  const aprox = APROXIMADORES.test(t);
  const tokens = [...t.matchAll(/\d[\d.,]*(?:\s*(?:k|mil|millones|millon)\b)?/g)].map((m) => m[0]);
  const salida: MontoARepetir[] = [];
  for (const c of extraidas) {
    if (c.esDinero !== true) continue;
    const explican = tokens.filter((tok) => valoresDeTexto(tok, { paraDinero: true }).has(c.valor));
    const completa = explican.some((tok) => !/(?:k|mil|millones|millon)$/.test(tok.trim()));
    if (explican.length === 0) {
      // Solo se explica con palabras ("quince mil"): abreviada.
      if (valoresDeTexto(t, { paraDinero: true }).has(c.valor)) salida.push({ campo: c.campo, centavos: c.valor, dicho: 'con letra' });
      continue;
    }
    if (!completa) salida.push({ campo: c.campo, centavos: c.valor, dicho: explican[0]!.trim() });
    else if (aprox) salida.push({ campo: c.campo, centavos: c.valor, dicho: explican[0]!.trim() });
  }
  return salida;
}
