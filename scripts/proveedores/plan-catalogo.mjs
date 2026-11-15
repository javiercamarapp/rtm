// Planificador PURO (sin red ni base) para registrar en el catalogo propio los modelos y sabores que ve un proveedor (Karen: tienda; Isaac: catalogo Remate).
// Reglas del dueno: marcas, modelos y sabores en MAYUSCULAS (solo presentacion); los IGUALES se fusionan; los PARECIDOS se preguntan (nunca se unifican ni se asignan solos).
// Un modelo se registra solo si es 'nuevo' (sin parecido en el catalogo) o se reutiliza si 'coincide'. Todo lo dudoso queda en `porConfirmar` y NO se toca.
// Jamas se leen ni se guardan precios.
import { compacta, conciliar, puffsDe } from './conciliar-marcas.mjs';

/** '35K' -> 35000; '5000' -> 5000; '50,000' -> 50000; sin cifra -> null. */
export function puffsExactos(t) {
  const s = String(t ?? '').toLowerCase().replace(/(\d),(\d{3})\b/g, '$1$2');
  const k = s.match(/\b(\d{1,3})\s*k\b/);
  if (k) return Number(k[1]) * 1000;
  const n = s.match(/\b(\d{3,6})\b/);
  return n ? Number(n[1]) : null;
}

/** Nombre canonico de un modelo nuevo: '50,000' -> '50K' (convencion del catalogo), espacios limpios. */
export function nombreModelo(titulo) {
  return String(titulo ?? '').replace(/\b(\d{1,3}),000\b/g, '$1K').replace(/\s+/g, ' ').trim();
}

/** Clave de la linea sin marca ni espacios: 'EBDESIGN TE6000' y 'Elf Bar TE6000' comparten 'te6000' (otra marca, misma linea: se pregunta). */
export function claveLinea(titulo, marca) {
  const t = compacta(nombreModelo(titulo));
  const m = compacta(marca);
  return m && t.startsWith(m) ? t.slice(m.length) : t;
}

function aItemTienda(it) {
  return { handle: it.clave, title: it.titulo, vendor: it.marca, variants: it.sabores.map((s) => ({ available: s.disponible !== false, title: s.nombre })) };
}

/**
 * `items`: [{ clave, titulo, marca, puffs?, sabores: [{ nombre, disponible }] }]. `catalogo`: [{ id, marca, n, al }] (modelos vigentes).
 * `modo`: 'karen' respeta la conciliacion tal cual; 'isaac' ademas trata como modelos distintos los que tienen puffs explicitos diferentes.
 * Devuelve { coincide: [{item, modeloId, via}], nuevo: [item], porConfirmar: [{item, candidatos, motivo}] }.
 */
