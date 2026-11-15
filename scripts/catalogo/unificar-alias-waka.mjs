#!/usr/bin/env node
// Une cada alias Waka con su modelo por puffs (decision del dueno, 14-nov: "Si, unir cada alias con su modelo por pufs" y "Optimus 100K y SoPro 15K").
// El diccionario vive en scripts/catalogo/alias-waka.json (alias, 'tambien' = nombres sueltos del mismo producto, destino). Solo estos pares estan aprobados:
// la migracion 20261118100000 los registra en catalogo.unificacion_modelo_aprobada y catalogo.unificar_modelo los acepta con la regla 'alias-waka-2026-11-14'.
// NUNCA crea un modelo ni duplica: si el modelo destino no existe, el par queda BLOQUEADO y se explica (hay que renombrar/atar a mano). Ver docs/alias-waka-y-tabulador.md.
//
//   node scripts/catalogo/unificar-alias-waka.mjs --verificar              solo lectura: plan por par alias -> destino (sku a fusionar o crear, existencias a combinar, pedidos, lineas, notas y compras
//                                                                          afectados, precios y costos que se heredan) y BLOQUEOS. Sale con 1 si algo esta bloqueado.
//   node scripts/catalogo/unificar-alias-waka.mjs --aplicar                UNA transaccion: hereda al destino los precios de cliente y costos vigentes que le faltan (catalogo.fijar_precio / fijar_costo),
//                                                                          une con catalogo.unificar_modelo y compara la huella de kardex, existencias, eventos, asientos, cadena del libro, cuenta 1310 y
//                                                                          comprobaciones C1..C24: si algo se bloquea o la huella cambia, ROLLBACK de todo. Idempotente (segunda corrida: nada que hacer).
//   node scripts/catalogo/unificar-alias-waka.mjs --aplicar --omitir-bloqueados   aplica solo los pares sin bloqueo y cuenta los omitidos (cada par omitido no deja ni la herencia).
//   node scripts/catalogo/unificar-alias-waka.mjs --sql-salida <archivo>   no se conecta: escribe el mismo SQL para `supabase db query --linked -f <archivo>`.
// Conexion: RTM_DB_URL (postgres://postgres:...@host:puerto/base) o, si no existe, la base local de `supabase status`. La URL nunca se imprime.
import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const REGLA = 'alias-waka-2026-11-14';
export const NOTA_HERENCIA = 'herencia alias-waka 2026-11-14';
const RUTA_DICCIONARIO = new URL('./alias-waka.json', import.meta.url);

const lit = (v) => pg.escapeLiteral(String(v));
const plano = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase(); // los espacios cuentan: 'Waka So Pro' y 'Waka SoPro' son dos modelos distintos

/** Pares { origen, destino } del diccionario: el alias y sus nombres sueltos, sin el que ya es el nombre del destino. */
export function paresDeDiccionario(dic) {
  const pares = [];
  for (const a of dic.alias) {
    for (const origen of [a.alias, ...(a.tambien ?? [])]) {
      if (plano(origen) !== plano(a.destino) && !pares.some((p) => plano(p.origen) === plano(origen))) pares.push({ origen, destino: a.destino });
    }
  }
  return pares;
}

export function cargarPares(ruta = RUTA_DICCIONARIO) {
  return paresDeDiccionario(JSON.parse(readFileSync(ruta, 'utf8')));
}

const INHERITABLES = [/^tiene un costo de lista vigente/, /^tiene un precio de cliente vigente/];
/** Bloqueos reales de un plan: los de costo y precio vigentes que faltan en el destino NO bloquean porque se heredan. */
export function bloqueosReales(bloqueosPlan) {
  return bloqueosPlan.filter((b) => !INHERITABLES.some((re) => re.test(b)));
}

