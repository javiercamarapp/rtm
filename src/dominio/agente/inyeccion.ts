// Defensa contra inyeccion de instrucciones (cierre del hallazgo MEDIO del workflow del bot, 14-nov). Codigo puro, sin IA.
// Decision del dueno: SIN tarjetas y SIN topes de monto. La defensa es de estructura:
//   1. El texto del usuario SIEMPRE viaja al modelo como DATO delimitado (entrada.envolverMensaje) y con las oraciones sospechosas OMITIDAS (este modulo).
//   2. El modelo solo puede devolver el esquema cerrado (zod strict + json_schema); lo que no esta en el esquema se rechaza.
//   3. Si el mensaje trae texto tipo instruccion (patrones de abajo) o el modelo lo reporta (`texto_sospechoso`), el agente NO escribe: PREGUNTA.
//   4. El rol (quien opera) y el cliente salen de la identidad de Telegram y del catalogo, jamas del texto; las cifras de dinero salen de SQL y se comparan con las del socio.
// Un acierto de patron NO prueba maldad: marca el mensaje y frena la ESCRITURA; las consultas de solo lectura siguen.

export type CategoriaSospecha = 'instruccion' | 'rol' | 'herramienta' | 'codigo' | 'enlace';

export interface Hallazgo {
  id: string;
  categoria: CategoriaSospecha;
  /** Fragmento literal que acerto (maximo 100 caracteres). */
  fragmento: string;
}

export interface AnalisisTexto {
  hallazgos: Hallazgo[];
  /** Fragmentos sospechosos, sin repetir (el campo `texto_sospechoso` del analisis). */
  textoSospechoso: string[];
  /** El texto como lo ve el modelo: las oraciones con instrucciones, herramientas, roles o codigo y los enlaces se reemplazan por un marcador. */
  neutralizado: string;
  /** true si hay algo distinto de un simple enlace: el agente no escribe y pregunta. */
  bloqueaEscritura: boolean;
}

export const MARCADOR_OMITIDO = '[texto sospechoso omitido]';
export const MARCADOR_ENLACE = '[enlace oculto]';
export const MARCADOR_CODIGO = '[bloque de codigo omitido]';

// Controles C0/C1, ancho cero y separadores Unicode: se quitan ANTES de buscar para que "i", ancho cero, "gnora" no esquive el patron.
// eslint-disable-next-line no-control-regex
const CONTROLES = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]', 'g');

