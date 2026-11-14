// Deteccion de nombres duplicados o equivalentes (sabores, modelos, clientes). Funciones PURAS, sin red ni base.
// Es el espejo exacto de catalogo.comparar_nombres (SQL, migracion 20261115300000): misma normalizacion, mismo diccionario, mismos umbrales y mismos puntajes.
// La paridad se prueba en test/integracion/duplicados_paridad.test.ts (todos los pares del catalogo real contra la base).
//
// REGLA CENTRAL: esta deteccion solo SUGIERE. Nunca unifica nada: cada candidato termina en una pregunta a un socio, salvo los pares que el dueno aprobo
// por clave explicita (catalogo.unificacion_aprobada). Un par contestado "no, son distintos" se guarda como NEGATIVO y no se vuelve a preguntar.
import { normalizar } from './normalizar';

export type TipoDuplicado = 'sabor' | 'modelo' | 'cliente';
export type ClaseDuplicado = 'IGUAL_NORMALIZADO' | 'MUY_PROBABLE' | 'POSIBLE' | 'DISTINTO';

export interface Comparacion {
  puntaje: number;
  clase: ClaseDuplicado;
  motivo: string;
  /** true cuando el parecido depende de una equivalencia NO segura (razz = raspberry): nunca se asume, se pregunta. */
  ambiguo: boolean;
}

/** Umbrales de clase sobre el puntaje (0 a 100). */
export const UMBRAL_IGUAL = 100;
export const UMBRAL_MUY_PROBABLE = 80;
export const UMBRAL_POSIBLE = 50;

export function claseDePuntaje(p: number): ClaseDuplicado {
  return p >= UMBRAL_IGUAL ? 'IGUAL_NORMALIZADO' : p >= UMBRAL_MUY_PROBABLE ? 'MUY_PROBABLE' : p >= UMBRAL_POSIBLE ? 'POSIBLE' : 'DISTINTO';
}

/**
 * Diccionario de variantes de sabores (abreviaturas, ingles/espanol). Espejo de catalogo.diccionario_sabor.
 * EXACTAS: la equivalencia es de uso comun; igual solo llega a MUY_PROBABLE (se pregunta).
 * AMBIGUAS: la equivalencia puede ser falsa (razz, coco, mora...); solo llega a POSIBLE y se marca como ambigua. Nunca se asume.
 */
export const DICCIONARIO_EXACTO: Readonly<Record<string, string>> = {
  straw: 'strawberry', strawb: 'strawberry', strwb: 'strawberry', strwbry: 'strawberry',
  rasp: 'raspberry', raspb: 'raspberry', wmelon: 'watermelon', mnt: 'mint',
  sandia: 'watermelon', fresa: 'strawberry', uva: 'grape', durazno: 'peach', limon: 'lemon', manzana: 'apple', cereza: 'cherry',
  menta: 'mint', hielo: 'ice', frambuesa: 'raspberry', maracuya: 'passion fruit', pina: 'pineapple', platano: 'banana', lichi: 'lychee',
};
export const DICCIONARIO_AMBIGUO: Readonly<Record<string, string>> = {
  razz: 'raspberry', icy: 'ice', iced: 'ice', coco: 'coconut', arandano: 'blueberry', mora: 'blackberry', lemonade: 'lemon',
};

/** Singular simple e igual en SQL: -ies -> -y (largo > 4); -s se quita (largo > 3) salvo -ss, -us, -is. */
export function singular(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) return t.slice(0, -1);
  return t;
}

/** Normaliza (minusculas, sin acentos, sin signos) y separa en palabras en singular. */
export function palabras(nombre: string): string[] {
  const n = normalizar(nombre);
  return n === '' ? [] : n.split(' ').map(singular);
}

function canon(pal: readonly string[], nivel: 0 | 1 | 2): { pal: string[]; usadas: string[] } {
  const salida: string[] = [];
  const usadas: string[] = [];
  for (const p of pal) {
    const ex = nivel >= 1 ? DICCIONARIO_EXACTO[p] : undefined;
    const am = nivel >= 2 && ex === undefined ? DICCIONARIO_AMBIGUO[p] : undefined;
    const r = ex ?? am;
    if (r === undefined) { salida.push(p); continue; }
    usadas.push(`${p} = ${r}`);
    for (const w of r.split(' ')) salida.push(w);
  }
  return { pal: salida, usadas };
}