/** SQL de UNA transaccion con la guarda de huella. Idempotente: un origen ya unido (o que no existe como modelo) solo se avisa. */
export function sqlAplicar(pares, { omitirBloqueados = false } = {}) {
  const valores = pares.map((p) => `(${lit(p.origen)}, ${lit(p.destino)})`).join(',\n      ');
  return `begin;
select set_config('rtm.canal', 'importacion', true);
do $alw$
declare
  r record; h record; o bigint; d bigint; v_on text; v_dn text; res jsonb; b text[]; v_omitir boolean := ${omitirBloqueados ? 'true' : 'false'};
  v_ok int := 0; v_omit int := 0; v_ya int := 0; v_prec int := 0; v_cost int := 0; h0 jsonb := catalogo.huella_inmutables(); h1 jsonb;
begin
  for r in select * from (values
      ${valores}
    ) as t(origen, destino) loop
    select id, nombre_canonico into o, v_on from catalogo.modelo where nombre_norm = catalogo.normalizar(r.origen);
    select id, nombre_canonico into d, v_dn from catalogo.modelo where nombre_norm = catalogo.normalizar(r.destino);
    if o is null then
      if exists (select 1 from catalogo.modelo m where m.unificado_en is not null and catalogo.normalizar(m.nombre_original) = catalogo.normalizar(r.origen)) then v_ya := v_ya + 1; raise notice '% : ya estaba unido', r.origen;
      else raise notice '% : no existe como modelo (solo alias); nada que unir', r.origen; end if;
      continue;
    end if;
    begin
      if d is null then raise exception 'BLOQUEO: % -> %: el modelo destino no existe (no se crea ningun duplicado: renombra o ata el modelo origen a mano)', r.origen, r.destino; end if;
      -- Herencia: los precios de cliente y costos vigentes del origen que el destino no tiene pasan al destino (es lo que pide el bloqueo de la union). Si otro alias ya heredo un valor distinto, se bloquea.
      for h in select t.cliente_id, c.nombre_canonico as cliente, t.precio_cent, greatest(t.vigente_desde, coalesce((select max(x.vigente_hasta) from catalogo.tabulador_precio x where x.modelo_id = d and x.cliente_id = t.cliente_id), t.vigente_desde)) as desde
                 from catalogo.tabulador_precio t join catalogo.cliente c on c.id = t.cliente_id
                where t.modelo_id = o and t.vigente_hasta is null
                  and not exists (select 1 from catalogo.tabulador_precio x where x.modelo_id = d and x.cliente_id = t.cliente_id and x.vigente_hasta is null)
                order by t.cliente_id loop
        perform catalogo.fijar_precio('alias-waka:precio:' || o || ':' || d || ':' || h.cliente_id, h.cliente, v_dn, h.precio_cent, h.desde, 'lista_javier', ${lit(NOTA_HERENCIA)} || ' desde ' || v_on);
        v_prec := v_prec + 1;
      end loop;
      if exists (select 1 from catalogo.tabulador_precio t join catalogo.tabulador_precio x on x.modelo_id = d and x.cliente_id = t.cliente_id and x.vigente_hasta is null
                  where t.modelo_id = o and t.vigente_hasta is null and t.precio_cent <> x.precio_cent and x.nota like ${lit(NOTA_HERENCIA + '%')}) then
        raise exception 'BLOQUEO: % -> %: otro alias del mismo destino ya heredo un precio de cliente distinto; confirma cual vale', r.origen, r.destino;
      end if;
      for h in select k.proveedor_id, p.nombre as proveedor, k.costo_cent, greatest(k.vigente_desde, coalesce((select max(x.vigente_hasta) from catalogo.costo_proveedor x where x.modelo_id = d and x.proveedor_id = k.proveedor_id), k.vigente_desde)) as desde,
                      k.fuente, k.es_lista, k.motivo, k.supuesto
                 from catalogo.costo_proveedor k join catalogo.proveedor p on p.id = k.proveedor_id
                where k.modelo_id = o and k.vigente_hasta is null
                  and not exists (select 1 from catalogo.costo_proveedor x where x.modelo_id = d and x.proveedor_id = k.proveedor_id and x.vigente_hasta is null)
                order by k.proveedor_id loop
        perform catalogo.fijar_costo('alias-waka:costo:' || o || ':' || d || ':' || h.proveedor_id, h.proveedor, v_dn, h.costo_cent, h.desde,
                                     ${lit(NOTA_HERENCIA)} || ' desde ' || v_on || ' (fuente original: ' || h.fuente || ')', h.motivo, h.supuesto, h.es_lista);
        v_cost := v_cost + 1;
      end loop;
      if exists (select 1 from catalogo.costo_proveedor k join catalogo.costo_proveedor x on x.modelo_id = d and x.proveedor_id = k.proveedor_id and x.vigente_hasta is null
                  where k.modelo_id = o and k.vigente_hasta is null and k.costo_cent <> x.costo_cent and x.fuente like ${lit(NOTA_HERENCIA + '%')}) then
        raise exception 'BLOQUEO: % -> %: otro alias del mismo destino ya heredo un costo distinto; confirma cual vale', r.origen, r.destino;
      end if;
      b := catalogo.modelo_bloqueos_unificacion(o, d);
      if cardinality(b) > 0 then raise exception 'BLOQUEO: % -> %: %', r.origen, r.destino, array_to_string(b, '; '); end if;
      res := catalogo.unificar_modelo('alias-waka:' || o || '>' || d, o, d, 'importacion', null, ${lit(REGLA)});
      if res ->> 'estado' = 'bloqueado' then raise exception 'BLOQUEO: % -> %: %', r.origen, r.destino, res; end if;
      raise notice '% -> %: %', r.origen, r.destino, res;
      v_ok := v_ok + 1;
    exception when others then
      if v_omitir and sqlerrm like 'BLOQUEO:%' then
        v_omit := v_omit + 1;
        raise notice 'OMITIDO (sin herencia ni cambios de este par): %', sqlerrm;
      else
        raise;
      end if;
    end;
  end loop;
  h1 := catalogo.huella_inmutables();
  if h1 is distinct from h0 then raise exception 'la huella de lo inmutable cambio: se cancela todo. antes=% despues=%', h0, h1; end if;
  raise notice 'alias Waka: % unidos, % omitidos por bloqueo, % ya estaban unidos; % precios y % costos heredados al destino', v_ok, v_omit, v_ya, v_prec, v_cost;
end
$alw$;
commit;
`;
}

