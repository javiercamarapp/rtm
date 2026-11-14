#!/usr/bin/env node
// Aplica SOLO los dos pares que el dueno aprobo el 14-nov por la funcion oficial catalogo.unificar_sabor (aprobacion explicita por clave; ver catalogo.unificacion_aprobada):
//   Kiwi Dragonfruit -> Kiwi Dragon Fruit        (clave dueno-2026-11-14-kiwi-dragon-fruit)
//   Passionfruit     -> Passion Fruit            (clave dueno-2026-11-14-passion-fruit)
// Para correrlo DESPUES del despliegue (la migracion 20261115300000..300100 ya debe estar aplicada). NO toca nada mas: ni otros sabores ni clientes ni modelos.
//
//   node scripts/catalogo/unificar-aprobados.mjs --verificar              solo lectura: estado de cada par, el plan por modelo (reasigna o fusiona) y los bloqueos. No escribe.
//   node scripts/catalogo/unificar-aprobados.mjs --aplicar                aplica en UNA transaccion; si la huella de kardex, existencias, eventos, asientos, cadena del libro, cuenta 1310 o
//                                                                         comprobaciones C1..C24 cambia, hace ROLLBACK y sale con error. Idempotente: la segunda corrida no cambia nada.
//   node scripts/catalogo/unificar-aprobados.mjs --sql-salida <archivo>   no se conecta: escribe el mismo SQL (una transaccion, idempotente, con la misma guarda de huella) para
//                                                                         `supabase db query --linked -f <archivo>`.
// Conexion: RTM_DB_URL (postgres://postgres:...@host:puerto/base) o, si no existe, la base local de `supabase status`. La URL nunca se imprime.
import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import pg from 'pg';

export const PARES_APROBADOS = [
  { clave: 'dueno-2026-11-14-kiwi-dragon-fruit', origen: 'Kiwi Dragonfruit', destino: 'Kiwi Dragon Fruit' },
  { clave: 'dueno-2026-11-14-passion-fruit', origen: 'Passionfruit', destino: 'Passion Fruit' },
];

const lit = (v) => pg.escapeLiteral(String(v));

/** SQL de UNA transaccion con la guarda de huella. Las claves de idempotencia son fijas: correrlo dos veces devuelve lo guardado. */
export function sqlAplicar(pares = PARES_APROBADOS) {
  const bloques = pares.map((p) => `
  select s.id into o from catalogo.sabor s where s.nombre_norm = catalogo.normalizar(${lit(p.origen)});
  select s.id into d from catalogo.sabor s where s.nombre_norm = catalogo.normalizar(${lit(p.destino)});
  if o is null then
    raise notice '% -> %: ya unificado (o el origen no existe); sin cambios', ${lit(p.origen)}, ${lit(p.destino)};
  elsif d is null then
    raise exception 'no existe el sabor destino %', ${lit(p.destino)};
  else
    r := catalogo.unificar_sabor(${lit('aprobados:' + p.clave)}, o, d, 'importacion', null, null, ${lit(p.clave)});
    raise notice '% -> %: %', ${lit(p.origen)}, ${lit(p.destino)}, r;
    if r ->> 'estado' = 'bloqueado' then raise exception 'bloqueado: %', r; end if;
  end if;`).join('\n');
  return `begin;
select set_config('rtm.canal', 'importacion', true);
do $unif$
declare o bigint; d bigint; r jsonb; h0 jsonb := catalogo.huella_inmutables(); h1 jsonb;
begin${bloques}
  h1 := catalogo.huella_inmutables();
  if h1 is distinct from h0 then raise exception 'la huella de lo inmutable cambio: se cancela todo. antes=% despues=%', h0, h1; end if;
end
$unif$;
commit;
`;
}

function urlConexion() {
  if (process.env.RTM_DB_URL) return process.env.RTM_DB_URL;
  return JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
}

