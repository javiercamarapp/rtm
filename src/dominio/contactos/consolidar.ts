// Deduplicacion conservando todos los origenes, etiquetas y lotes. Determinista e idempotente.
// Reglas: un telefono compartido une siempre (cierre transitivo). Un correo compartido une SOLO si ademas el nombre normalizado
// (sin acentos, mayusculas ni espacios extra) es el mismo; con nombre distinto quedan separados y marcados `correo_compartido`.
import type { ContactoConsolidado, Descartes, InformeContactos, OrigenContacto, RegistroLeido, ResultadoLectura } from './tipos';
import { descartesVacios } from './leer';
import { esSinLada } from './telefono';
import { normalizarTexto } from './texto';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const unicos = (xs: string[]) => [...new Set(xs)].sort(cmp);
const claveOrigen = (o: OrigenContacto) => [o.origen, o.anuncio ?? '', o.formulario ?? '', o.campana ?? ''].join('\u0001');

/** Nombre para comparar: sin acentos, en minusculas, solo letras y numeros separados por un espacio. */
export const nombreNormalizado = normalizarTexto;

/** Una colonia por clave normalizada (se conserva el original menor en orden para mostrar), ordenadas por clave. */
function coloniasDe(lista: string[]): string[] {
  const m = new Map<string, string>();
  for (const c of lista) {
    const k = normalizarTexto(c);
    if (k === '') continue;
    const previa = m.get(k);
    if (previa === undefined || c < previa) m.set(k, c);
  }
  return [...m.entries()].sort((a, b) => cmp(a[0], b[0])).map(([, v]) => v);
}

function orden(registros: RegistroLeido[]): RegistroLeido[] {
  // Orden canonico de entrada: el resultado no depende del orden de los archivos.
  return [...registros].sort((a, b) => cmp(a.telefonos[0] ?? '', b.telefonos[0] ?? '') || cmp(a.archivo, b.archivo) || cmp(a.nombre, b.nombre) || cmp(a.correos.join(), b.correos.join()));
}

/** Raiz de grupo por registro. `porCorreo` activa la union por correo (solo con el mismo nombre normalizado). */
function agrupar(lista: RegistroLeido[], porCorreo: boolean): number[] {
  const padre = lista.map((_, i) => i);
  const raiz = (i: number): number => { while (padre[i] !== i) { padre[i] = padre[padre[i]!]!; i = padre[i]!; } return i; };
  const unir = (a: number, b: number) => { const ra = raiz(a); const rb = raiz(b); if (ra !== rb) padre[Math.max(ra, rb)] = Math.min(ra, rb); };
  const dueno = new Map<string, number>();
  const ver = (k: string, i: number) => { const previo = dueno.get(k); if (previo === undefined) dueno.set(k, i); else unir(previo, i); };
  lista.forEach((r, i) => {
    for (const t of r.telefonos) ver(`t:${t}`, i);
    const nombre = nombreNormalizado(r.nombre);
    if (porCorreo && nombre !== '') for (const c of r.correos) ver(`c:${c}\u0001${nombre}`, i);
  });
  return lista.map((_, i) => raiz(i));
}

export interface ResultadoConsolidacion {
  contactos: ContactoConsolidado[];
  /** Uniones que solo ocurrieron por correo + mismo nombre (no habrian ocurrido por telefono). */
  unidos_por_correo_y_nombre: number;
}

export function consolidarConEstadisticas(registros: RegistroLeido[]): ResultadoConsolidacion {
  const lista = orden(registros);
  const raices = agrupar(lista, true);
  const soloTelefono = new Set(agrupar(lista, false)).size;
  const grupos = new Map<number, RegistroLeido[]>();
  lista.forEach((r, i) => { const g = raices[i]!; (grupos.get(g) ?? grupos.set(g, []).get(g)!).push(r); });

  // Correos que aparecen en mas de un grupo final: nombre distinto, no se unieron -> revision.
  const gruposPorCorreo = new Map<string, Set<number>>();
  lista.forEach((r, i) => { for (const c of r.correos) (gruposPorCorreo.get(c) ?? gruposPorCorreo.set(c, new Set()).get(c)!).add(raices[i]!); });
  const compartidos = new Set<number>();
  for (const gs of gruposPorCorreo.values()) if (gs.size > 1) for (const g of gs) compartidos.add(g);

  const salida: ContactoConsolidado[] = [];
  for (const [g, miembros] of grupos) {
    const telefonos = unicos(miembros.flatMap((m) => m.telefonos));
    const origenes = new Map<string, OrigenContacto>();
    for (const m of miembros) for (const o of m.origenes) origenes.set(claveOrigen(o), o);
    // Nombre: el mas largo (mas informacion); empate por orden alfabetico.
    const nombre = miembros.map((m) => m.nombre).filter((n) => n !== '').sort((a, b) => b.length - a.length || cmp(a, b))[0] ?? '';
    salida.push({
      telefono: telefonos.find((t) => !esSinLada(t)) ?? telefonos[0]!,
      nombre,
      telefonos,
      correos: unicos(miembros.flatMap((m) => m.correos)),
      etiquetas: unicos(miembros.flatMap((m) => m.etiquetas)),
      lotes: unicos(miembros.map((m) => m.archivo)),
      origenes: [...origenes.values()].sort((a, b) => cmp(claveOrigen(a), claveOrigen(b))),
      tipo: 'menudeo',
      correo_compartido: compartidos.has(g),
      colonias: coloniasDe(miembros.flatMap((m) => m.colonias)),
      colonia_conflicto: coloniasDe(miembros.flatMap((m) => m.colonias)).length > 1,
    });
  }
  return { contactos: salida.sort((a, b) => cmp(a.telefono, b.telefono)), unidos_por_correo_y_nombre: soloTelefono - grupos.size };
}