function urlConexion() {
  if (process.env.RTM_DB_URL) return process.env.RTM_DB_URL;
  return JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
}

const unoPor = async (c, sql, args) => (await c.query(sql, args)).rows[0] ?? null;

/** Plan de un par (solo lectura). Devuelve { estado, lineas[], bloqueos[], herencia }. `heredado` acumula lo ya asignado por otros alias del mismo destino. */
export async function planDePar(c, par, heredado = new Map()) {
  const res = { par, estado: 'listo', lineas: [], bloqueos: [], precios: 0, costos: 0 };
  const o = await unoPor(c, 'select id, nombre_canonico from catalogo.modelo where nombre_norm = catalogo.normalizar($1)', [par.origen]);
  const d = await unoPor(c, 'select id, nombre_canonico from catalogo.modelo where nombre_norm = catalogo.normalizar($1)', [par.destino]);
  if (!o) {
    const u = await unoPor(c, 'select id from catalogo.modelo where unificado_en is not null and catalogo.normalizar(nombre_original) = catalogo.normalizar($1)', [par.origen]);
    res.estado = u ? 'ya_unido' : 'solo_alias';
    res.lineas.push(u ? 'ya estaba unido' : 'no existe como modelo (solo alias): nada que unir');
    return res;
  }
  const hist = await unoPor(c, `select (select count(*) from catalogo.sku where modelo_id = $1)::int as skus,
      (select count(*) from operacion.pedido_linea where modelo_id = $1)::int as lineas,
      (select count(distinct pedido_id) from operacion.pedido_linea where modelo_id = $1)::int as pedidos,
      (select count(distinct n.id) from operacion.nota n join operacion.pedido_linea l on l.pedido_id = n.pedido_id where l.modelo_id = $1)::int as notas,
      (select count(*) from operacion.compra_linea where modelo_id = $1)::int as compras,
      (select coalesce(sum(e.piezas), 0) from operacion.existencia_sku_ubicacion e join catalogo.sku k on k.id = e.sku_id where k.modelo_id = $1)::int as piezas`, [o.id]);
  res.lineas.push(`origen "${o.nombre_canonico}" (id ${o.id}): ${hist.skus} sku, ${hist.pedidos} pedido(s) con ${hist.lineas} renglon(es), ${hist.notas} nota(s), ${hist.compras} renglon(es) de compra, ${hist.piezas} pieza(s) en existencia`);
  if (!d) {
    res.estado = 'bloqueado';
    res.bloqueos.push(`el modelo destino "${par.destino}" no existe; no se crea un duplicado. Para atarlo: renombrar "${o.nombre_canonico}" a "${par.destino}" (o crear el destino con un alta autorizada) y volver a verificar`);
    return res;
  }
  res.lineas.push(`destino "${d.nombre_canonico}" (id ${d.id})`);
  const plan = (await c.query('select catalogo.unificacion_modelo_plan($1, $2) as p', [o.id, d.id])).rows[0].p;
  res.lineas.push(`sku: ${plan.skus.map((s) => `${s.sabor} (${s.accion === 'fusiona' ? 'se fusiona' : 'se crea en el destino'})`).join(', ') || 'ninguno'}`);
  const comb = (await c.query(`select sa.nombre_canonico as sabor, e.ubicacion, e.piezas as origen,
        coalesce((select sum(x.piezas) from operacion.existencia_sku_ubicacion x join catalogo.sku kd on kd.id = x.sku_id where kd.modelo_id = $2 and kd.sabor_id = k.sabor_id and x.ubicacion = e.ubicacion), 0) as destino
      from operacion.existencia_sku_ubicacion e join catalogo.sku k on k.id = e.sku_id join catalogo.sabor sa on sa.id = k.sabor_id
     where k.modelo_id = $1 and e.piezas <> 0 order by sa.nombre_canonico`, [o.id, d.id])).rows;
  for (const f of comb) res.lineas.push(`existencia a combinar: ${f.sabor} en ${f.ubicacion}: ${f.origen} del origen + ${f.destino} del destino`);
  const bloq = [...bloqueosReales(plan.bloqueos)];
  const tabs = (await c.query(`select t.cliente_id, t.precio_cent from catalogo.tabulador_precio t where t.modelo_id = $1 and t.vigente_hasta is null
      and not exists (select 1 from catalogo.tabulador_precio x where x.modelo_id = $2 and x.cliente_id = t.cliente_id and x.vigente_hasta is null)`, [o.id, d.id])).rows;
  for (const t of tabs) {
    const k = `${d.id}|precio|${t.cliente_id}`;
    if (heredado.has(k) && heredado.get(k) !== String(t.precio_cent)) bloq.push(`otro alias del mismo destino ya hereda un precio distinto para el cliente ${t.cliente_id}; confirma cual vale`);
    else { heredado.set(k, String(t.precio_cent)); res.precios++; }
  }
  const costos = (await c.query(`select k.proveedor_id, k.costo_cent from catalogo.costo_proveedor k where k.modelo_id = $1 and k.vigente_hasta is null
      and not exists (select 1 from catalogo.costo_proveedor x where x.modelo_id = $2 and x.proveedor_id = k.proveedor_id and x.vigente_hasta is null)`, [o.id, d.id])).rows;
  for (const k of costos) {
    const clave = `${d.id}|costo|${k.proveedor_id}`;
    if (heredado.has(clave) && heredado.get(clave) !== String(k.costo_cent)) bloq.push(`otro alias del mismo destino ya hereda un costo distinto para el proveedor ${k.proveedor_id}; confirma cual vale`);
    else { heredado.set(clave, String(k.costo_cent)); res.costos++; }
  }
  if (res.precios || res.costos) res.lineas.push(`hereda al destino ${res.precios} precio(s) de cliente y ${res.costos} costo(s) de lista vigentes que el destino no tiene`);
  const destinoYaUnido = await unoPor(c, 'select unificado_en from catalogo.modelo where id = $1', [d.id]);
  if (destinoYaUnido?.unificado_en) bloq.push('el modelo destino ya fue unificado en otro; elige el vigente');
  res.bloqueos = bloq;
  res.estado = bloq.length ? 'bloqueado' : 'listo';
  return res;
}

