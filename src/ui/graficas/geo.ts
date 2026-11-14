// Geometria y calculos de presentacion de las graficas. Funciones puras, sin DOM, sin reloj y sin azar.
// Aqui NO se calcula negocio: las cifras llegan ya calculadas y formateadas (texto) por el servidor; este modulo solo las coloca en el plano.
import { indiceEscalonado } from '../movimiento';

export class ErrorGrafica extends Error {
  readonly codigo: 'datos_vacios' | 'valor_invalido' | 'demasiados_ejes' | 'demasiadas_series' | 'longitud_distinta';
  constructor(codigo: ErrorGrafica['codigo'], mensaje: string) {
    super(mensaje);
    this.name = 'ErrorGrafica';
    this.codigo = codigo;
  }
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: ErrorGrafica };

/** Ejecuta un calculo de geometria y devuelve el error tipado en lugar de lanzarlo (la grafica lo pinta como estado de error). */
export function seguro<T>(fn: () => T): Resultado<T> {
  try {
    return { ok: true, valor: fn() };
  } catch (e) {
    if (e instanceof ErrorGrafica) return { ok: false, error: e };
    throw e;
  }
}

export function exigirFinitos(valores: readonly number[], nombre: string): void {
  for (const v of valores) if (!Number.isFinite(v)) throw new ErrorGrafica('valor_invalido', `${nombre}: hay un valor que no es un numero finito`);
}

export function exigirNoNegativos(valores: readonly number[], nombre: string): void {
  exigirFinitos(valores, nombre);
  for (const v of valores) if (v < 0) throw new ErrorGrafica('valor_invalido', `${nombre}: no admite valores negativos`);
}