/** Minusculas, NFKC, sin acentos ni controles; conserva la longitud 1 a 1 en el caso comun para ubicar fragmentos. */
function llave(texto: string): string {
  return texto.normalize('NFKC').replace(CONTROLES, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

interface Patron {
  id: string;
  categoria: CategoriaSospecha;
  re: RegExp;
}

// Sobre la "llave" (minusculas, sin acentos). Los .{0,N} son cortos a proposito: no se come el resto del mensaje de negocio.
const PATRONES: readonly Patron[] = [
  // --- instruccion dirigida al modelo
  { id: 'ignora_instrucciones', categoria: 'instruccion', re: /\b(ignora|ignore|olvida|forget|descarta|disregard|omite|desobedece|anula)\b.{0,40}\b(instrucciones|reglas|indicaciones|prompt|restricciones|politicas)\b/ },
  { id: 'ignora_lo_anterior', categoria: 'instruccion', re: /\b(ignora|olvida|descarta|omite|anula)\b.{0,25}\b(lo anterior|lo de arriba|mensajes anteriores|todo lo previo)\b/ },
  { id: 'ignore_previous', categoria: 'instruccion', re: /\b(ignore|forget|disregard)\b.{0,30}\b(previous|prior|above|all|everything)\b/ },
  { id: 'nuevas_instrucciones', categoria: 'instruccion', re: /\b(nuevas?|actualizadas?|verdaderas?|reales) (instrucciones|reglas|ordenes)\b|\bnew instructions\b/ },
  { id: 'a_partir_de_ahora', categoria: 'instruccion', re: /\ba partir de (ahora|este momento)\b.{0,40}\b(debes|eres|registra|ignora|responde|haz|obedece|siempre)\b|\bfrom now on\b.{0,30}\b(you|ignore|always)\b/ },
  { id: 'revelar_prompt', categoria: 'instruccion', re: /\b(revela|muestra|imprime|dime|repite|reveal|show|print|repeat)\b.{0,30}\b(prompt|instrucciones del sistema|system prompt|tus reglas|tus instrucciones|your instructions)\b/ },
  { id: 'dirigida_al_bot', categoria: 'instruccion', re: /\b(bot|asistente|agente|modelo|ia|claude|gpt|chatgpt|assistant)\b[ ,:;]+(ignora|olvida|registra|ejecuta|obedece|haz|responde|marca|cambia|borra|aprueba|autoriza)\b/ },
  { id: 'obedece', categoria: 'instruccion', re: /\b(obedece|cumple|sigue)\b.{0,12}\b(estas|esas|las|los|las siguientes|mis|esta|la) (ordenes|instrucciones|orden)\b/ },
  { id: 'saltar_controles', categoria: 'instruccion', re: /\b(salta|saltate|omite|evita|desactiva|apaga|quita|bypass)\b.{0,20}\b(confirmacion|verificacion|validacion|frenos?|filtros?|guardias?|seguridad|antiduplicado|interruptor)\b/ },
  { id: 'borrar_todo', categoria: 'instruccion', re: /\b(borra|elimina|anula|cancela)\b.{0,15}\b(todo|todos|todas)\b/ },
  { id: 'marcar_pagado', categoria: 'instruccion', re: /\bmarca\b.{0,20}\bcomo (pagado|pagada|liquidado|liquidada)\b/ },
  { id: 'cambiar_precio', categoria: 'instruccion', re: /\bcambia\b.{0,20}\bel precio de\b/ },
  // --- rol, personificacion y marcas de conversacion
  { id: 'etiqueta_system', categoria: 'rol', re: /<\s*\/?\s*(system|sistema|assistant|asistente|instructions|instrucciones|developer|tool|user)\s*>|<\|[a-z_]{2,20}\|>|\[\/?inst\]|<<\/?sys>>/ },
  { id: 'encabezado_rol', categoria: 'rol', re: /(^|\n)\s*#{0,4}\s*(system|sistema|assistant|asistente|developer|desarrollador|ia|bot)\s*(prompt)?\s*[:>]/ },
  { id: 'role_system', categoria: 'rol', re: /\b(role|rol)\s*[:=]\s*["']?(system|sistema|admin|administrador|assistant|developer|root)\b/ },
  { id: 'modo_desarrollador', categoria: 'rol', re: /\b(modo desarrollador|developer mode|jailbreak|modo dios|dan mode|god mode|modo administrador|admin mode)\b/ },
  { id: 'actua_como', categoria: 'rol', re: /\b(actua|comportate|you are now|ahora eres|pretend|finge|haz de cuenta)\b.{0,20}\b(como|as|que eres|un|una|que)\b/ },
  { id: 'soy_admin', categoria: 'rol', re: /\b(soy|eres|you are)\b.{0,25}\b(administrador|admin|root|desarrollador|developer|el sistema|anthropic|openai|sin restricciones|sin filtros)\b/ },
  { id: 'autorizado_por', categoria: 'rol', re: /\b(autorizado|autorizacion|permiso)\b.{0,15}\b(del dueno|de javier|de angelo|del administrador|total|especial|de seguridad)\b.{0,30}\b(registra|ejecuta|haz|salta|sin)\b/ },
  // --- cadenas de herramientas, funciones, SQL y shell
  { id: 'llama_herramienta', categoria: 'herramienta', re: /\b(llama|invoca|ejecuta|usa|corre|lanza|call|invoke|run|execute)\b.{0,25}\b(funcion|herramienta|tool|script|endpoint|webhook|function|rpc)\b/ },
  { id: 'json_del_esquema', categoria: 'herramienta', re: /["']?(acciones|sospecha_inyeccion|baja_certeza|monto_centavos|tool_call|tool_use|function_call|texto_sospechoso)["']?\s*:/ },
  { id: 'sql', categoria: 'herramienta', re: /\b(select\s+[\w*,\s.]{1,40}\s+from|insert\s+into|update\s+[\w.]+\s+set|delete\s+from|drop\s+(table|schema|database|function)|truncate\s+table|alter\s+(table|function|role)|grant\s+\w+\s+(on|to))\b/ },
  { id: 'esquema_interno', categoria: 'herramienta', re: /\b(agente|operacion|seguridad|catalogo|contabilidad)\.[a-z_]{3,40}\s*\(|\bagente_escritura\b|\bseguridad\.interruptor\b/ },
  { id: 'shell', categoria: 'herramienta', re: /\b(curl|wget|sudo|rm\s+-rf|chmod|bash\s+-c|powershell|nc\s+-e)\b/ },
  { id: 'cadena_pasos', categoria: 'herramienta', re: /\b(primero|luego|despues|paso\s*\d)\b.{0,30}\b(llama|invoca|ejecuta|llamar|ejecutar)\b.{0,40}\b(y luego|y despues|despues|luego|->|=>)\b/ },
  // --- codigo
  { id: 'script', categoria: 'codigo', re: /<\s*script\b|javascript\s*:|\beval\s*\(|\bexec\s*\(|\$\{[^}]{1,60}\}|\{\{[^}]{1,60}\}\}|\bimport\s+os\b|\bos\.system\b/ },
];

const BLOQUE_CODIGO = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g;
const BASE64 = /[A-Za-z0-9+/]{48,}={0,2}/;
const URL_RE = /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"')\]]+/gi;
// Una oracion termina en punto, punto y coma, signo o salto de linea; se conserva el separador al neutralizar.
const FRONTERA = /([^.;!?\n]+)([.;!?\n]*)/g;

function recortar(s: string, max = 100): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Analiza un mensaje: que patrones trae, que fragmentos son sospechosos y como se ve para el modelo.
 * Es determinista y barato: se ejecuta en TODO mensaje de texto antes de armar el prompt.
 */
export function analizarTexto(textoOriginal: string): AnalisisTexto {
  const hallazgos: Hallazgo[] = [];
  const marcar = (id: string, categoria: CategoriaSospecha, fragmento: string): void => {
    hallazgos.push({ id, categoria, fragmento: recortar(fragmento) });
  };

  // 1. Bloques de codigo y enlaces se reemplazan por marcador (no son oraciones: se quita el bloque, no la frase completa).
  let texto = textoOriginal.normalize('NFKC').replace(CONTROLES, '');
  texto = texto.replace(BLOQUE_CODIGO, (m) => {
    marcar('bloque_codigo', 'codigo', m);
    return ` ${MARCADOR_CODIGO} `;
  });
  texto = texto.replace(URL_RE, (m) => {
    marcar('enlace', 'enlace', m);
    return MARCADOR_ENLACE;
  });

  // 2. Oraciones: las que acierten un patron se omiten completas (el modelo no ve la orden ni su carga util).
  const salida: string[] = [];
  for (const m of texto.matchAll(FRONTERA)) {
    const oracion = m[1] ?? '';
    const separador = m[2] ?? '';
    const k = llave(oracion);
    const acertados: Array<{ id: string; categoria: CategoriaSospecha }> = PATRONES.filter((p) => p.re.test(k));
    if (BASE64.test(oracion) && new Set(oracion.match(BASE64)![0]).size >= 14) acertados.push({ id: 'base64', categoria: 'codigo' });
    if (acertados.length === 0) {
      salida.push(oracion + separador);
      continue;
    }
    for (const p of acertados) marcar(p.id, p.categoria, oracion);
    salida.push(MARCADOR_OMITIDO + separador);
  }
  // Un mensaje sin frontera visible (cadena vacia) no pasa por el ciclo: se devuelve tal cual.
  const neutralizado = texto.trim() === '' ? texto : salida.join('').replace(/[ \t]+/g, ' ').trim();

  const unicos = new Set<string>();
  for (const h of hallazgos) if (h.categoria !== 'enlace') unicos.add(h.fragmento);
  return {
    hallazgos,
    textoSospechoso: [...unicos],
    neutralizado,
    bloqueaEscritura: hallazgos.some((h) => h.categoria !== 'enlace'),
  };
}

/** Ids de los patrones que aciertan (compatible con el detector anterior de entrada.ts). */
export function idsDeSospecha(texto: string): string[] {
  return [...new Set(analizarTexto(texto).hallazgos.map((h) => h.id))];
}