/** Solo lectura: imprime el plan de cada par y devuelve { total, listos, bloqueados }. */
export async function verificar(c, pares, log = console.log) {
  await c.query("select set_config('rtm.canal', 'importacion', false)");
  const heredado = new Map();
  let listos = 0, bloqueados = 0, nada = 0;
  for (const par of pares) {
    const p = await planDePar(c, par, heredado);
    log(`\n${par.origen} -> ${par.destino}: ${p.estado.toUpperCase()}`);
    for (const l of p.lineas) log(`  ${l}`);
    for (const b of p.bloqueos) log(`  BLOQUEADO: ${b}`);
    if (p.estado === 'listo') listos++;
    else if (p.estado === 'bloqueado') bloqueados++;
    else nada++;
  }
  const h = (await c.query('select catalogo.huella_inmutables() as h')).rows[0].h;
  log(`\nHuella actual de lo inmutable: kardex ${h.kardex_n} movimientos, asientos ${h.asientos_n}, cadena del libro ${h.cadena === null ? 'integra' : 'ROTA en ' + h.cadena}, comprobaciones bloqueantes en rojo: ${h.rojas}.`);
  log(bloqueados ? `VERIFICACION: ${listos} par(es) listo(s), ${bloqueados} BLOQUEADO(S), ${nada} sin nada que unir; --aplicar se detiene hasta resolver los bloqueos (o usa --omitir-bloqueados).`
    : `VERIFICACION OK: ${listos} par(es) listo(s) para --aplicar, ${nada} sin nada que unir (ya unidos o solo alias).`);
  return { total: pares.length, listos, bloqueados };
}

