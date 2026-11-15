// Capas L2 y L3 del agente: limpieza de la entrada, deteccion de inyeccion y prefiltro sin IA.
import { normalizar } from '../catalogo/normalizar';
import { valoresDeTexto } from './cifras';
import { idsDeSospecha } from './inyeccion';
import type { FuenteMensaje, Persona } from './tipos';

/** Tope TECNICO (el webhook ya rechaza mas de 10,000): un mensaje largo NO se recorta en silencio; el agente lo procesa por partes y avisa. */
export const MAX_CARACTERES = 10_000;

// Controles C0/C1, ancho cero y separadores de linea/parrafo Unicode (se escriben con escapes para no depender del editor).
// eslint-disable-next-line no-control-regex
const CONTROLES = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]', 'g');

/** NFKC, sin caracteres de control ni de ancho cero, espacios colapsados, hasta el tope tecnico de MAX_CARACTERES. */
export function sanitizar(texto: string): string {
  const limpio = texto
    .normalize('NFKC')
    .replace(CONTROLES, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return limpio.slice(0, MAX_CARACTERES);
}

/**
 * Un nombre (de cliente, de modelo) es DATO: se guarda tal cual lo escribe el socio, pero sin controles ni ancho cero y con los < y > neutralizados, de modo que ningun nombre
 * pueda abrir ni cerrar una etiqueta del prompt (<mensaje>, </system>) ni inyectar marcado. Se usa al dar de alta y al ofrecer candidatos al modelo.
 */
export function nombreSeguro(texto: string, max = 60): string {
  return sanitizar(texto).slice(0, MAX_CARACTERES).replace(/</g, '‹').replace(/>/g, '›').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Ids de los patrones de inyeccion que aciertan (ver inyeccion.ts). Un acierto NO bloquea por si solo: marca la sospecha. */
export function detectarInyeccion(texto: string): string[] {
  return idsDeSospecha(texto).filter((id) => id !== 'enlace');
}

const PALABRAS_DE_NEGOCIO = new Set([
  'pago', 'pagos', 'pagou', 'pague', 'gasto', 'gastos', 'compra', 'compre', 'mando', 'manda', 'mandaron', 'pedido', 'pedidos',
  'dame', 'dime', 'cuanto', 'cuantos', 'cuantas', 'saldo', 'stock', 'inventario', 'deshacer', 'deshaz', 'resumen', 'pendientes',
  'aporte', 'aportacion', 'puse', 'toma', 'tome', 'tomo', 'ayuda', 'pideme', 'pidele', 'pide', 'orden', 'anticipo', 'abono',
  'deposito', 'transferencia', 'guia', 'uber', 'envio',
  'utilidad', 'cartera', 'estado', 'reembolso', 'reembolsa', 'retiro', 'retire', 'saque', 'capital', 'devolucion', 'devolvio', 'paquete', 'perdio', 'extravio', 'danado', 'cobro',
  'enviado', 'entregado', 'cancela', 'cancelar', 'recibi', 'recibir', 'recepcion', 'merma', 'conteo', 'cliente', 'precio', 'acta', 'firmar', 'firma', 'cuadra', 'cuadran', 'balance', 'diario',
  'cobertura', 'reporte', 'llego', 'aprobar', 'aprueba', 'servicio', 'openrouter', 'vercel', 'lote', 'historico', 'cuentas', 'socios', 'faltan', 'falta', 'valuacion', 'estamos', 'igualar', 'igualados',
  // Operaciones ampliadas (carril interprete, 14-nov): credito y plazo, dropshipping, paqueterias, renta, obsequio, altas, alias y correcciones.
  'credito', 'contado', 'fiado', 'plazo', 'recargo', 'interes', 'dropshipping', 'envio', 'salieron', 'salio', 'guias', 'paqueteria', 'castores', 'pitic', 'dhl', 'estafeta', 'entregue', 'liquidacion', 'liquide',
  'cobranza', 'paga', 'pagan', 'pagaran', 'pagara', 'pagado', 'pagar', 'atrasa', 'atraso', 'atrasado', 'prometio', 'promete', 'prometieron', 'disputa', 'reclama', 'depositaron', 'liquido', 'silenciar', 'pausa', 'extender', 'extiendele', 'debe', 'adeuda', 'vencido',
  'renta', 'regale', 'obsequio', 'regalo', 'sabor', 'sabores', 'modelo', 'costo', 'alias', 'apodo', 'cancela', 'olvidalo', 'dejalo', 'corrige', 'corrijo', 'perdon', 'equivoque', 'vencimientos', 'vence', 'cobrar',
]);

/**
 * Prefiltro sin IA: ignora stickers, "ok", "gracias" y charla sin cifras. Procesa si hay digitos, signo de pregunta
 * o alguna palabra del negocio. Lo descartado se cuenta (sin contenido) para vigilar que no sea demasiado estricto.
 */
export function debeProcesarConIa(texto: string, opciones: { hayPreguntaPendiente?: boolean } = {}): boolean {
  // Con una pregunta del bot esperando respuesta, un "si", "no" o "a credito" SI es una respuesta: nunca se descarta como charla.
  if (opciones.hayPreguntaPendiente === true && normalizar(texto) !== '') return true;
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
 * El modelo nunca recibe telefonos, correos, domicilios ni usuarios de Telegram (politica de privacidad 19). Se reemplazan antes de armar el prompt;
 * la guardia de cifras sigue comparando contra el mensaje ORIGINAL.
 */
export function redactarContactos(texto: string): string {
  return texto
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[correo oculto]')
    // Telefonos con parentesis y separadores de 1 a 3 caracteres: (999) 123-4567, 999 - 123 - 4567, (999)1234567, +52 999 123 4567. La coma NO es separador (1,250.50 es un monto).
    .replace(/\+?\(?\d(?:[\s().-]{0,3}\d){9,14}\)?/g, (m) => (m.replace(/\D/g, '').length >= 10 && !/\d\.\d{2}\s+\d/.test(m) ? '[telefono oculto]' : m))
    // Domicilios (calle y numero, colonia, codigo postal) y usuarios de Telegram: solo lo estrictamente domiciliario, para no tragarse montos ni piezas de la misma frase.
    .replace(/\b(?:calle|avenida|av\.?|blvd\.?|boulevard|calzada|calz\.?|carretera|privada|priv\.?|andador|prolongacion|periferico)\s+[\wÁÉÍÓÚÑáéíóúñ.]+(?:\s+(?:n[uú]mero|num\.?|no\.?|#)\s*\d+[A-Za-z]?|\s+#\d+[A-Za-z]?)?(?:\s+(?:por|entre)\s+\d+(?:\s+y\s+\d+)?)?/gi, '[domicilio oculto]')
    .replace(/\b(?:colonia|col\.|fraccionamiento|fracc\.?)\s+[A-Za-zÁÉÍÓÚÑáéíóúñ0-9]+/gi, '[domicilio oculto]')
    .replace(/\b(?:c\.?\s?p\.?|codigo postal|código postal)\s*:?\s*\d{5}\b/gi, '[domicilio oculto]')
    .replace(/(^|[\s(])@[A-Za-z][A-Za-z0-9_]{3,31}\b/g, '$1[usuario oculto]');
}

/**
 * Decision del dueno (11 y 13-nov): el dinero que un socio pone o paga es REEMBOLSO; es capital SOLO si el socio lo declara con sus palabras
 * (capital, invertir, reinvertir, meter mas lana). Se evalua sobre el mensaje original, nunca sobre lo que dice el modelo.
 */
export function declaraCapitalExpreso(texto: string): boolean {
  const t = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /\b(capital|inversion|invert\w*|inviert\w*|reinvert\w*|reinviert\w*)\b/.test(t) || /\bmet(?:o|i|er)\s+mas\s+(?:lana|dinero|plata|feria)\b/.test(t);
}
