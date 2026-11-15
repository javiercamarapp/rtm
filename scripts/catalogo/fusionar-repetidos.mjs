#!/usr/bin/env node
// Fusiona los REPETIDOS EXACTOS de marcas, modelos y sabores (decision del dueno, 14-nov: "los nombres y sabores repetidos fusionalos en uno").
// EXACTO = mismo nombre salvo mayusculas, espacios, guiones o acentos (catalogo.llave_exacta). NUNCA une nombres solo parecidos (Lychee vs Lychee Ice): esos siguen en la cola de preguntas.
// Para correrlo DESPUES del despliegue (migracion 20261115900000 aplicada) y DESPUES de unificar-aprobados.mjs (los dos pares de sabores aprobados el 14-nov). Ver docs/fusion-repetidos.md.
//
//   node scripts/catalogo/fusionar-repetidos.mjs --verificar              solo lectura: lista exacta de repetidos exactos, cual queda, plan por sku y BLOQUEOS. No escribe. Sale con 1 si algo esta bloqueado.
//   node scripts/catalogo/fusionar-repetidos.mjs --aplicar                aplica en UNA transaccion (marcas, luego modelos, luego sabores); si algo se bloquea o la huella de kardex, existencias,
//                                                                         eventos, asientos, cadena del libro, cuenta 1310 o comprobaciones C1..C24 cambia, hace ROLLBACK. Idempotente.
//   node scripts/catalogo/fusionar-repetidos.mjs --sql-salida <archivo>   no se conecta: escribe el mismo SQL (una transaccion, idempotente, con la misma guarda) para `supabase db query --linked -f <archivo>`.
// Conexion: RTM_DB_URL (postgres://postgres:...@host:puerto/base) o, si no existe, la base local de `supabase status`. La URL nunca se imprime.
import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const REGLA = 'regla-exactos-2026-11-14';

/** SQL de UNA transaccion con la guarda de huella. Se decide en la base (catalogo.duplicados_exactos), asi que el mismo archivo sirve hoy y manana. Claves de idempotencia fijas por par. */
export function sqlAplicar() {
  return `begin;
select set_config('rtm.canal', 'importacion', true);
do $fus$
declare r record; res jsonb; a record; v_q bigint; v_est text; o bigint; d bigint; h0 jsonb := catalogo.huella_inmutables(); h1 jsonb; n int := 0;
begin
  for r in select * from catalogo.duplicados_exactos() order by case tipo when 'marca' then 1 when 'modelo' then 2 else 3 end, llave, origen_id loop
    if r.tipo = 'marca' then
      res := catalogo.unificar_marca('fusion:marca:' || r.origen_id || '>' || r.canonico_id, r.origen_id, r.canonico_id, 'importacion', null, ${lit(REGLA)});
    elsif r.tipo = 'modelo' then
      res := catalogo.unificar_modelo('fusion:modelo:' || r.origen_id || '>' || r.canonico_id, r.origen_id, r.canonico_id, 'importacion', null, ${lit(REGLA)});
    else
      -- Sabores: si el par es uno de los aprobados por el dueno el 14-nov, se usa SU direccion y SU clave (la misma de unificar-aprobados.mjs: no se duplica la operacion).
      select x.* into a from catalogo.unificacion_aprobada x, catalogo.sabor so, catalogo.sabor sc
        where so.id = r.origen_id and sc.id = r.canonico_id
          and ((x.origen_norm = so.nombre_norm and x.destino_norm = sc.nombre_norm) or (x.origen_norm = sc.nombre_norm and x.destino_norm = so.nombre_norm));
      if found then
        select id into o from catalogo.sabor where nombre_norm = a.origen_norm;
        select id into d from catalogo.sabor where nombre_norm = a.destino_norm;
        res := catalogo.unificar_sabor('aprobados:' || a.clave, o, d, 'importacion', null, null, a.clave);
      else
        select id, estado into v_q, v_est from catalogo.posible_duplicado where tipo = 'sabor' and id_a = least(r.origen_id, r.canonico_id) and id_b = greatest(r.origen_id, r.canonico_id);
        if v_est = 'distinto' then
          raise notice 'sabor % / %: un socio ya dijo que son distintos; se omite', r.origen, r.canonico;
          continue;
        end if;
        if v_q is null then
          v_q := catalogo.registrar_posible_duplicado('sabor', r.origen_id, r.canonico_id, 'mismo nombre salvo mayusculas, espacios, guiones o acentos (regla del dueno 14-nov)', 100, 'IGUAL_NORMALIZADO', false);
        end if;
        res := catalogo.unificar_sabor('fusion:sabor:' || r.origen_id || '>' || r.canonico_id, r.origen_id, r.canonico_id, 'importacion', null, v_q, null);
      end if;
    end if;
    raise notice '% % -> %: %', r.tipo, r.origen, r.canonico, res;
    if res ->> 'estado' = 'bloqueado' then raise exception 'bloqueado (todo cancelado): %', res; end if;
    n := n + 1;
  end loop;
  h1 := catalogo.huella_inmutables();
  if h1 is distinct from h0 then raise exception 'la huella de lo inmutable cambio: se cancela todo. antes=% despues=%', h0, h1; end if;
  raise notice 'repetidos exactos procesados: %', n;
end
$fus$;
commit;
`;
}

