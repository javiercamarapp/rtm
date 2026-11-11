// Arma el PLAN de importacion a partir de las listas ya leidas. Puro y determinista: mismo insumo, mismo plan.
// Reglas del dueno (10-nov-2026): NO hay equivalencias entre las listas de Javier y de Angelo salvo las que el dueno decidio una por una;
// el catalogo unifica solo nombres identicos tras normalizar; "fuera de catalogo" = sin disponibilidad ahora (reversible).
import { normalizar } from '../catalogo/normalizar';
import { formatearMoneda } from '../formato';
import { ALIAS_MODELOS_ANGELO, MARCAS, type ReglaAlias } from './alias_angelo';
import type { CostoKaren, Decisiones, ListaAngelo, ListaJavier, Plan, PlanAlias, PlanCliente, PlanCosto, PlanHistorico, PlanModelo, PlanPrecio } from './tipos';

export const DESDE = '2026-11-10';
export const FUENTE_ISAAC = 'documento_angelo_2026-11-10';
export const FUENTE_KAREN = 'chat_dueno_2026-11-10_supuesto';

export function marcaDe(nombre: string): string {
  const n = normalizar(nombre);
  return MARCAS.find((m) => n === normalizar(m) || n.startsWith(`${normalizar(m)} `)) ?? 'Sin marca';
}
export function puffsDe(nombre: string): number | null {
  const m = /(\d+)\s*k\b/i.exec(nombre);
  return m ? Number(m[1]) * 1000 : null;
}

export interface Verificacion {
  costosIsaac: number;
  clientesAngelo: number;
  lineasAngelo: number;
  margenesCero: number;
  margenesQueNoCuadran: string[];
  costosQueNoCoinciden: string[];
  clientesJavier: number;
  lineasJavier: number;
  costosKaren: number;
  totalesPorCliente: { cliente: string; lineas: number; sumaPrecios: bigint; sumaMargenes: bigint }[];
}

export interface Resultado { plan: Plan; verificacion: Verificacion }

