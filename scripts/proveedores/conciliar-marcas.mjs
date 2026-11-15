#!/usr/bin/env node
// Conciliacion marca/modelo entre el catalogo propio y lo que muestra la tienda del proveedor (Karen).
// SOLO LECTURA: no escribe en la base ni unifica nada. Lo dudoso se reporta para la cola de 'por confirmar'.
//
//   node scripts/proveedores/conciliar-marcas.mjs --tienda=<products.json> --catalogo=<catalogo.json> [--md=<salida.md>]
//
// --tienda: lista de productos de la tienda (la que baja el vigilante; se guarda FUERA del repo). --catalogo: [{id, marca, n, al:[alias]}] leido de catalogo.modelo.
// Del producto de la tienda solo se usa titulo, marca (vendor), identificador y cuantos sabores hay disponibles. Jamas precios. La direccion de la tienda no aparece en la salida.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const plano = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const compacta = (t) => plano(t).replace(/[^a-z0-9]+/g, '');

/** '50,000' -> 50 (miles de puffs); '40K' -> 40; sin cifra -> null. */
export function puffsDe(t) {
  const s = plano(t).replace(/(\d),(\d{3})\b/g, '$1$2');
  const k = s.match(/\b(\d{1,3})\s*k\b/);
  if (k) return Number(k[1]);
  const n = s.match(/\b(\d{4,6})\b/);
  return n ? Math.round(Number(n[1]) / 1000) : null;
}

const RUIDO = new Set(['de', 'el', 'la', 'puffs', 'caladas', 'vape']);
/** Palabras de la linea: sin marca, sin cifras de puffs, sin ruido. */
export function lineaDe(titulo, marca) {
  const mc = compacta(marca);
  let s = plano(titulo).replace(/(\d),(\d{3})\b/g, '$1$2').replace(/\b\d{1,3}\s*k\b/g, ' ').replace(/\b\d{4,6}\b/g, ' ');
  // quita la marca aunque venga partida ('elf bar' vs 'elfbar')
  const palabras = s.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const salida = [];
  let acum = '';
  for (const p of palabras) {
    if (RUIDO.has(p)) continue;
    if (mc && (mc.startsWith(acum + p)) && (acum + p).length <= mc.length) { acum += p; if (acum === mc) acum = ''; continue; }
    acum = '';
    salida.push(p);
  }
  return salida;
}

const igual = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Diccionario de alias Waka: nombre de linea -> puffs oficiales (miles). */
export function cargarAliasWaka(ruta) {
  const j = JSON.parse(readFileSync(ruta, 'utf8'));
  const mapa = new Map();
  for (const a of j.alias) mapa.set(plano(a.alias).replace(/^waka\s+/, '').trim(), Number((a.puffs_oficial.match(/(\d+)K/i) ?? [])[1] ?? 0) || null);
  return mapa;
}

/** `propuestas`: id de modelo -> marca propuesta para los que hoy son 'Sin marca' (scripts/catalogo/marcas-modelos.json). Solo sirve para comparar; no asigna nada. */
export function conciliar(tienda, catalogo, aliasWaka = new Map(), propuestas = new Map()) {
  const cat = catalogo.map((m) => {
    const marcaEf = m.marca === 'Sin marca' ? (propuestas.get(m.id) ?? '') : m.marca;
    return { ...m, marcaEf, marcaC: compacta(marcaEf), puffs: puffsDe(m.n), linea: lineaDe(m.n, marcaEf) };
  });
  const items = tienda.map((p) => {
    const marca = String(p.vendor ?? '');
    const linea = lineaDe(p.title, marca);
    const variantes = Array.isArray(p.variants) ? p.variants : [];
    return { handle: p.handle, titulo: p.title, marca, marcaC: compacta(marca), puffs: puffsDe(p.title), linea, disp: variantes.filter((v) => v.available).length, total: variantes.length };
  });
  const usados = new Set();
  const coinciden = [], alias = [], dudosos = [], soloTienda = [];
  for (const t of items) {
    const mismos = cat.filter((m) => m.marcaC === t.marcaC);
    let hit = mismos.find((m) => igual(m.linea, t.linea) && m.puffs === t.puffs);
    if (hit) { usados.add(hit.id); coinciden.push({ t, m: hit }); continue; }
    // alias: diccionario Waka (linea de socios = nombre por puffs), alias propios del catalogo o misma marca y puffs con otra linea
    const puffsAlias = t.marcaC === 'waka' ? aliasWaka.get(t.linea.join(' ')) ?? null : null;
    const objetivo = puffsAlias ?? t.puffs;
    const porAlias = mismos.find((m) => (m.al ?? []).some((a) => compacta(a) === compacta(`${t.marca} ${t.linea.join(' ')} ${t.puffs ?? ''}`) || compacta(a) === compacta(t.titulo)));
    if (porAlias) { usados.add(porAlias.id); alias.push({ t, m: porAlias, via: 'alias del catalogo' }); continue; }
    const candidatos = mismos.filter((m) => objetivo !== null && m.puffs === objetivo);
    if (puffsAlias !== null && candidatos.length) {
      for (const c of candidatos) usados.add(c.id);
      alias.push({ t, m: candidatos[0], extra: candidatos.slice(1), via: `diccionario Waka (${t.linea.join(' ')} = ${puffsAlias}K)` });
      continue;
    }
    const mismaLinea = mismos.filter((m) => igual(m.linea, t.linea));
    const parecida = mismos.filter((m) => m.linea.length && t.linea.length && (m.linea.every((x) => t.linea.includes(x)) || t.linea.every((x) => m.linea.includes(x))) && !igual(m.linea, t.linea));
    if (candidatos.length || mismaLinea.length || parecida.length) {
      const todos = [...new Map([...candidatos, ...mismaLinea, ...parecida].map((m) => [m.id, m])).values()];
      dudosos.push({ t, candidatos: todos, motivo: mismaLinea.length ? 'misma linea con otros puffs o sin puffs en el catalogo' : candidatos.length ? 'misma marca y puffs con otro nombre de linea' : 'nombre de linea parecido' });
      continue;
    }
    soloTienda.push({ t, marcaConocida: mismos.length > 0 || cat.some((m) => m.marcaC === t.marcaC) });
  }
  const idsDudosos = new Set(dudosos.flatMap((d) => d.candidatos.map((m) => m.id)));
  const soloCatalogo = cat.filter((m) => !usados.has(m.id) && !idsDudosos.has(m.id));
  return { coinciden, alias, dudosos, soloTienda, soloCatalogo, totalTienda: items.length, totalCatalogo: cat.length };
}