export function consolidar(registros: RegistroLeido[]): ContactoConsolidado[] {
  return consolidarConEstadisticas(registros).contactos;
}

function contar<T>(items: T[], clave: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) { const k = clave(it); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}

/** Informe de conteos SIN datos personales: nada de telefonos, correos ni nombres. */
export function construirInforme(lecturas: ResultadoLectura[], contactos: ContactoConsolidado[], unidosPorCorreoYNombre = 0): InformeContactos {
  const validos = lecturas.reduce((s, l) => s + l.registros.length, 0);
  const filas = lecturas.reduce((s, l) => s + l.filas, 0);
  const invalidos = lecturas.reduce((s, l) => s + l.descartes.sin_telefono + l.descartes.fila_vacia, 0);
  const porOrigen = new Map<string, number>();
  for (const c of contactos) for (const o of new Set(c.origenes.map((x) => x.origen))) porOrigen.set(o, (porOrigen.get(o) ?? 0) + 1);
  const anuncios = new Map<string, { anuncio: string; formulario: string | null; n: number }>();
  for (const c of contactos) {
    const vistos = new Set<string>();
    for (const o of c.origenes) {
      if (o.origen !== 'meta') continue;
      const k = `${o.anuncio ?? '(sin anuncio)'}\u0001${o.formulario ?? ''}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      const e = anuncios.get(k) ?? { anuncio: o.anuncio ?? '(sin anuncio)', formulario: o.formulario, n: 0 };
      e.n++;
      anuncios.set(k, e);
    }
  }
  const colonias = new Map<string, { colonia: string; n: number }>();
  for (const k of contactos) {
    for (const col of k.colonias) {
      const clave = normalizarTexto(col);
      const e = colonias.get(clave) ?? { colonia: col, n: 0 };
      e.n++;
      if (col < e.colonia) e.colonia = col;
      colonias.set(clave, e);
    }
  }
  const etiquetas = contar(contactos.flatMap((c) => c.etiquetas.map((e) => ({ e }))), (x) => x.e);
  const todosTelefonos = new Set(contactos.flatMap((c) => c.telefonos));
  const conCorreo = contactos.filter((c) => c.correos.length > 0).length;
  return {
    por_archivo: lecturas.map((l) => ({ archivo: l.archivo, tipo: l.tipo, filas: l.filas, con_telefono_valido: l.registros.length, descartes: l.descartes, extranjeros: l.extranjeros, sin_lada: l.sin_lada })),
    totales: {
      filas,
      registros_validos: validos,
      contactos_unicos: contactos.length,
      duplicados_eliminados: validos - contactos.length,
      telefonos_unicos: todosTelefonos.size,
      con_correo: conCorreo,
      sin_correo: contactos.length - conCorreo,
      invalidos,
      telefonos_sin_lada: [...todosTelefonos].filter(esSinLada).length,
      unidos_por_correo_y_nombre: unidosPorCorreoYNombre,
      correo_compartido_nombre_distinto: contactos.filter((c) => c.correo_compartido).length,
      con_colonia: contactos.filter((k) => k.colonias.length > 0).length,
      colonias_distintas: colonias.size,
      colonia_en_conflicto: contactos.filter((k) => k.colonia_conflicto).length,
    },
    por_origen: [...porOrigen].map(([origen, contactosN]) => ({ origen, contactos: contactosN })).sort((a, b) => b.contactos - a.contactos || cmp(a.origen, b.origen)),
    por_anuncio: [...anuncios.values()].map((a) => ({ anuncio: a.anuncio, formulario: a.formulario, contactos: a.n })).sort((a, b) => b.contactos - a.contactos || cmp(a.anuncio, b.anuncio)),
    por_colonia: [...colonias.values()].map((e) => ({ colonia: e.colonia, contactos: e.n })).sort((a, b) => b.contactos - a.contactos || cmp(a.colonia, b.colonia)),
    etiquetas: [...etiquetas].map(([etiqueta, contactosN]) => ({ etiqueta, contactos: contactosN })).sort((a, b) => b.contactos - a.contactos || cmp(a.etiqueta, b.etiqueta)),
  };
}

export function sumarDescartes(a: Descartes, b: Descartes): Descartes {
  const r = descartesVacios();
  for (const k of Object.keys(r) as Array<keyof Descartes>) r[k] = a[k] + b[k];
  return r;
}