function lit(v) {
  return pg.escapeLiteral(String(v));
}

function urlConexion() {
  if (process.env.RTM_DB_URL) return process.env.RTM_DB_URL;
  return JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
}

/** Lista exacta (solo lectura): cada repetido, el plan y los bloqueos. Devuelve { total, bloqueados }. */
export async function verificar(c, log = console.log) {
  const { rows } = await c.query('select * from catalogo.duplicados_exactos() order by tipo, llave, origen_id');
  let bloqueados = 0;
  if (rows.length === 0) log('No hay repetidos exactos de marcas, modelos ni sabores (nada que hacer).');
  for (const r of rows) {
    let detalle;
    let bloq = [];
    if (r.tipo === 'modelo') {
      const plan = (await c.query('select catalogo.unificacion_modelo_plan($1, $2) as p', [r.origen_id, r.canonico_id])).rows[0].p;
      bloq = plan.bloqueos;
      detalle = `sku: ${plan.skus.map((s) => `${s.sabor} (${s.accion})`).join(', ') || 'ninguno'}`;
    } else if (r.tipo === 'sabor') {
      const plan = (await c.query('select catalogo.unificacion_plan($1, $2) as p', [r.origen_id, r.canonico_id])).rows[0].p;
      bloq = plan.skus.flatMap((s) => s.bloqueos.map((b) => `${s.modelo}: ${b}`));
      detalle = `${plan.skus.length} sku: ${plan.skus.map((s) => `${s.modelo} (${s.accion})`).join(', ') || 'ninguno'}`;
    } else {
      const n = (await c.query('select count(*)::int as n from catalogo.modelo where marca_id = $1', [r.origen_id])).rows[0].n;
      detalle = `${n} modelo(s) pasan a la marca que queda`;
    }
    if (bloq.length) bloqueados++;
    log(`${r.tipo}: "${r.origen}" -> "${r.canonico}" (llave ${r.llave}). ${detalle}${bloq.length ? `. BLOQUEADO: ${bloq.join('; ')}` : ''}`);
  }
  const h = (await c.query('select catalogo.huella_inmutables() as h')).rows[0].h;
  log(`Huella actual de lo inmutable: kardex ${h.kardex_n} movimientos, asientos ${h.asientos_n}, cadena del libro ${h.cadena === null ? 'integra' : 'ROTA en ' + h.cadena}, comprobaciones bloqueantes en rojo: ${h.rojas}.`);
  log(rows.length === 0 ? 'VERIFICACION OK: nada pendiente.' : bloqueados ? `VERIFICACION: ${bloqueados} de ${rows.length} bloqueado(s); --aplicar no haria nada hasta resolverlos.` : `VERIFICACION OK: ${rows.length} repetido(s) exacto(s) listo(s) para --aplicar.`);
  return { total: rows.length, bloqueados };
}

async function principal() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--sql-salida');
  if (i >= 0) {
    const archivo = args[i + 1];
    if (!archivo) { console.error('falta el archivo de --sql-salida'); process.exit(2); }
    writeFileSync(archivo, sqlAplicar());
    chmodSync(archivo, 0o600);
    console.log(`SQL escrito en ${archivo} (una transaccion, idempotente, con guarda de huella). Ejecutalo con: supabase db query --linked -f ${archivo}`);
    return;
  }
  if (!args.includes('--verificar') && !args.includes('--aplicar')) {
    console.error('Uso: fusionar-repetidos.mjs --verificar | --aplicar | --sql-salida <archivo>');
    process.exit(2);
  }
  const c = new pg.Client({ connectionString: urlConexion() });
  await c.connect();
  try {
    await c.query("select set_config('rtm.canal', 'importacion', false)");
    if (!args.includes('--aplicar')) {
      const { bloqueados } = await verificar(c);
      if (bloqueados) process.exitCode = 1;
      return;
    }
    const antes = (await c.query('select catalogo.huella_inmutables() as h')).rows[0].h;
    c.on('notice', (n) => console.log(n.message));
    try {
      await c.query(sqlAplicar());
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