const fila = (...c) => `| ${c.join(' | ')} |`;
export function aMarkdown(r, fecha) {
  const L = [];
  L.push('# Conciliacion de marcas y modelos: catalogo propio contra la tienda de Karen', '');
  L.push(`Lectura del ${fecha}. Solo lectura: no se unifico ni se asigno nada. Todo lo dudoso va a la cola de "por confirmar" para que un socio decida. La direccion de la tienda es privada y no aparece aqui; tampoco hay precios.`, '');
  L.push(`Resumen: ${r.totalTienda} modelos en la tienda y ${r.totalCatalogo} en el catalogo.`, '');
  L.push(fila('Grupo', 'Cuantos'), fila('---', '---'), fila('Coinciden (marca, linea y puffs)', r.coinciden.length), fila('Difieren solo por nombre o alias', r.alias.length), fila('Por confirmar (dudosos)', r.dudosos.length), fila('Solo en la tienda (altas nuevas)', r.soloTienda.length), fila('Solo en nuestro catalogo', r.soloCatalogo.length), '');
  L.push('## 1. Coinciden', '', fila('Tienda', 'Catalogo (id)', 'Sabores disponibles'), fila('---', '---', '---'));
  for (const c of r.coinciden) L.push(fila(c.t.titulo, `${c.m.n} (${c.m.id})`, `${c.t.disp} de ${c.t.total}`));
  L.push('', '## 2. Difieren solo por nombre o alias', '', 'Mismo producto con otro nombre. Para Waka rige el diccionario del dueno (nombre de los socios = nombre por puffs; `scripts/catalogo/alias-waka.json`). No se unifica ningun modelo: cuando el catalogo ya tiene varios modelos para el mismo producto se listan todos.', '', fila('Tienda', 'Catalogo (id)', 'Por que'), fila('---', '---', '---'));
  for (const c of r.alias) L.push(fila(c.t.titulo, [c.m, ...(c.extra ?? [])].map((m) => `${m.n} (${m.id})`).join('; '), c.via));
  L.push('', '## 3. Por confirmar (a la cola)', '', 'Hay candidatos plausibles pero no certeza. Un socio confirma antes de dar de alta, aliasar o asignar foto.', '', fila('Tienda', 'Candidatos del catalogo', 'Motivo'), fila('---', '---', '---'));
  for (const d of r.dudosos) L.push(fila(d.t.titulo, d.candidatos.map((m) => `${m.n} (${m.id})`).join('; '), d.motivo));
  L.push('', '## 4. Solo existen en la tienda (modelos nuevos)', '', 'Se dan de alta por la cola de "por confirmar" (el vigilante los registra como modelo nuevo; la ligadura al catalogo la confirma un socio).', '', fila('Tienda', 'Marca en el catalogo', 'Sabores disponibles'), fila('---', '---', '---'));
  for (const s of r.soloTienda) L.push(fila(s.t.titulo, s.marcaConocida ? 'si' : 'NO (marca nueva)', `${s.t.disp} de ${s.t.total}`));
  L.push('', '## 5. Solo existen en nuestro catalogo', '', 'No aparecen hoy en la tienda (pueden venir de otro proveedor, de un nombre interno o estar agotados y retirados).', '', fila('Catalogo (id)', 'Marca'), fila('---', '---'));
  for (const m of r.soloCatalogo) L.push(fila(`${m.n} (${m.id})`, m.marca === 'Sin marca' && m.marcaEf ? `Sin marca (propuesta ${m.marcaEf})` : m.marca));
  L.push('');
  return L.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  if (!arg('tienda') || !arg('catalogo')) { console.error('Uso: conciliar-marcas.mjs --tienda=<json> --catalogo=<json> [--md=<archivo>]'); process.exit(2); }
  const tienda = JSON.parse(readFileSync(arg('tienda'), 'utf8'));
  const catalogo = JSON.parse(readFileSync(arg('catalogo'), 'utf8'));
  const aliasWaka = cargarAliasWaka(new URL('../catalogo/alias-waka.json', import.meta.url));
  const propuestas = new Map(JSON.parse(readFileSync(new URL('../catalogo/marcas-modelos.json', import.meta.url), 'utf8')).modelos.map((m) => [m.id, m.marca]));
  const r = conciliar(tienda, catalogo, aliasWaka, propuestas);
  console.log(`coinciden ${r.coinciden.length}; alias ${r.alias.length}; por confirmar ${r.dudosos.length}; solo tienda ${r.soloTienda.length}; solo catalogo ${r.soloCatalogo.length}`);
  if (arg('md')) writeFileSync(arg('md'), aMarkdown(r, arg('fecha') ?? new Date().toISOString().slice(0, 10)));
}
