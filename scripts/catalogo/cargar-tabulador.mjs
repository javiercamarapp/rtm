#!/usr/bin/env node
// Carga el TABULADOR de precios (catalogo.tabulador_precio: precio de lista por cliente y modelo) para las combinaciones que hoy se venden sin precio de lista
// (avisos 'Sin precio de catalogo', NT-004). Usa SOLO la funcion oficial catalogo.fijar_precio; no toca pedidos, notas ni asientos. Ver docs/alias-waka-y-tabulador.md.
//
//   node scripts/catalogo/cargar-tabulador.mjs --desde-precios-usados [--salida <json privado>]
//        solo lectura: PROPONE el precio de lista de cada combinacion cliente x modelo sin precio vigente, tomando el precio realmente cobrado cuando es UNICO y redondo
//        (multiplo de 50 centavos). Marca 'ambiguo' lo que tiene mas de un precio o un precio prorrateado (centavos raros) para que el dueno lo confirme.
//        Con --salida escribe la propuesta (permisos 600) en un archivo FUERA del repo; edita los ambiguos y pasalo a --datos.
//   node scripts/catalogo/cargar-tabulador.mjs --datos <json privado> --verificar
//        solo lectura: que filas se cargarian, cuales ya estan (sin cambio) y cuales chocan con un precio vigente distinto (no se pisan).
//   node scripts/catalogo/cargar-tabulador.mjs --datos <json privado> --aplicar [--reemplazar]
//        UNA transaccion, idempotente, con huella de lo inmutable (ROLLBACK si cambia). --reemplazar permite cerrar un precio vigente distinto y abrir el nuevo.
// Formato del JSON privado (pesos): [{ "cliente": "...", "modelo": "...", "precio_pesos": 0, "vigente_desde": "AAAA-MM-DD" (opcional), "nota": "..." (opcional) }]
// Un modelo ya unificado se resuelve al modelo vigente. Conexion: RTM_DB_URL o la base local de `supabase status`; la URL nunca se imprime.
import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { z } from 'zod';

export const ORIGEN = 'lista_javier'; // el check de la tabla solo admite documento | chat | lista_javier; la marca de la carga va en la nota
export const NOTA_CARGA = 'carga historica 2026-11-14';

export const FilaSchema = z.object({
  cliente: z.string().trim().min(1),
  modelo: z.string().trim().min(1),
  precio_pesos: z.number().positive().max(100000),
  vigente_desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nota: z.string().trim().max(200).optional(),
});
export const DatosSchema = z.array(FilaSchema).min(1);

/** Pesos (puede traer centavos) a centavos enteros, sin errores de coma flotante. */
export const aCentavos = (pesos) => Math.round(pesos * 100);

/** Clasifica una combinacion con los precios cobrados. precios: [{ precio_cent, lineas }]. 'propuesto' solo con precio unico y multiplo de 50 centavos. */
export function clasificar(precios) {
  const distintos = [...new Set(precios.map((p) => Number(p.precio_cent)))].sort((a, b) => a - b);
  if (distintos.length > 1) return { estado: 'ambiguo', motivo: 'mas de un precio cobrado', precio_cent: null };
  const [unico] = distintos;
  if (unico % 50 !== 0) return { estado: 'ambiguo', motivo: 'precio con centavos raros (parece prorrateado)', precio_cent: null };
  return { estado: 'propuesto', motivo: 'precio unico cobrado', precio_cent: unico };
}