export function planificar(items, catalogo, { aliasWaka = new Map(), propuestas = new Map(), modo = 'karen', ligaduras = new Map(), altas = new Map() } = {}) {
  const porId = new Map(catalogo.map((m) => [m.id, m]));
  const coincide = [], nuevo = [], porConfirmar = [];
  const lineasCatalogo = catalogo.map((m) => ({ m, linea: claveLinea(m.n, m.marca) }));
  for (const it of items) {
    const r = conciliar([aItemTienda(it)], catalogo, aliasWaka, propuestas);
    // Ligadura confirmada por el dueno (handle de la tienda -> id del catalogo): se concilia contra ese modelo, sin crear ni unificar nada.
    const alta = altas.get(it.clave);
    if (alta) { nuevo.push({ ...it, titulo: alta.nombre, puffs: alta.puffs, forzarNuevo: true, ligarHandle: it.clave }); continue; }
    const lig = ligaduras.get(it.clave);
    if (lig && porId.has(lig.catalogoId)) { coincide.push({ item: it, modeloId: lig.catalogoId, via: 'ligadura del dueno', ligadura: lig }); continue; }
    // Decision explicita del dueno: modelo aparte. Solo se reutiliza si el nombre ya existe tal cual.
    if (it.forzarNuevo) {
      const igual = catalogo.find((m) => compacta(m.n) === compacta(nombreModelo(it.titulo)));
      if (igual) coincide.push({ item: it, modeloId: igual.id, via: 'nombre exacto' }); else nuevo.push(it);
      continue;
    }
    if (r.coinciden.length === 1) { coincide.push({ item: it, modeloId: r.coinciden[0].m.id, via: 'exacto' }); continue; }
    if (r.alias.length === 1) {
      const a = r.alias[0];
      if (a.extra?.length) porConfirmar.push({ item: it, candidatos: [a.m, ...a.extra].map((m) => m.id), motivo: 'varios modelos del catalogo para el mismo producto' });
      else coincide.push({ item: it, modeloId: a.m.id, via: a.via });
      continue;
    }
    const exactos = it.puffs ?? puffsExactos(it.titulo);
    let candidatos = [];
    let motivo = '';
    if (r.dudosos.length === 1) { candidatos = r.dudosos[0].candidatos; motivo = r.dudosos[0].motivo; }
    // Isaac: puffs explicitos y distintos = producto distinto (Lost Mary 5000 no es Lost Mary 35K).
    if (modo === 'isaac' && candidatos.length && exactos) {
      const mismoNombre = candidatos.filter((m) => { const pe = puffsExactos(m.n); return pe === null || pe === exactos; });
      candidatos = mismoNombre;
    }
    // Misma linea con otra marca (EBDESIGN TE6000 contra Elf Bar TE6000): se pregunta.
    const kl = claveLinea(it.titulo, it.marca);
    if (!candidatos.length && kl.length >= 4) {
      const hermanos = lineasCatalogo.filter((x) => x.linea === kl && compacta(x.m.marca) !== compacta(it.marca)).map((x) => x.m);
      if (hermanos.length) { candidatos = hermanos; motivo = 'misma linea con otra marca'; }
    }
    if (candidatos.length) { porConfirmar.push({ item: it, candidatos: candidatos.map((m) => m.id), motivo }); continue; }
    // Sin puffs conocidos y misma marca ya existente con otra linea: no es el mismo, pero un modelo sin puffs choca con cualquiera de su marca.
    if (modo === 'isaac' && !exactos) {
      const mismos = catalogo.filter((m) => compacta(m.marca) === compacta(it.marca));
      if (mismos.length) { porConfirmar.push({ item: it, candidatos: mismos.map((m) => m.id), motivo: 'modelo sin puffs en una marca que ya existe' }); continue; }
    }
    nuevo.push(it);
  }
  return { coincide, nuevo, porConfirmar };
}

/** Sabores unicos de un item, en el orden dado; los repetidos exactos del mismo modelo se juntan. */
export function saboresUnicos(item) {
  const vistos = new Map();
  for (const s of item.sabores) {
    const k = compacta(s.nombre);
    if (!k) continue;
    const previo = vistos.get(k);
    vistos.set(k, previo ? { ...previo, disponible: previo.disponible || s.disponible !== false } : { nombre: s.nombre.replace(/\s+/g, ' ').trim(), disponible: s.disponible !== false });
  }
  return [...vistos.values()];
}

/** Items a partir del JSON de la tienda (products.json): solo titulo, marca, identificador y sabores con su disponibilidad. Nunca precios. */
export function itemsDeTienda(productos) {
  return productos.map((p) => ({
    clave: p.handle,
    titulo: p.title,
    marca: String(p.vendor ?? ''),
    puffs: puffsExactos(p.title),
    sabores: (p.variants ?? []).map((v) => ({ nombre: String(v.title ?? v.option1 ?? ''), disponible: v.available === true })),
  }));
}

/** Items a partir de scripts/catalogo/isaac-remate.json: todo lo que trae el catalogo Remate cuenta como disponible. */
export function itemsDeIsaac(json) {
  return json.modelos.map((m) => ({
    clave: compacta(m.titulo), titulo: m.titulo, marca: m.marca, puffs: m.puffs ?? null,
    sabores: m.sabores.map((s) => ({ nombre: s, disponible: true })),
    ...(m.forzar_nuevo ? { forzarNuevo: true } : {}), ...(m.costo_isaac_mxn ? { costoMxn: m.costo_isaac_mxn } : {}),
  }));
}

export { puffsDe };
