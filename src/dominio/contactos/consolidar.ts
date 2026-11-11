// Deduplicacion por telefono (y por correo si existe) conservando todos los origenes, etiquetas y lotes. Determinista e idempotente.
import type { ContactoConsolidado, Descartes, InformeContactos, OrigenContacto, RegistroLeido, ResultadoLectura } from './tipos';
import { descartesVacios } from './leer';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const unicos = (xs: string[]) => [...new Set(xs)].sort(cmp);
const claveOrigen = (o: OrigenContacto) => [o.origen, o.anuncio ?? '', o.formulario ?? '', o.campana ?? ''].join('\u0001');

/** Une registros que comparten telefono o correo (cierre transitivo). El orden de entrada no cambia el resultado. */
export function consolidar(registros: RegistroLeido[]): ContactoConsolidado[] {
  // Orden canonico de entrada: el resultado no depende del orden de los archivos.
  const lista = [...registros].sort((a, b) => cmp(a.telefonos[0] ?? '', b.telefonos[0] ?? '') || cmp(a.archivo, b.archivo) || cmp(a.nombre, b.nombre) || cmp(a.correos.join(), b.correos.join()));
  const padre = lista.map((_, i) => i);
  const raiz = (i: number): number => { while (padre[i] !== i) { padre[i] = padre[padre[i]!]!; i = padre[i]!; } return i; };
  const unir = (a: number, b: number) => { const ra = raiz(a); const rb = raiz(b); if (ra !== rb) padre[Math.max(ra, rb)] = Math.min(ra, rb); };
  const dueno = new Map<string, number>();
  lista.forEach((r, i) => {
    for (const k of [...r.telefonos.map((t) => `t:${t}`), ...r.correos.map((c) => `c:${c}`)]) {
      const previo = dueno.get(k);
      if (previo === undefined) dueno.set(k, i);
      else unir(previo, i);
    }
  });
  const grupos = new Map<number, RegistroLeido[]>();
  lista.forEach((r, i) => { const g = raiz(i); (grupos.get(g) ?? grupos.set(g, []).get(g)!).push(r); });
  const salida: ContactoConsolidado[] = [];
  for (const miembros of grupos.values()) {
    const telefonos = unicos(miembros.flatMap((m) => m.telefonos));
    const origenes = new Map<string, OrigenContacto>();
    for (const m of miembros) for (const o of m.origenes) origenes.set(claveOrigen(o), o);
    // Nombre: el mas largo (mas informacion); empate por orden alfabetico.
    const nombre = miembros.map((m) => m.nombre).filter((n) => n !== '').sort((a, b) => b.length - a.length || cmp(a, b))[0] ?? '';
    salida.push({
      telefono: telefonos[0]!,
      nombre,
      telefonos,
      correos: unicos(miembros.flatMap((m) => m.correos)),
      etiquetas: unicos(miembros.flatMap((m) => m.etiquetas)),
      lotes: unicos(miembros.map((m) => m.archivo)),
      origenes: [...origenes.values()].sort((a, b) => cmp(claveOrigen(a), claveOrigen(b))),
      tipo: 'menudeo',
    });
  }
  return salida.sort((a, b) => cmp(a.telefono, b.telefono));
}

function sumar(a: Descartes, b: Descartes): Descartes {
  const r = descartesVacios();
  for (const k of Object.keys(r) as Array<keyof Descartes>) r[k] = a[k] + b[k];
  return r;
}

function contar<T>(items: T[], clave: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) { const k = clave(it); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}

/** Informe de conteos SIN datos personales: nada de telefonos, correos ni nombres. */
export function construirInforme(lecturas: ResultadoLectura[], contactos: ContactoConsolidado[]): InformeContactos {
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
  const etiquetas = contar(contactos.flatMap((c) => c.etiquetas.map((e) => ({ e }))), (x) => x.e);
  const telefonosUnicos = new Set(contactos.flatMap((c) => c.telefonos)).size;
  const conCorreo = contactos.filter((c) => c.correos.length > 0).length;
  return {
    por_archivo: lecturas.map((l) => ({ archivo: l.archivo, tipo: l.tipo, filas: l.filas, con_telefono_valido: l.registros.length, descartes: l.descartes, extranjeros: l.extranjeros })),
    totales: {
      filas,
      registros_validos: validos,
      contactos_unicos: contactos.length,
      duplicados_eliminados: validos - contactos.length,
      telefonos_unicos: telefonosUnicos,
      con_correo: conCorreo,
      sin_correo: contactos.length - conCorreo,
      invalidos,
    },
    por_origen: [...porOrigen].map(([origen, contactosN]) => ({ origen, contactos: contactosN })).sort((a, b) => b.contactos - a.contactos || cmp(a.origen, b.origen)),
    por_anuncio: [...anuncios.values()].map((a) => ({ anuncio: a.anuncio, formulario: a.formulario, contactos: a.n })).sort((a, b) => b.contactos - a.contactos || cmp(a.anuncio, b.anuncio)),
    etiquetas: [...etiquetas].map(([etiqueta, contactosN]) => ({ etiqueta, contactos: contactosN })).sort((a, b) => b.contactos - a.contactos || cmp(a.etiqueta, b.etiqueta)),
  };
}

export { sumar as sumarDescartes };