/** Redondea a 2 decimales para que el SVG sea estable y legible. */
export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function acotar(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Escala lineal de [d0, d1] a [r0, r1]. Dominio degenerado: el punto medio del rango. */
export function escala(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  if (d0 === d1) return () => (r0 + r1) / 2;
  return (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

export function extremos(valores: readonly number[]): { min: number; max: number } {
  if (valores.length === 0) throw new ErrorGrafica('datos_vacios', 'No hay valores');
  let min = valores[0]!;
  let max = valores[0]!;
  for (const v of valores) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

type Pt = readonly [number, number];

/** Ruta poligonal M x y L x y ... */
export function rutaPoligonal(pts: readonly Pt[]): string {
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${r2(x)} ${r2(y)}`).join(' ');
}

/** Ruta escalonada: el valor rige hasta que cambia. */
export function rutaEscalon(pts: readonly Pt[]): string {
  return pts.map(([x, y], i) => (i === 0 ? `M ${r2(x)} ${r2(y)}` : `H ${r2(x)} V ${r2(y)}`)).join(' ');
}

/** Area entre dos bordes (banda de proyeccion): borde alto de izquierda a derecha y borde bajo de derecha a izquierda. */
export function rutaBanda(alto: readonly Pt[], bajo: readonly Pt[]): string {
  const ida = alto.map(([x, y]) => `${r2(x)} ${r2(y)}`);
  const vuelta = [...bajo].reverse().map(([x, y]) => `${r2(x)} ${r2(y)}`);
  return `M ${ida.join(' L ')} L ${vuelta.join(' L ')} Z`;
}

// ---------- Cascada ----------
export interface PasoCascada { id: string; etiqueta: string; valor: number; tipo: 'inicio' | 'delta' | 'total' }
export interface BarraCascada { id: string; etiqueta: string; desde: number; hasta: number; acumulado: number; signo: 'mas' | 'menos' | 'total'; cuadra: boolean }

/** Cada escalon arranca donde termino el anterior. Un `total` muestra su valor y `cuadra` indica si coincide con la suma acumulada. */
export function calcularCascada(pasos: readonly PasoCascada[]): BarraCascada[] {
  if (pasos.length === 0) throw new ErrorGrafica('datos_vacios', 'La cascada necesita al menos un paso');
  exigirFinitos(pasos.map((p) => p.valor), 'cascada');
  let acum = 0;
  return pasos.map((p) => {
    if (p.tipo === 'delta') {
      const desde = acum;
      acum += p.valor;
      return { id: p.id, etiqueta: p.etiqueta, desde, hasta: acum, acumulado: acum, signo: p.valor >= 0 ? 'mas' : 'menos', cuadra: true };
    }
    if (p.tipo === 'inicio') {
      acum = p.valor;
      return { id: p.id, etiqueta: p.etiqueta, desde: 0, hasta: p.valor, acumulado: acum, signo: 'total', cuadra: true };
    }
    return { id: p.id, etiqueta: p.etiqueta, desde: 0, hasta: p.valor, acumulado: acum, signo: 'total', cuadra: p.valor === acum };
  });
}

// ---------- Pareto ----------
export interface ElementoPareto { id: string; etiqueta: string; valor: number }
export interface FilaPareto extends ElementoPareto { fraccion: number; acumulada: number }

/** Ordena de mayor a menor y calcula el porcentaje acumulado (0 a 1). Total cero: todo en cero, sin dividir. */
export function calcularPareto(items: readonly ElementoPareto[]): FilaPareto[] {
  if (items.length === 0) throw new ErrorGrafica('datos_vacios', 'El Pareto necesita datos');
  exigirNoNegativos(items.map((i) => i.valor), 'pareto');
  const orden = [...items].sort((a, b) => b.valor - a.valor);
  const total = orden.reduce((s, i) => s + i.valor, 0);
  let acum = 0;
  return orden.map((i) => {
    acum += i.valor;
    return { ...i, fraccion: total === 0 ? 0 : i.valor / total, acumulada: total === 0 ? 0 : Math.min(1, acum / total) };
  });
}

/** Cuantos elementos hacen falta para alcanzar el umbral (0 a 1) del acumulado. */
export function elementosHasta(filas: readonly FilaPareto[], umbral: number): number {
  const i = filas.findIndex((f) => f.acumulada >= umbral - 1e-12);
  return i === -1 ? filas.length : i + 1;
}

// ---------- Treemap (squarify) ----------
export interface RectNodo { id: string; x: number; y: number; ancho: number; alto: number; valor: number; fraccion: number }

function peorRazon(fila: readonly number[], lado: number): number {
  const suma = fila.reduce((s, a) => s + a, 0);
  const max = Math.max(...fila);
  const min = Math.min(...fila);
  return Math.max((lado * lado * max) / (suma * suma), (suma * suma) / (lado * lado * min));
}

/** Treemap squarified: el area de cada rectangulo es proporcional al valor y la suma de areas es el area total. Los valores en cero no ocupan area. */
export function calcularTreemap(items: ReadonlyArray<{ id: string; valor: number }>, ancho: number, alto: number): RectNodo[] {
  if (items.length === 0) throw new ErrorGrafica('datos_vacios', 'El treemap necesita datos');
  exigirNoNegativos(items.map((i) => i.valor), 'treemap');
  const validos = items.filter((i) => i.valor > 0).sort((a, b) => b.valor - a.valor);
  const total = validos.reduce((s, i) => s + i.valor, 0);
  if (total === 0) throw new ErrorGrafica('datos_vacios', 'El treemap necesita al menos un valor positivo');
  const areaTotal = ancho * alto;
  let resto = validos.map((i) => ({ id: i.id, valor: i.valor, area: (i.valor / total) * areaTotal }));
  const salida: RectNodo[] = [];
  let x = 0;
  let y = 0;
  let w = ancho;
  let h = alto;
  while (resto.length > 0) {
    const lado = Math.min(w, h);
    const fila: typeof resto = [];
    while (resto.length > 0) {
      const candidato = resto[0]!;
      const actuales = fila.map((n) => n.area);
      if (fila.length === 0 || peorRazon([...actuales, candidato.area], lado) <= peorRazon(actuales, lado)) {
        fila.push(candidato);
        resto = resto.slice(1);
      } else break;
    }
    const areaFila = fila.reduce((s, n) => s + n.area, 0);
    if (w >= h) {
      const anchoFila = areaFila / h;
      let yy = y;
      for (const n of fila) {
        const alt = n.area / anchoFila;
        salida.push({ id: n.id, x, y: yy, ancho: anchoFila, alto: alt, valor: n.valor, fraccion: n.valor / total });
        yy += alt;
      }
      x += anchoFila;
      w -= anchoFila;
    } else {
      const altoFila = areaFila / w;
      let xx = x;
      for (const n of fila) {
        const anc = n.area / altoFila;
        salida.push({ id: n.id, x: xx, y, ancho: anc, alto: altoFila, valor: n.valor, fraccion: n.valor / total });
        xx += anc;
      }
      y += altoFila;
      h -= altoFila;
    }
  }
  return salida;
}

// ---------- Mapa de calor ----------
export const NIVELES_CALOR = 5;

/** Nivel 0 a 4 de un valor dentro de [min, max]. Rango degenerado: nivel medio. */
export function nivelCalor(v: number, min: number, max: number, niveles: number = NIVELES_CALOR): number {
  if (max === min) return Math.floor(niveles / 2);
  return acotar(Math.floor(((v - min) / (max - min)) * niveles), 0, niveles - 1);
}

// ---------- Radar ----------
export const MAX_EJES_RADAR = 8;

export function puntoRadar(indice: number, ejes: number, radio: number, cx: number, cy: number): [number, number] {
  const ang = -Math.PI / 2 + (2 * Math.PI * indice) / ejes;
  return [cx + radio * Math.cos(ang), cy + radio * Math.sin(ang)];
}

// ---------- Burbujas ----------
/** Radio proporcional a la raiz del tamano, para que el AREA sea proporcional al valor. */
export function radioBurbuja(tamano: number, maxTamano: number, rMin: number, rMax: number): number {
  if (maxTamano <= 0) return rMin;
  return rMin + Math.sqrt(acotar(tamano / maxTamano, 0, 1)) * (rMax - rMin);
}

// ---------- Apiladas ----------
export interface TramoApilado { desde: number; ancho: number }

/** Posiciones consecutivas de los tramos de una barra apilada, en una escala 0 a `escalaMax`. */
export function apilar(valores: readonly number[], escalaMax: number, anchoTotal: number): TramoApilado[] {
  exigirNoNegativos(valores, 'apilada');
  let x = 0;
  return valores.map((v) => {
    const ancho = escalaMax <= 0 ? 0 : (v / escalaMax) * anchoTotal;
    const t = { desde: x, ancho };
    x += ancho;
    return t;
  });
}

// ---------- Cifras animadas ----------
export function easeOutCubic(t: number): number {
  const u = 1 - acotar(t, 0, 1);
  return 1 - u * u * u;
}

export function interpolar(desde: number, hasta: number, t: number): number {
  return desde + (hasta - desde) * easeOutCubic(t);
}

// ---------- Delta ----------
export type SentidoDelta = 'sube' | 'baja' | 'igual';

export function sentidoDelta(anterior: number, actual: number): SentidoDelta {
  if (actual > anterior) return 'sube';
  if (actual < anterior) return 'baja';
  return 'igual';
}

// ---------- Teclado ----------
/** Siguiente indice al pulsar una tecla de navegacion, o null si la tecla no navega. `columnas` > 1 habilita arriba/abajo por filas. */
export function siguienteIndice(actual: number, total: number, tecla: string, columnas: number = 1): number | null {
  if (total <= 0) return null;
  const ult = total - 1;
  const paso = Math.max(1, columnas);
  switch (tecla) {
    case 'ArrowRight': return Math.min(ult, actual + 1);
    case 'ArrowLeft': return Math.max(0, actual - 1);
    case 'ArrowDown': return Math.min(ult, actual + paso);
    case 'ArrowUp': return Math.max(0, actual - paso);
    case 'Home': return 0;
    case 'End': return ult;
    default: return null;
  }
}

// ---------- Texto ----------
/** Parte una etiqueta en lineas de a lo mas `max` caracteres (por palabras; lo que excede se corta con puntos suspensivos). */
export function partirEtiqueta(texto: string, max: number, lineasMax: number = 2): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const lineas: string[] = [];
  let actual = '';
  for (const p of palabras) {
    const pal = p.length > max ? `${p.slice(0, Math.max(1, max - 1))}…` : p;
    if (actual === '') actual = pal;
    else if (`${actual} ${pal}`.length <= max) actual = `${actual} ${pal}`;
    else {
      lineas.push(actual);
      actual = pal;
    }
  }
  if (actual) lineas.push(actual);
  if (lineas.length > lineasMax) {
    const cortado = lineas.slice(0, lineasMax);
    const ultima = cortado[lineasMax - 1]!;
    cortado[lineasMax - 1] = ultima.endsWith('…') ? ultima : `${ultima.slice(0, Math.max(1, max - 1))}…`;
    return cortado;
  }
  return lineas;
}

/** Nombre corto para etiquetas: completo si cabe; si no, primer nombre e inicial de la palabra siguiente ("Dana M."). El nombre completo va en tooltip y tabla. */
export function abreviarNombre(nombre: string, max: number = 16): string {
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  if (limpio.length <= max) return limpio;
  const [primero = '', segundo] = limpio.split(' ');
  const corto = segundo ? `${primero} ${segundo[0]!.toUpperCase()}.` : primero;
  return corto.length <= max ? corto : `${corto.slice(0, Math.max(1, max - 1))}…`;
}

/** Clase de escalonado de entrada (maximo 6 elementos retrasados). */
export function claseEscalonado(i: number): string {
  return `rtm-i-${indiceEscalonado(i)}`;
}

/** Muestra minima: una grafica sin muestra suficiente no se anima ni se dibuja, se explica. */
export function muestraSuficiente(actual: number, requerida: number): boolean {
  return actual >= requerida;
}
