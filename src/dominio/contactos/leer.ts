// Lectura de una tabla (matriz de textos) de contactos a registros normalizados. Funciones puras: reciben la tabla, devuelven registros y conteos.
import { normalizarTelefono, separarTelefonos, type MotivoTelefonoInvalido } from './telefono';
import type { Descartes, FuenteTabla, OrigenContacto, RegistroLeido, ResultadoLectura } from './tipos';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const CORREO_VALIDO = /^[^\s@,;:]+@[^\s@,;:]+\.[^\s@,;:]{2,}$/;

export function descartesVacios(): Descartes {
  return { fila_vacia: 0, sin_telefono: 0, telefono_vacio: 0, corto: 0, largo: 0, patron_falso: 0, correo_invalido: 0 };
}

interface Columnas {
  telefonos: number[];
  correos: number[];
  nombres: number[];
  etiquetas: number[];
  anuncio: number;
  formulario: number;
  campana: number;
}

function detectarColumnas(cab: string[]): Columnas {
  const h = cab.map(norm);
  const idx = (f: (t: string) => boolean) => h.map((t, i) => (f(t) ? i : -1)).filter((i) => i >= 0);
  const una = (f: (t: string) => boolean) => idx(f)[0] ?? -1;
  const telValor = idx((t) => /^phone\s*\d*\s*-?\s*value$/.test(t) || /^phone # - value$/.test(t));
  const telefonos = telValor.length ? telValor : idx((t) => t === 'phone' || t === 'phone_number' || t === 'whatsapp' || t === 'telefono' || t === 'celular');
  const corValor = idx((t) => /^e-?mail\s*\d*\s*-?\s*value$/.test(t));
  const correos = corValor.length ? corValor : idx((t) => t === 'email' || t === 'e-mail' || t === 'correo');
  const nombres = idx((t) => ['first name', 'middle name', 'last name', 'full_name', 'full name', 'display name', 'nombre'].includes(t));
  const nombresAlt = nombres.length ? nombres : idx((t) => t === 'name' || t === 'given name' || t === 'family name');
  const etiquetas = idx((t) => t === 'labels' || t === 'group membership');
  return {
    telefonos,
    correos,
    nombres: nombresAlt,
    etiquetas,
    anuncio: una((t) => t === 'ad_name'),
    formulario: una((t) => t === 'form_name'),
    campana: una((t) => t === 'campaign_name'),
  };
}

/** Etiquetas de Google: separadas por ' ::: '; se ignora la etiqueta de sistema 'myContacts' y los asteriscos. */
export function leerEtiquetas(celda: string): string[] {
  return celda
    .split(/\s*:::\s*/)
    .map((e) => e.replace(/^\*\s*/, '').trim())
    .filter((e) => e !== '' && norm(e) !== 'mycontacts');
}

function nombreDe(fila: string[], cols: number[]): string {
  return cols.map((i) => (fila[i] ?? '').trim()).filter((p) => p !== '').join(' ').replace(/\s+/g, ' ');
}

/** Slug estable de una etiqueta para el origen 'google-lote:<etiqueta>'. */
export function slugEtiqueta(e: string): string {
  return norm(e).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sin-etiqueta';
}

function origenesDe(fuente: FuenteTabla, fila: string[], cols: Columnas, etiquetas: string[]): OrigenContacto[] {
  if (fuente.tipo === 'meta') {
    return [{ origen: 'meta', anuncio: cols.anuncio >= 0 ? (fila[cols.anuncio] ?? '').trim() || null : null, formulario: cols.formulario >= 0 ? (fila[cols.formulario] ?? '').trim() || null : null, campana: cols.campana >= 0 ? (fila[cols.campana] ?? '').trim() || null : null }];
  }
  if (fuente.tipo === 'toocloudy') return [{ origen: 'toocloudy-whatsapp', anuncio: null, formulario: null, campana: null }];
  if (fuente.tipo === 'vapeunion') return [{ origen: 'vapeunion', anuncio: null, formulario: null, campana: null }];
  if (fuente.tipo === 'vcf') {
    const base = fuente.archivo.split('/').pop()!.replace(/\.[^.]+$/, '');
    return [{ origen: `google-vcf:${slugEtiqueta(base)}`, anuncio: null, formulario: null, campana: null }];
  }
  const lista = etiquetas.length ? etiquetas.map(slugEtiqueta) : ['sin-etiqueta'];
  return [...new Set(lista)].map((e) => ({ origen: `google-lote:${e}`, anuncio: null, formulario: null, campana: null }));
}

/**
 * Convierte una tabla en registros. `descartes` cuenta cada fila o telefono tirado por motivo.
 * Una fila con al menos un telefono valido produce UN registro con todos sus telefonos validos; los invalidos se cuentan aparte.
 */
export function leerTabla(tabla: string[][], fuente: FuenteTabla): ResultadoLectura {
  const descartes = descartesVacios();
  const registros: RegistroLeido[] = [];
  const telefonosInvalidos: Record<MotivoTelefonoInvalido, number> = { vacio: 0, corto: 0, largo: 0, patron_falso: 0 };
  let extranjeros = 0;
  let sinLada = 0;
  const cab = tabla[0] ?? [];
  const cols = detectarColumnas(cab);
  const filas = tabla.slice(1);
  if (cols.telefonos.length === 0) {
    return { archivo: fuente.archivo, tipo: fuente.tipo, filas: filas.length, registros, descartes: { ...descartes, sin_telefono: filas.length }, columnas_telefono: 0, extranjeros: 0, sin_lada: 0, etiquetas_vistas: [] };
  }
  const etiquetasVistas: string[] = [];
  for (const fila of filas) {
    if (fila.every((c) => (c ?? '').trim() === '')) { descartes.fila_vacia++; continue; }
    const tels = new Set<string>();
    let hubo = false;
    for (const i of cols.telefonos) {
      for (const t of separarTelefonos(fila[i] ?? '')) {
        hubo = true;
        const r = normalizarTelefono(t);
        if (r.ok) {
          if (!tels.has(r.e164) && r.extranjero) extranjeros++;
          if (!tels.has(r.e164) && r.sinLada) sinLada++;
          tels.add(r.e164);
        } else {
          telefonosInvalidos[r.motivo]++;
          if (r.motivo !== 'vacio') descartes[r.motivo]++;
        }
      }
    }
    if (tels.size === 0) {
      if (!hubo) descartes.telefono_vacio++;
      descartes.sin_telefono++;
      continue;
    }
    const correos = new Set<string>();
    for (const i of cols.correos) {
      for (const c of (fila[i] ?? '').split(/\s*:::\s*|[;,\s]+/)) {
        const limpio = c.trim().toLowerCase();
        if (limpio === '') continue;
        if (CORREO_VALIDO.test(limpio)) correos.add(limpio);
        else descartes.correo_invalido++;
      }
    }
    const etiquetas = cols.etiquetas.flatMap((i) => leerEtiquetas(fila[i] ?? ''));
    etiquetasVistas.push(...etiquetas);
    registros.push({
      archivo: fuente.archivo,
      nombre: nombreDe(fila, cols.nombres),
      telefonos: [...tels].sort(),
      correos: [...correos].sort(),
      etiquetas: [...new Set(etiquetas)].sort(),
      origenes: origenesDe(fuente, fila, cols, etiquetas),
    });
  }
  return { archivo: fuente.archivo, tipo: fuente.tipo, filas: filas.length, registros, descartes, columnas_telefono: cols.telefonos.length, extranjeros, sin_lada: sinLada, etiquetas_vistas: [...new Set(etiquetasVistas)].sort() };
}
