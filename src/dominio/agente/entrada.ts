// Capas L2 y L3 del agente: limpieza de la entrada, deteccion de inyeccion y prefiltro sin IA.
import { normalizar } from '../catalogo/normalizar';
import { valoresDeTexto } from './cifras';
import type { FuenteMensaje, Persona } from './tipos';

export const MAX_CARACTERES = 2000;

// Controles C0/C1, ancho cero y separadores de linea/parrafo Unicode (se escriben con escapes para no depender del editor).
// eslint-disable-next-line no-control-regex
const CONTROLES = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]', 'g');

/** NFKC, sin caracteres de control ni de ancho cero, espacios colapsados, maximo 2,000 caracteres. */
export function sanitizar(texto: string): string {
  const limpio = texto
    .normalize('NFKC')
    .replace(CONTROLES, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return limpio.slice(0, MAX_CARACTERES);
}

const PATRONES_INYECCION: ReadonlyArray<readonly [string, RegExp]> = [
  ['ignora_instrucciones', /\b(ignora|olvida|descarta)\b.{0,30}\b(instrucciones|reglas|indicaciones|prompt)\b/],
  ['ignore_previous', /\bignore\b.{0,30}\b(previous|prior|above|all)\b.{0,20}\b(instructions|rules|prompt)\b/],
  ['revelar_prompt', /\b(revela|muestra|imprime|dime|reveal|show|print)\b.{0,30}\b(prompt|instrucciones del sistema|system prompt|tus reglas)\b/],
  ['etiqueta_system', /<\s*\/?\s*(system|sistema|assistant|instructions)\s*>/],
  ['modo_desarrollador', /\b(modo desarrollador|developer mode|jailbreak|modo dios|dan mode)\b/],
  ['borrar_todo', /\b(borra|elimina|anula|cancela)\b.{0,15}\b(todo|todos|todas)\b/],
  ['marcar_pagado', /\bmarca\b.{0,20}\bcomo (pagado|pagada|liquidado|liquidada)\b/],
  ['cambiar_precio', /\bcambia\b.{0,20}\bel precio de\b/],
  ['actua_como', /\b(act[uú]a|compórtate|comportate|you are now|ahora eres)\b.{0,20}\b(como|as|un|una)\b/],
];

/** Ids de los patrones de inyeccion que aciertan. Un acierto NO bloquea por si solo: marca la sospecha. */
export function detectarInyeccion(texto: string): string[] {
  const t = texto.normalize('NFKC').toLowerCase();
  const sinAcentos = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return PATRONES_INYECCION.filter(([, re]) => re.test(t) || re.test(sinAcentos)).map(([id]) => id);
}

const PALABRAS_DE_NEGOCIO = new Set([
  'pago', 'pagos', 'pagou', 'pague', 'gasto', 'gastos', 'compra', 'compre', 'mando', 'manda', 'mandaron', 'pedido', 'pedidos',
  'dame', 'dime', 'cuanto', 'cuantos', 'cuantas', 'saldo', 'stock', 'inventario', 'deshacer', 'deshaz', 'resumen', 'pendientes',
  'aporte', 'aportacion', 'puse', 'toma', 'tome', 'tomo', 'ayuda', 'pideme', 'pidele', 'pide', 'orden', 'anticipo', 'abono',
  'deposito', 'transferencia', 'guia', 'uber', 'envio',
]);

/**
 * Prefiltro sin IA: ignora stickers, "ok", "gracias" y charla sin cifras. Procesa si hay digitos, signo de pregunta
 * o alguna palabra del negocio. Lo descartado se cuenta (sin contenido) para vigilar que no sea demasiado estricto.
 */
export function debeProcesarConIa(texto: string): boolean {
  if (/\d/.test(texto) || /[?¿]/.test(texto) || valoresDeTexto(texto).size > 0) return true;
  return normalizar(texto)
    .split(' ')
    .some((p) => PALABRAS_DE_NEGOCIO.has(p));
}

/** Delimita el texto del usuario como DATO, con su procedencia; los < y > internos se neutralizan. */
export function envolverMensaje(autor: Persona, fuente: FuenteMensaje, texto: string): string {
  const neutro = texto.replace(/</g, '‹').replace(/>/g, '›');
  return `<mensaje autor="${autor}" fuente="${fuente}">${neutro}</mensaje>`;
}

/**
 * El modelo nunca recibe telefonos ni correos (politica de privacidad 19). Se reemplazan antes de armar el prompt;
 * la guardia de cifras sigue comparando contra el mensaje ORIGINAL.
 */
export function redactarContactos(texto: string): string {
  return texto
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[correo oculto]')
    .replace(/\+?\d(?:[\s.-]?\d){9,14}/g, (m) => (m.replace(/\D/g, '').length >= 10 ? '[telefono oculto]' : m));
}