async function principal() {
  const args = process.argv.slice(2);
  const pares = cargarPares();
  const omitirBloqueados = args.includes('--omitir-bloqueados');
  const i = args.indexOf('--sql-salida');
  if (i >= 0) {
    const archivo = args[i + 1];
    if (!archivo) { console.error('falta el archivo de --sql-salida'); process.exit(2); }
    writeFileSync(archivo, sqlAplicar(pares, { omitirBloqueados }));
    chmodSync(archivo, 0o600);
    console.log(`SQL escrito en ${archivo} (una transaccion, idempotente, con guarda de huella). Ejecutalo con: supabase db query --linked -f ${archivo}`);
    return;
  }
  if (!args.includes('--verificar') && !args.includes('--aplicar')) {
    console.error('Uso: unificar-alias-waka.mjs --verificar | --aplicar [--omitir-bloqueados] | --sql-salida <archivo>');
    process.exit(2);
  }
  const c = new pg.Client({ connectionString: urlConexion() });
  await c.connect();
  try {
    if (!args.includes('--aplicar')) {
      await c.query('begin read only');
      try {
        const { bloqueados } = await verificar(c, pares);
        if (bloqueados) process.exitCode = 1;
      } finally {
        await c.query('rollback');
      }
      return;
    }
    await c.query("select set_config('rtm.canal', 'importacion', false)");
    const antes = (await c.query('select catalogo.huella_inmutables() as h')).rows[0].h;
    c.on('notice', (n) => console.log(n.message));
    try {
      await c.query(sqlAplicar(pares, { omitirBloqueados }));
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