export function construirPlan(angelo: ListaAngelo, javier: ListaJavier, karen: CostoKaren[], dec: Decisiones, reglasAlias: readonly ReglaAlias[] = ALIAS_MODELOS_ANGELO): Resultado {
  const conflictos: string[] = [];
  const advertencias: string[] = [...javier.advertencias];
  const costoIsaac = new Map(angelo.costos.map((c) => [normalizar(c.modelo), c.costo]));
  const nombreAngelo = new Map(angelo.costos.map((c) => [normalizar(c.modelo), c.modelo]));

  // --- Modelos ---------------------------------------------------------------------------------------------------------
  const modelos: PlanModelo[] = angelo.costos.map((c) => ({ marca: marcaDe(c.modelo), nombre: c.modelo, puffs: puffsDe(c.modelo), lista: 'angelo', estado: 'disponible' }));
  const equiv = new Map(dec.equivalencias.map((e) => [normalizar(e.nombre), e.modelo]));
  const nombreJavier = (n: string): string => equiv.get(normalizar(n)) ?? n;
  const nombresJavier = new Map<string, string>();
  const verNombre = (n: string) => { const f = nombreJavier(n); if (!nombresJavier.has(normalizar(f))) nombresJavier.set(normalizar(f), f); };
  for (const c of javier.clientes) for (const p of c.precios) verNombre(p.modelo);
  for (const k of karen) verNombre(k.modelo);
  if (javier.nexa.length > 0) verNombre('Nexa 50K');
  for (const [norm, nombre] of nombresJavier) modelos.push({ marca: marcaDe(nombre), nombre: nombreAngelo.get(norm) ?? nombre, puffs: puffsDe(nombre), lista: 'javier', estado: 'disponible' });
  const comunes = [...nombresJavier.keys()].filter((n) => nombreAngelo.has(n));

  // Disponibilidad: "fuera de catalogo" = sin disponibilidad ahora. Coincidencia por prefijo UNICO dentro de los nombres del documento.
  const sinDisponibilidad: string[] = [];
  for (const f of angelo.fueraDeCatalogo) {
    const c = [...nombreAngelo].filter(([n]) => n === normalizar(f) || n.startsWith(`${normalizar(f)} `));
    if (c.length === 1) sinDisponibilidad.push(c[0]![1]);
    else advertencias.push(`Fuera de catalogo "${f}": ${c.length === 0 ? 'no coincide con ningun modelo' : 'coincide con varios modelos'}; no se marca`);
  }

  // --- Alias de modelos (solo dentro de la lista de Angelo) -----------------------------------------------------------------
  const todosNorm = new Map<string, string>([...nombreAngelo, ...nombresJavier]);
  const aliasModelo: PlanAlias[] = [];
  for (const r of reglasAlias) {
    for (const d of r.destinos) if (!nombreAngelo.has(normalizar(d))) throw new Error(`Alias "${r.alias}": el destino "${d}" no existe en la tabla de costos del documento`);
    const choque = todosNorm.get(normalizar(r.alias));
    if (choque && !r.destinos.some((d) => normalizar(d) === normalizar(choque))) {
      aliasModelo.push({ alias: r.alias, destinos: [...r.destinos, choque], porConfirmar: true, nota: `${r.nota}. Choca con un modelo de la lista de Javier: se pregunta.` });
    } else if (choque && r.destinos.length === 1 && normalizar(r.destinos[0]!) === normalizar(choque)) {
      continue; // el alias ya es el nombre del modelo
    } else {
      aliasModelo.push({ alias: r.alias, destinos: r.destinos, porConfirmar: false, nota: r.nota });
    }
  }

  // --- Clientes ----------------------------------------------------------------------------------------------------------
  const completo = (n: string) => dec.nombre_completo[n] ?? n;
  const clientes: PlanCliente[] = [];
  const aliasCliente: PlanAlias[] = [];
  for (const c of angelo.clientes) {
    const nombre = completo(c.nombre);
    clientes.push({ nombre, duenio: 'Angelo', tipo: angelo.ocasionales.some((o) => normalizar(o) === normalizar(c.nombre)) ? 'ocasional' : 'mayoreo', nota: null });
    if (nombre !== c.nombre) aliasCliente.push({ alias: c.nombre, destinos: [nombre], porConfirmar: false, nota: 'Nombre corto de la lista de Angelo; nombre completo decidido por el dueno' });
  }
  const enAngelo = new Set(clientes.map((c) => normalizar(c.nombre)));
  for (const c of javier.clientes) {
    if (enAngelo.has(normalizar(c.nombre))) { conflictos.push(`Cliente "${c.nombre}" esta en las dos listas: el dueno decide cual manda`); continue; }
    const esBodega = dec.persona_bodega !== null && normalizar(c.nombre) === normalizar(dec.persona_bodega);
    clientes.push({
      nombre: c.nombre, duenio: 'Javier', tipo: esBodega ? 'credito_interno' : 'mayoreo',
      nota: c.descartada ? `Lista anterior de precios DESCARTADA por el dueno el ${DESDE} (no era su precio; coincidia con costos de Isaac): ${c.descartada}` : null,
    });
    for (const a of c.alias) aliasCliente.push({ alias: a, destinos: [c.nombre], porConfirmar: false, nota: 'Alias dado en la lista de Javier y confirmado por el dueno' });
  }
  for (const a of angelo.aliasCliente) {
    const n = (x: string) => normalizar(completo(x));
    const destino = clientes.find((c) => n(c.nombre) === n(a.destino) || normalizar(c.nombre) === normalizar(a.destino)) ?? clientes.find((c) => normalizar(c.nombre) === normalizar(a.alias));
    if (!destino) { advertencias.push(`Alias de cliente "${a.alias} = ${a.destino}": ningun lado es un cliente`); continue; }
    const otro = normalizar(destino.nombre) === normalizar(a.alias) ? a.destino : a.alias;
    aliasCliente.push({ alias: otro, destinos: [destino.nombre], porConfirmar: false, nota: 'Alias del documento de Angelo' });
  }
  for (const a of dec.alias_confirmados) aliasCliente.push({ alias: a.alias, destinos: [a.cliente], porConfirmar: false, nota: 'Confirmado por el dueno' });
  // "Omar" a secas: ambiguo entre quien presta la bodega y cualquier otro cliente con ese primer nombre (la especificacion manda: se pregunta).
  const personaBodega = dec.persona_bodega ? clientes.find((c) => normalizar(c.nombre) === normalizar(dec.persona_bodega!)) ?? null : null;
  if (personaBodega) {
    const primero = normalizar(personaBodega.nombre).split(' ')[0]!;
    const iguales = clientes.filter((c) => normalizar(c.nombre).split(' ')[0] === primero);
    if (iguales.length >= 2) aliasCliente.push({ alias: primero, destinos: iguales.map((c) => c.nombre), porConfirmar: false, nota: 'Nombre a secas ambiguo: quien presta la bodega o un cliente. Siempre se pregunta.' });
  }
  const destinos = angelo.destinosCliente.flatMap((d) => d.etiquetas.map((e) => ({ cliente: completo(d.cliente), etiqueta: e, zona: (/m[eé]rida/i.test(e) ? 'merida' : 'fuera') as 'merida' | 'fuera' })));

  // --- Costos -----------------------------------------------------------------------------------------------------------
  const costos: PlanCosto[] = angelo.costos.map((c) => ({ proveedor: 'Isaac', modelo: c.modelo, centavos: c.costo, desde: DESDE, fuente: FUENTE_ISAAC, supuesto: false }));
  for (const k of karen) costos.push({ proveedor: 'Karen', modelo: nombreAngelo.get(normalizar(nombreJavier(k.modelo))) ?? nombreJavier(k.modelo), centavos: k.costo, desde: DESDE, fuente: FUENTE_KAREN, supuesto: true });
  const karenPorModelo = new Map(costos.filter((c) => c.proveedor === 'Karen').map((c) => [normalizar(c.modelo), c.centavos]));

  // --- Precios de Angelo (con verificacion: margen = precio - costo) ---------------------------------------------------------
  const precios: PlanPrecio[] = [];
  const historicos: PlanHistorico[] = [];
  const noCuadran: string[] = [];
  const noCoinciden: string[] = [];
  let ceros = 0;
  let lineasAngelo = 0;
  const totales: Verificacion['totalesPorCliente'] = [];
  for (const c of angelo.clientes) {
    const cliente = completo(c.nombre);
    let sumaP = 0n, sumaM = 0n;
    for (const l of c.lineas) {
      const k = normalizar(l.modelo);
      const costo = costoIsaac.get(k);
      if (costo === undefined) throw new Error(`${c.nombre}: el modelo "${l.modelo}" no esta en la tabla de costos de Isaac`);
      if (costo !== l.costoDoc) noCoinciden.push(`${c.nombre} / ${l.modelo}: costo del renglon ${formatearMoneda(l.costoDoc)} contra tabla ${formatearMoneda(costo)}`);
      if (l.precio - costo !== l.margenDoc) noCuadran.push(`${c.nombre} / ${l.modelo}: margen del documento ${formatearMoneda(l.margenDoc)} contra precio menos costo ${formatearMoneda(l.precio - costo)}`);
      if (l.precio - costo === 0n) ceros += 1;
      sumaP += l.precio; sumaM += l.precio - costo;
      lineasAngelo += 1;
      precios.push({ cliente, modelo: nombreAngelo.get(k)!, centavos: l.precio, desde: DESDE, origen: 'documento', nota: null });
    }
    totales.push({ cliente, lineas: c.lineas.length, sumaPrecios: sumaP, sumaMargenes: sumaM });
  }

  // --- Precios de Javier -----------------------------------------------------------------------------------------------------
  const filasJ = new Map<string, { modelo: string; centavos: bigint; nota: string | null }[]>();
  const poner = (cliente: string, modelo: string, centavos: bigint, nota: string | null) => {
    const f = filasJ.get(cliente) ?? [];
    const norm = normalizar(nombreJavier(modelo));
    const nombre = nombreAngelo.get(norm) ?? nombresJavier.get(norm) ?? nombreJavier(modelo);
    const previa = f.find((x) => normalizar(x.modelo) === norm);
    if (!previa) f.push({ modelo: nombre, centavos, nota });
    else if (previa.centavos === centavos) previa.nota = previa.nota ?? nota;
    else {
      conflictos.push(`${cliente} / ${nombre}: dos precios en la lista de Javier (${formatearMoneda(previa.centavos)} y ${formatearMoneda(centavos)}); manda el primero y el otro queda como historial`);
      historicos.push({ cliente, modelo: nombre, centavos, origen: 'lista_javier', nota: 'Segundo precio de la misma lista, no vigente' });
    }
    filasJ.set(cliente, f);
  };
  let lineasJ = 0;
  for (const c of javier.clientes) {
    const cli = clientes.find((x) => normalizar(x.nombre) === normalizar(c.nombre) && x.duenio === 'Javier');
    if (!cli) continue;
    if (dec.mismo_tabulador[cli.nombre]) continue; // lleva el tabulador de otro cliente (copia mas abajo)
    for (const p of c.precios) poner(cli.nombre, p.modelo, p.precio, null);
  }
  for (const n of javier.nexa) if (!dec.mismo_tabulador[n.cliente]) poner(n.cliente, 'Nexa 50K', n.precio, null);
  // "Mismo tabulador que otro cliente": COPIA con origen marcado (no referencia viva), para que cada uno pueda divergir con su propio historial.
  for (const [cliente, ref] of Object.entries(dec.mismo_tabulador)) {
    const origen = filasJ.get(clientes.find((x) => normalizar(x.nombre) === normalizar(ref))?.nombre ?? ref);
    if (!origen) throw new Error(`${cliente}: el cliente de referencia "${ref}" no tiene tabulador`);
    const nota = `Mismo tabulador que ${ref} por decision del dueno (copia con origen marcado; puede cambiar por separado)`;
    filasJ.set(cliente, origen.map((f) => ({ modelo: f.modelo, centavos: f.centavos, nota })));
  }
  const listasSinDuenio: Plan['listasSinDuenio'] = [];
  if (javier.archivoSinAsignar) {
    const archivo = javier.archivos[javier.archivoSinAsignar];
    if (archivo) listasSinDuenio.push({ referencia: javier.archivoSinAsignar, origen: 'Archivo de texto de Descargas; el dueno no sabe de quien es (10-nov-2026)', filas: archivo.map((a) => ({ modelo: a.modelo, centavos: a.precio })) });
    else advertencias.push(`El archivo ${javier.archivoSinAsignar} no existe en este equipo`);
  }
  for (const [cliente, filas] of filasJ) {
    let sumaP = 0n, sumaM = 0n, n = 0;
    for (const f of filas) {
      precios.push({ cliente, modelo: f.modelo, centavos: f.centavos, desde: DESDE, origen: 'lista_javier', nota: f.nota });
      lineasJ += 1; n += 1; sumaP += f.centavos;
      const k = karenPorModelo.get(normalizar(f.modelo));
      if (k !== undefined) sumaM += f.centavos - k;
    }
    totales.push({ cliente, lineas: n, sumaPrecios: sumaP, sumaMargenes: sumaM });
  }

  // Modelos comunes a las dos listas: informar costos distintos (proveedores distintos o el mismo).
  for (const n of comunes) {
    const i = costoIsaac.get(n); const k = karenPorModelo.get(n);
    if (i !== undefined && k !== undefined && i !== k) conflictos.push(`${nombreAngelo.get(n)}: nombre identico en las dos listas con costo de Isaac ${formatearMoneda(i)} y de Karen ${formatearMoneda(k)} (proveedores distintos; se importan ambos)`);
  }

  const plan: Plan = { modelos, aliasModelo, clientes, personaBodega: personaBodega ? { cliente: personaBodega.nombre, nombre: personaBodega.nombre } : null, aliasCliente: dedupAlias(aliasCliente), destinos, costos, precios, historicos, listasSinDuenio, sinDisponibilidad, conflictos, advertencias };
  const verificacion: Verificacion = {
    costosIsaac: angelo.costos.length, clientesAngelo: angelo.clientes.length, lineasAngelo, margenesCero: ceros, margenesQueNoCuadran: noCuadran, costosQueNoCoinciden: noCoinciden,
    clientesJavier: [...filasJ.keys()].length, lineasJavier: lineasJ, costosKaren: karen.length, totalesPorCliente: totales,
  };
  return { plan, verificacion };
}

function dedupAlias(a: PlanAlias[]): PlanAlias[] {
  const visto = new Map<string, PlanAlias>();
  for (const x of a) { const k = normalizar(x.alias); if (!visto.has(k)) visto.set(k, x); }
  return [...visto.values()];
}
