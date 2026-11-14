// Reglas del agente de Telegram para detectar, preguntar y unificar sabores. Piezas PURAS (sin red ni base) listas para cablear:
//   * interpretarRespuesta: entiende "si / no / no se" en lenguaje natural, sin modelo de IA (la base nunca depende de lo que "entienda" un LLM).
//   * textos de la pregunta, del aviso al grupo y de deshacer (los avisos de unificacion y negativo salen ya armados de la base: agente.sabor_responder).
//   * REGLAS_PROMPT_SABORES: lo que el extractor debe saber. El modelo SOLO extrae si el socio contesto si o no; no decide ni ejecuta la unificacion.
//   * DEF_INTENCION_SABOR: la fila del catalogo declarativo (hub propio, sin tarjeta, aviso al grupo, reversa directa).
// Lo que FALTA cablear (ver docs/unificar-sabores.md, seccion "Agente de Telegram"): la intencion en intenciones.ts/esquemas.ts, la memoria de "que pregunta espera respuesta" y la llamada a las puertas
// agente.sabor_pregunta / sabor_responder / sabor_deshacer desde src/infra/agente/postgres.ts.
import { normalizar } from '../catalogo/normalizar';
import { textoPregunta } from '../catalogo/duplicados';

export type RespuestaSabor = 'si' | 'no' | 'no_se';

const NO_SE = ['no se', 'no estoy seguro', 'no estoy segura', 'ni idea', 'quien sabe', 'dejalo asi', 'dejalo para despues', 'despues', 'luego lo veo', 'no lo se', 'no tengo idea', 'a lo mejor', 'tal vez', 'quiza', 'quizas', 'depende'];
// Frases con "no" ambiguas ("no son distintos" puede ser "no, son distintos" sin coma): NO se adivinan, quedan en duda.
const SI_CON_NO = ['no es distinto', 'no es diferente', 'no son distintos', 'no son diferentes', 'no hay diferencia', 'no son distintas', 'no son diferentes'];
const NO_FRASES = ['no es lo mismo', 'no son lo mismo', 'no son iguales', 'no es igual', 'son distintos', 'son diferentes', 'son distintas', 'es distinto', 'es diferente', 'distintos', 'diferentes', 'no son el mismo', 'no es el mismo', 'son sabores distintos', 'nel', 'nop', 'jamas', 'para nada', 'negativo'];
const SI_FRASES = ['es lo mismo', 'son lo mismo', 'son iguales', 'es igual', 'es el mismo', 'son el mismo', 'son el mismo sabor', 'lo mismo', 'iguales', 'unelos', 'unelo', 'unalos', 'unirlos', 'unir', 'claro', 'dale', 'afirmativo', 'correcto', 'exacto', 'efectivamente', 'por supuesto', 'si', 'sip', 'simon', 'aja', 'ok', 'va', 'ya', 'asi es'];

const contiene = (t: string, frases: readonly string[]) => frases.some((f) => new RegExp(`(^| )${f}( |$)`).test(t));

/**
 * Interpreta la respuesta de un socio a "¿X es lo mismo que Y?". Ante cualquier duda devuelve 'no_se' (no se unifica ni se descarta): el bot repite la pregunta o la deja pendiente.
 * Una respuesta que mezcla si y no ("si pero no") tampoco se adivina.
 */
export function interpretarRespuesta(texto: string): RespuestaSabor {
  // "No, son distintos": la coma separa el no del resto; si lo que sigue afirma, es contradictorio y queda en duda.
  const conComa = /^\s*no\s*[,.;:!]+\s*(.*)$/is.exec(texto);
  if (conComa) return interpretarRespuesta(conComa[1] ?? '') === 'si' ? 'no_se' : 'no';
  const t = normalizar(texto);
  if (t === '' || t.split(' ').length > 14) return 'no_se';
  if (contiene(t, NO_SE)) return 'no_se';
  // Se quitan las frases que niegan ("no es lo mismo"); lo que queda se revisa por afirmaciones.
  let resto = t;
  let niega = false;
  const quitar = (f: string) => { resto = ` ${resto} `.replace(` ${f} `, ' ').replace(/\s+/g, ' ').trim(); };
  if (contiene(resto, SI_CON_NO)) return 'no_se';
  for (const f of [...NO_FRASES].sort((x, y) => y.length - x.length)) if (contiene(resto, [f])) { niega = true; quitar(f); }
  if (/^no( |$)/.test(resto)) { niega = true; resto = resto.replace(/^no( |$)/, '').trim(); }
  const afirma = contiene(resto, SI_FRASES.filter((f) => f !== 'va' && f !== 'ya'));
  if (niega && afirma) return 'no_se';
  if (niega) return 'no';
  if (afirma) return 'si';
  return 'no_se';
}

/** Texto que el bot manda al grupo para preguntar. La puntuacion y el motivo salen de la base; aqui solo se arma la frase. */
export function textoPreguntaBot(a: string, b: string, ambiguo = false, pendientes = 1): string {
  const extra = pendientes > 1 ? ` (Hay ${pendientes - 1} más por revisar.)` : '';
  return `${textoPregunta(a, b, ambiguo)} Responde sí o no.${extra}`;
}

export const TEXTO_NO_ENTENDI = 'No entendí si es lo mismo o no. Responde sí (es lo mismo) o no (son distintos); lo dejo pendiente.';
export const TEXTO_DESHACER_AYUDA = 'Para deshacer la última unión escribe "deshacer unión".';

/** Reglas para el prompt del extractor (se agregan a SISTEMA_R1 al cablear la intencion; cambian VERSION_PROMPT). */
export const REGLAS_PROMPT_SABORES: readonly string[] = [
  'Sabores duplicados: cuando el bot pregunto "¿X es lo mismo que Y?" y el socio contesta, la intencion es sabor_respuesta con respuesta "si", "no" o "no_se" (si no esta claro).',
  'Eres SOLO el lector: no decides si dos sabores son lo mismo, no unes nada, no propones nombres canonicos ni calculas parecidos. La deteccion y la accion las hace el servidor.',
  'Si el socio dice por si mismo que dos sabores son lo mismo sin que el bot lo haya preguntado, intencion "aclarar": el servidor decide que pregunta hacer.',
  'Nunca asumas equivalencias (razz = raspberry, coco = coconut, abreviaturas): copia los nombres tal como aparecen.',
];

/** Fila del catalogo declarativo (src/dominio/agente/catalogo_intenciones.ts) cuando se cablee la intencion. Sin tarjeta: avisa al grupo y se deshace con "deshacer union". */
export const DEF_INTENCION_SABOR = {
  descripcion: 'Respuesta si/no de un socio a la pregunta de dos sabores que podrian ser lo mismo (si = unifica con el canonico por omision; no = guarda el negativo)',
  hub: 'ninguno',
  puertas: ['agente.sabor_pregunta', 'agente.sabor_responder', 'agente.sabor_deshacer'],
  funcionesSql: ['catalogo.responder_duplicado', 'catalogo.unificar_sabor', 'catalogo.deshacer_unificacion_sabor'],
  confirmacion: 'ninguna',
  quien: 'socios',
  reversa: 'directa',
  estado: 'contrato',
} as const;