export function validarDatos(json) {
  const r = DatosSchema.safeParse(json);
  if (!r.success) throw new Error(`el archivo de datos no es valido: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const vistos = new Set();
  for (const f of r.data) {
    const k = `${f.cliente.toLowerCase()}|${f.modelo.toLowerCase()}`;
    if (vistos.has(k)) throw new Error(`combinacion repetida en el archivo: ${f.cliente} x ${f.modelo}`);
    vistos.add(k);
  }
  return r.data;
}

const lit = (v) => pg.escapeLiteral(String(v));

/** SQL de UNA transaccion con la guarda de huella. Los choques con un precio vigente distinto se omiten salvo reemplazar. */
export function sqlAplicar(filas, { reemplazar = false } = {}) {
  const valores = filas.map((f) => `(${lit(f.cliente)}, ${lit(f.modelo)}, ${aCentavos(f.precio_pesos)}::bigint, ${f.vigente_desde ? lit(f.vigente_desde) : 'null'}::date, ${lit(f.nota ?? '')})`).join(',\n      ');
  return `begin;
select set_config('rtm.canal', 'importacion', true);
do $tab$
declare
  r record; v_c bigint; v_m bigint; v_mn text; v_ab catalogo.tabulador_precio; res jsonb; v_n int := 0; v_igual int := 0; v_choque int := 0; v_reemplazo boolean := ${reemplazar ? 'true' : 'false'};
  h0 jsonb := catalogo.huella_inmutables(); h1 jsonb;
begin
  for r in select * from (values
      ${valores}
    ) as t(cliente, modelo, precio_cent, desde, nota) loop
    select id into v_c from catalogo.cliente where nombre_norm = catalogo.normalizar(r.cliente);
    if v_c is null then raise exception 'cliente desconocido: %', r.cliente; end if;
    select id into v_m from catalogo.modelo where nombre_norm = catalogo.normalizar(r.modelo);
    if v_m is null then   -- un modelo ya unificado: se carga al vigente
      select coalesce(m2.id, m.id) into v_m from catalogo.modelo m left join catalogo.modelo m2 on m2.id = m.unificado_en
       where m.nombre_original is not null and catalogo.normalizar(m.nombre_original) = catalogo.normalizar(r.modelo) and m.unificado_en is not null limit 1;
    end if;
    if v_m is null then raise exception 'modelo desconocido: %', r.modelo; end if;
    select nombre_canonico into v_mn from catalogo.modelo where id = v_m;
    select * into v_ab from catalogo.tabulador_precio where cliente_id = v_c and modelo_id = v_m and vigente_hasta is null;
    if found and v_ab.precio_cent <> r.precio_cent and not v_reemplazo then
      v_choque := v_choque + 1;
      raise notice 'CHOQUE (no se pisa): % x % ya tiene un precio vigente distinto', r.cliente, v_mn;
      continue;
    end if;
    if found and v_ab.precio_cent = r.precio_cent then v_igual := v_igual + 1; continue; end if;
    res := catalogo.fijar_precio('tab-carga:' || v_c || ':' || v_m || ':' || r.precio_cent, r.cliente, v_mn, r.precio_cent, coalesce(r.desde, negocio.hoy()), ${lit(ORIGEN)},
                                 ${lit(NOTA_CARGA)} || coalesce(' - ' || nullif(r.nota, ''), ''));
    if (res ->> 'sin_cambio')::boolean then v_igual := v_igual + 1; else v_n := v_n + 1; end if;
  end loop;
  h1 := catalogo.huella_inmutables();
  if h1 is distinct from h0 then raise exception 'la huella de lo inmutable cambio: se cancela todo. antes=% despues=%', h0, h1; end if;
  raise notice 'tabulador: % precio(s) cargado(s), % ya estaban igual, % choque(s) sin pisar', v_n, v_igual, v_choque;
end
$tab$;
commit;
`;
}

function urlConexion() {
  if (process.env.RTM_DB_URL) return process.env.RTM_DB_URL;
  return JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
}

/** Combinaciones vendidas sin precio de lista vigente, agrupadas por cliente y MODELO VIGENTE (un origen unificado cuenta en su destino). */
export const SQL_PRECIOS_USADOS = `
with recursive vig(id, vigente) as (
  select id, id from catalogo.modelo where unificado_en is null
  union all select m.id, v.vigente from catalogo.modelo m join vig v on m.unificado_en = v.id
), l as (
  select p.cliente_id, v.vigente as modelo_id, l.precio_cent, l.piezas_surtidas, p.id as pedido_id
    from operacion.pedido_linea l join operacion.pedido p on p.id = l.pedido_id join vig v on v.id = l.modelo_id
   where p.estado in ('enviado', 'confirmado', 'borrador')
)
select c.nombre_canonico as cliente, m.nombre_canonico as modelo, l.precio_cent::bigint, count(*)::int as lineas, count(distinct l.pedido_id)::int as pedidos, coalesce(sum(l.piezas_surtidas), 0)::int as piezas
  from l join catalogo.cliente c on c.id = l.cliente_id join catalogo.modelo m on m.id = l.modelo_id
 where not exists (select 1 from catalogo.tabulador_precio t where t.cliente_id = l.cliente_id and t.modelo_id = l.modelo_id and t.vigente_hasta is null)
 group by 1, 2, 3 order by 1, 2, 3`;

/** Agrupa las filas por combinacion y las clasifica (puro, probado sin base). */
export function proponer(filas) {
  const mapa = new Map();
  for (const f of filas) {
    const k = `${f.cliente}\u0000${f.modelo}`;
    if (!mapa.has(k)) mapa.set(k, { cliente: f.cliente, modelo: f.modelo, precios: [] });
    mapa.get(k).precios.push({ precio_cent: Number(f.precio_cent), lineas: f.lineas, pedidos: f.pedidos, piezas: f.piezas });
  }
  return [...mapa.values()].map((g) => {
    const c = clasificar(g.precios);
    return { cliente: g.cliente, modelo: g.modelo, estado: c.estado, motivo: c.motivo, precio_pesos: c.precio_cent === null ? null : c.precio_cent / 100,
      precios_vistos_pesos: g.precios.map((p) => p.precio_cent / 100), lineas: g.precios.reduce((a, p) => a + p.lineas, 0), piezas: g.precios.reduce((a, p) => a + p.piezas, 0) };
  });
}

async function principal() {
  const args = process.argv.slice(2);
  const dato = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const usados = args.includes('--desde-precios-usados');
  const aplicar = args.includes('--aplicar');
  if (!usados && !aplicar && !args.includes('--verificar')) {
    console.error('Uso: cargar-tabulador.mjs --desde-precios-usados [--salida <json>] | --datos <json> --verificar | --datos <json> --aplicar [--reemplazar]');
    process.exit(2);
  }
  const c = new pg.Client({ connectionString: urlConexion() });
  await c.connect();
  try {
    await c.query("select set_config('rtm.canal', 'importacion', false)");
    if (usados) {
      await c.query('begin read only');
      const filas = (await c.query(SQL_PRECIOS_USADOS)).rows;
      await c.query('rollback');
      const prop = proponer(filas);
      const ok = prop.filter((p) => p.estado === 'propuesto');
      const amb = prop.filter((p) => p.estado === 'ambiguo');
      console.log(`Combinaciones vendidas sin precio de lista: ${prop.length}. Propuestas (precio unico y redondo): ${ok.length}. AMBIGUAS (confirmar): ${amb.length}.`);
      for (const p of prop) console.log(`${p.estado === 'propuesto' ? 'PROPUESTO' : 'AMBIGUO  '} ${p.cliente} x ${p.modelo}: ${p.estado === 'propuesto' ? p.precio_pesos : `vistos ${p.precios_vistos_pesos.join(' / ')} (${p.motivo})`} [${p.lineas} renglon(es), ${p.piezas} pieza(s)]`);
      const salida = dato('--salida');
      if (salida) {
        writeFileSync(salida, JSON.stringify(prop.map((p) => ({ ...p, confirmar: p.estado === 'ambiguo' })), null, 2));
        chmodSync(salida, 0o600);
        console.log(`Propuesta escrita en ${salida} (permisos 600; mantenla fuera del repo). Para cargar: deja solo las filas con "cliente", "modelo" y "precio_pesos" confirmados y pasalas a --datos.`);
      }
      return;
    }
    const ruta = dato('--datos');
    if (!ruta) { console.error('falta --datos <json privado>'); process.exitCode = 2; return; }
    const filas = validarDatos(JSON.parse(readFileSync(ruta, 'utf8')));
    if (!aplicar) {
      await c.query('begin read only');
      let nuevas = 0, iguales = 0, choques = 0, faltan = 0;
      for (const f of filas) {
        const r = (await c.query(`select cl.id as cid, coalesce(mv.id, m0.id) as mid, (select t.precio_cent from catalogo.tabulador_precio t where t.cliente_id = cl.id and t.modelo_id = coalesce(mv.id, m0.id) and t.vigente_hasta is null) as vigente
          from (select id from catalogo.cliente where nombre_norm = catalogo.normalizar($1)) cl
          left join catalogo.modelo m0 on m0.nombre_norm = catalogo.normalizar($2)
          left join catalogo.modelo mo on mo.unificado_en is not null and catalogo.normalizar(mo.nombre_original) = catalogo.normalizar($2)
          left join catalogo.modelo mv on mv.id = mo.unificado_en`, [f.cliente, f.modelo])).rows[0];
        if (!r || !r.mid) { faltan++; console.log(`DESCONOCIDO: ${f.cliente} x ${f.modelo} (cliente o modelo no existe)`); continue; }
        if (r.vigente === null) { nuevas++; console.log(`NUEVO: ${f.cliente} x ${f.modelo}: ${f.precio_pesos}`); }
        else if (Number(r.vigente) === aCentavos(f.precio_pesos)) iguales++;
        else { choques++; console.log(`CHOQUE: ${f.cliente} x ${f.modelo}: vigente ${Number(r.vigente) / 100} contra ${f.precio_pesos} (no se pisa; usa --reemplazar si es lo que quieres)`); }
      }
      await c.query('rollback');
      console.log(`VERIFICACION: ${nuevas} nuevo(s), ${iguales} ya igual(es), ${choques} choque(s), ${faltan} desconocido(s).`);
      if (faltan) process.exitCode = 1;
      return;
    }
    const antes = (await c.query('select catalogo.huella_inmutables() as h')).rows[0].h;
    c.on('notice', (n) => console.log(n.message));
    try {
      await c.query(sqlAplicar(filas, { reemplazar: args.includes('--reemplazar') }));
    } catch (e) {
      await c.query('rollback').catch(() => {});
      console.error(`FALLO (todo cancelado): ${e.message}`);
      process.exitCode = 1;
      return;
    }
    const despues = (await c.query('select catalogo.huella_inmutables() as h')).rows[0].h;
    const igual = JSON.stringify(antes) === JSON.stringify(despues);
    console.log(igual ? 'APLICADO: la huella de lo inmutable es identica antes y despues.' : 'ALERTA: la huella cambio');
    if (!igual) process.exitCode = 1;
  } finally {
    await c.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();