async function verificar(c) {
  let pendientes = 0;
  for (const p of PARES_APROBADOS) {
    const { rows } = await c.query(
      `select o.id as o, o.unificado_en as o_unif, d.id as d, (select catalogo.unificacion_plan(o.id, d.id)) as plan
         from (select 1) x left join catalogo.sabor o on o.nombre_norm = catalogo.normalizar($1) left join catalogo.sabor d on d.nombre_norm = catalogo.normalizar($2)`,
      [p.origen, p.destino],
    );
    const r = rows[0];
    if (!r.o) {
      const ya = await c.query('select id, estado from catalogo.unificacion_sabor where nombre_origen = $1 order by id desc limit 1', [p.origen]);
      console.log(`${p.origen} -> ${p.destino}: ${ya.rows[0] ? `ya unificado (unificacion ${ya.rows[0].id}, ${ya.rows[0].estado})` : 'el origen no existe (nada que hacer)'}`);
      continue;
    }
    if (!r.d) { console.log(`${p.origen} -> ${p.destino}: FALTA el sabor destino`); process.exitCode = 1; continue; }
    pendientes++;
    const plan = r.plan;
    const bloq = plan.skus.filter((s) => s.bloqueos.length > 0);
    console.log(`${p.origen} -> ${p.destino}: pendiente. ${plan.skus.length} sku: ${plan.skus.map((s) => `${s.modelo} (${s.accion}${s.bloqueos.length ? ', BLOQUEADO: ' + s.bloqueos.join(', ') : ''})`).join('; ')}`);
    if (bloq.length) process.exitCode = 1;
  }
  const h = (await c.query('select catalogo.huella_inmutables() as h')).rows[0].h;
  console.log(`Huella actual de lo inmutable: kardex ${h.kardex_n} movimientos, asientos ${h.asientos_n}, cadena del libro ${h.cadena === null ? 'integra' : 'ROTA en ' + h.cadena}, comprobaciones bloqueantes en rojo: ${h.rojas}.`);
  console.log(pendientes === 0 ? 'VERIFICACION OK: nada pendiente.' : process.exitCode ? 'VERIFICACION: hay bloqueos; no se aplicaria.' : `VERIFICACION OK: ${pendientes} par(es) listo(s) para --aplicar.`);
}

const args = process.argv.slice(2);
const i = args.indexOf('--sql-salida');
if (i >= 0) {
  const archivo = args[i + 1];
  if (!archivo) { console.error('falta el archivo de --sql-salida'); process.exit(2); }
  writeFileSync(archivo, sqlAplicar());
  chmodSync(archivo, 0o600);
  console.log(`SQL escrito en ${archivo} (una transaccion, idempotente, con guarda de huella). Ejecutalo con: supabase db query --linked -f ${archivo}`);
} else if (args.includes('--verificar') || args.includes('--aplicar')) {
  const c = new pg.Client({ connectionString: urlConexion() });
  await c.connect();
  try {
    await c.query("select set_config('rtm.canal', 'importacion', false)");
    if (args.includes('--aplicar')) {
      const antes = (await c.query('select catalogo.huella_inmutables() as h')).rows[0].h;
      c.on('notice', (n) => console.log(n.message));
      try {
        await c.query(sqlAplicar());
      } catch (e) {
        await c.query('rollback').catch(() => {});
        console.error(`FALLO (todo cancelado): ${e.message}`);
        process.exitCode = 1;
      }
      if (!process.exitCode) {
        const despues = (await c.query('select catalogo.huella_inmutables() as h')).rows[0].h;
        console.log(JSON.stringify(antes) === JSON.stringify(despues) ? 'APLICADO: la huella de lo inmutable es identica antes y despues.' : 'ALERTA: la huella cambio');
        if (JSON.stringify(antes) !== JSON.stringify(despues)) process.exitCode = 1;
      }
    } else {
      await verificar(c);
    }
  } finally {
    await c.end();
  }
} else {
  console.error('Uso: unificar-aprobados.mjs --verificar | --aplicar | --sql-salida <archivo>');
  process.exit(2);
}