/** Distancia de edicion (Levenshtein) propia, sin extensiones. Igual a catalogo.distancia_edicion. */
export function distanciaEdicion(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * La lista corta (sin espacios) abre a la larga en una frontera de palabra, o a mitad de una palabra de la larga siempre que esa palabra empiece donde empieza
 * la ULTIMA palabra de la corta y tenga >= 4 letras ("peach blue" en "peach blueberry", "grape straw" en "grape strawberry"). Devuelve cuantas palabras de la larga sobran, o -1.
 */
export function prefijoDePalabras(corta: readonly string[], larga: readonly string[]): number {
  const s = corta.join('');
  const l = larga.join('');
  if (s.length < 4 || s.length >= l.length || !l.startsWith(s)) return -1;
  const ult = corta[corta.length - 1]!;
  let acc = 0;
  for (let i = 0; i < larga.length; i++) {
    const sig = acc + larga[i]!.length;
    if (s.length === sig) return larga.length - i - 1;
    if (s.length < sig) return acc === s.length - ult.length && ult.length >= 4 ? larga.length - i : -1;
    acc = sig;
  }
  return -1;
}

const ordenadas = (p: readonly string[]): string => [...p].sort().join('');

interface Senal { puntaje: number; motivo: string; ambiguo: boolean }

/** Compara dos nombres del mismo tipo. Devuelve la mejor senal; clase DISTINTO si ninguna llega a 50. */
export function compararNombres(tipo: TipoDuplicado, a: string, b: string): Comparacion {
  const pa = palabras(a);
  const pb = palabras(b);
  if (pa.length === 0 || pb.length === 0) return { puntaje: 0, clase: 'DISTINTO', motivo: 'nombre vacio', ambiguo: false };
  const ja = pa.join('');
  const jb = pb.join('');
  const senales: Senal[] = [];
  const poner = (puntaje: number, motivo: string, ambiguo = false) => senales.push({ puntaje, motivo, ambiguo });

  if (ja === jb) {
    poner(100, pa.join(' ') === pb.join(' ') ? 'mismo nombre una vez normalizado (mayusculas, acentos, signos o plural)' : 'mismas letras escritas con o sin espacio', false);
  } else {
    if (ordenadas(pa) === ordenadas(pb)) poner(92, 'mismas palabras en otro orden');
    const digito = /[0-9]/.test(ja + jb);
    const largo = Math.max(ja.length, jb.length);
    const d = digito ? 99 : distanciaEdicion(ja, jb);
    if (d === 1 && largo >= 5) poner(85, 'una letra de diferencia (posible error de dedo)');
    else if (d === 2 && Math.min(ja.length, jb.length) >= 8) poner(68, 'dos letras de diferencia (posible error de dedo)');
    const [corta, larga] = ja.length <= jb.length ? [pa, pb] : [pb, pa];
    const ex = prefijoDePalabras(corta, larga);
    if (ex >= 0) poner(ex === 1 ? 65 : 55, 'un nombre empieza como el otro y el otro agrega palabras');

    if (tipo === 'sabor') {
      const ca = canon(pa, 1);
      const cb = canon(pb, 1);
      const usadas = [...new Set([...ca.usadas, ...cb.usadas])].join(', ');
      if (ca.usadas.length + cb.usadas.length > 0) {
        if (ca.pal.join('') === cb.pal.join('')) poner(90, `mismo sabor con abreviatura o traduccion conocida (${usadas})`);
        else if (ordenadas(ca.pal) === ordenadas(cb.pal)) poner(86, `mismas palabras en otro orden con abreviatura o traduccion conocida (${usadas})`);
        const [c1, c2] = ca.pal.join('').length <= cb.pal.join('').length ? [ca.pal, cb.pal] : [cb.pal, ca.pal];
        const ex2 = prefijoDePalabras(c1, c2);
        if (ex2 >= 0) poner(ex2 === 1 ? 60 : 50, `un nombre empieza como el otro, con abreviatura o traduccion conocida (${usadas})`);
      }
      const aa = canon(pa, 2);
      const ab = canon(pb, 2);
      const usadasAmb = [...new Set([...aa.usadas, ...ab.usadas])].filter((u) => !(ca.usadas.includes(u) || cb.usadas.includes(u))).join(', ');
      if (usadasAmb !== '') {
        if (aa.pal.join('') === ab.pal.join('')) poner(62, `podria ser el mismo sabor si ${usadasAmb}, pero esa equivalencia NO es segura`, true);
        else if (ordenadas(aa.pal) === ordenadas(ab.pal)) poner(58, `podria ser el mismo sabor en otro orden si ${usadasAmb}, pero esa equivalencia NO es segura`, true);
      }
      // Sigla: "BP" podria abreviar un nombre de varias palabras con esas iniciales.
      for (const [x, y, nx] of [[pa, pb, a], [pb, pa, b]] as const) {
        const nombreX = normalizar(nx).replace(/ /g, '');
        if (x.length === 1 && nombreX.length >= 2 && nombreX.length <= 4 && y.length === nombreX.length && y.map((w) => w[0]).join('') === nombreX) {
          poner(50, `"${normalizar(nx)}" podria ser la sigla de ${y.join(' ')}`, true);
        }
      }
    }
  }
  if (senales.length === 0) return { puntaje: 0, clase: 'DISTINTO', motivo: 'sin parecido', ambiguo: false };
  // Mejor senal; a igual puntaje gana la no ambigua y luego la primera escrita.
  const mejor = senales.reduce((m, s) => (s.puntaje > m.puntaje || (s.puntaje === m.puntaje && m.ambiguo && !s.ambiguo) ? s : m));
  return { puntaje: mejor.puntaje, clase: claseDePuntaje(mejor.puntaje), motivo: mejor.motivo, ambiguo: mejor.ambiguo };
}

export interface Candidato {
  id: number;
  nombre: string;
  comparacion: Comparacion;
  /** Ya se pregunto y el socio dijo "son distintos": no se vuelve a preguntar. */
  negativo: boolean;
}

/** Candidatos del catalogo para un nombre (nuevo o existente). Ordenados por puntaje; excluye el propio id; marca los negativos conocidos. */
export function candidatosDuplicado(
  tipo: TipoDuplicado,
  nombre: string,
  catalogo: readonly { id: number; nombre: string }[],
  opciones: { excluirId?: number | null; minimo?: number; negativos?: ReadonlySet<number> } = {},
): Candidato[] {
  const minimo = opciones.minimo ?? UMBRAL_POSIBLE;
  return catalogo
    .filter((c) => c.id !== opciones.excluirId)
    .map((c) => ({ id: c.id, nombre: c.nombre, comparacion: compararNombres(tipo, nombre, c.nombre), negativo: opciones.negativos?.has(c.id) ?? false }))
    .filter((c) => c.comparacion.puntaje >= minimo)
    .sort((x, y) => y.comparacion.puntaje - x.comparacion.puntaje || x.nombre.localeCompare(y.nombre));
}

/** Regla del alta: IGUAL o MUY_PROBABLE (y no negativo) bloquea la creacion y devuelve la pregunta; POSIBLE crea y deja la pregunta pendiente. */
export function decisionAlta(candidatos: readonly Candidato[]): 'crear' | 'preguntar_antes' | 'crear_y_dejar_pregunta' {
  const vivos = candidatos.filter((c) => !c.negativo);
  if (vivos.some((c) => c.comparacion.clase === 'IGUAL_NORMALIZADO' || c.comparacion.clase === 'MUY_PROBABLE')) return 'preguntar_antes';
  if (vivos.some((c) => c.comparacion.clase === 'POSIBLE')) return 'crear_y_dejar_pregunta';
  return 'crear';
}

/** Texto de la pregunta, igual para la web, el bot y la base. */
export function textoPregunta(nombreA: string, nombreB: string, ambiguo = false): string {
  return ambiguo
    ? `¿"${nombreA}" es lo mismo que "${nombreB}"? No estoy seguro: la equivalencia no es segura.`
    : `¿"${nombreA}" es lo mismo que "${nombreB}"?`;
}
