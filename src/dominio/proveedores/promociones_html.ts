// Parser de las senales de promocion del HTML de inicio del proveedor (solo texto publicado, nunca precios).
// Senales fiables (informe 25b, 1.1): (a) insignia "N % de descuento" junto al enlace de un producto, (b) coleccion de campana
// enlazada con cuenta regresiva o con nombre de oferta, (c) fechas de inicio y fin que la pagina publica como atributos.
// NO se usa el precio de comparacion ni ningun importe: el parser ni siquiera los busca.

import type { Instante } from './tipos';

export interface DescuentoDeTarjeta {
  handle: string;
  /** Porcentaje entero anunciado, de 1 a 99. */
  pct: number;
}

export interface CampanaDetectada {
  /** Identificador corto de la coleccion (no es una direccion). */
  coleccion: string;
  mecanica: 'multicompra' | 'campana';
  inicio: Instante | null;
  fin: Instante | null;
}

export interface SenalesPromocion {
  /** Tarjetas de producto reconocidas: sirve para descartar una plantilla rota. */
  tarjetas: number;
  descuentos: DescuentoDeTarjeta[];
  campanas: CampanaDetectada[];
}

const INICIO_TARJETA = /<(?:li|div|article)\b[^>]*class="[^"]*\b(?:product-card|card-wrapper)\b[^"]*"[^>]*>/gi;
const ENLACE_PRODUCTO = /href="\/products\/([a-z0-9][a-z0-9-]*)(?:[?#][^"]*)?"/i;
const INSIGNIA = /(\d{1,2})\s*%\s*de\s+descuento/i;
const ENLACE_COLECCION = /href="\/collections\/([a-z0-9][a-z0-9-]*)(?:[?#][^"]*)?"/gi;
const PALABRAS_CAMPANA = new Set(['oferta', 'ofertas', 'descuento', 'descuentos', 'fin', '3x2', '2x1']);
const VENTANA = 700;

const ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Solo se aceptan instantes con zona explicita: una fecha sin zona dependeria de la zona del servidor. */
function aInstante(valor: string | undefined): Instante | null {
  if (!valor || !ISO_CON_ZONA.test(valor)) return null;
  const t = Date.parse(valor);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function atributo(ventana: string, nombre: string): string | undefined {
  const m = new RegExp(`${nombre}="([^"]+)"`, 'i').exec(ventana);
  return m ? m[1] : undefined;
}

function esDeCampana(handle: string): boolean {
  return handle.split('-').some((t) => PALABRAS_CAMPANA.has(t));
}

export function parsearPromociones(html: string): SenalesPromocion {
  const inicios = [...html.matchAll(INICIO_TARJETA)].map((m) => m.index ?? 0);
  const descuentos = new Map<string, number>();
  let tarjetas = 0;
  inicios.forEach((desde, i) => {
    const hasta = Math.min(inicios[i + 1] ?? html.length, desde + 1500);
    const segmento = html.slice(desde, hasta);
    const enlace = ENLACE_PRODUCTO.exec(segmento);
    if (!enlace) return;
    tarjetas++;
    const insignia = INSIGNIA.exec(segmento);
    if (!insignia) return;
    const pct = Number(insignia[1]);
    if (pct >= 1 && pct <= 99) descuentos.set(enlace[1]!.toLowerCase(), pct);
  });

  const campanas = new Map<string, CampanaDetectada>();
  for (const m of html.matchAll(ENLACE_COLECCION)) {
    const handle = m[1]!.toLowerCase();
    const pos = m.index ?? 0;
    const ventana = html.slice(Math.max(0, pos - VENTANA), pos + VENTANA);
    const inicio = aInstante(atributo(ventana, 'data-countdown-start'));
    const fin = aInstante(atributo(ventana, 'data-countdown-end'));
    const conCuenta = inicio !== null || fin !== null;
    if (!conCuenta && !esDeCampana(handle)) continue;
    const previo = campanas.get(handle);
    campanas.set(handle, {
      coleccion: handle,
      mecanica: /(^|-)(3x2|2x1)(-|$)/.test(handle) ? 'multicompra' : 'campana',
      inicio: previo?.inicio ?? inicio,
      fin: previo?.fin ?? fin,
    });
  }

  return {
    tarjetas,
    descuentos: [...descuentos].map(([handle, pct]) => ({ handle, pct })),
    campanas: [...campanas.values()],
  };
}

/** Handles de producto de una coleccion de campana (el JSON de la coleccion solo se lee para saber que modelos entran). */
export function handlesDeColeccion(crudo: unknown): string[] | null {
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) return null;
  const productos = (crudo as Record<string, unknown>)['products'];
  if (!Array.isArray(productos)) return null;
  const out: string[] = [];
  for (const p of productos) {
    if (typeof p !== 'object' || p === null) return null;
    const handle = (p as Record<string, unknown>)['handle'];
    if (typeof handle !== 'string') return null;
    out.push(handle.toLowerCase());
  }
  return out;
}
