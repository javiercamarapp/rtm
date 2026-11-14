#!/usr/bin/env node
// Asigna fecha de pago (2026-11-20 por omision) a los pedidos a credito ENVIADOS que siguen sin plazo (decision del dueno, 14-nov).
//   DATABASE_URL=postgresql://... node scripts/cargador/plazo-pendiente.mjs --verificar   (solo lectura: cantidad y folios; sin datos personales)
//   DATABASE_URL=postgresql://... node scripts/cargador/plazo-pendiente.mjs --aplicar     (escribe, un pedido por transaccion)
// Escribe SOLO por la funcion oficial api.acordar_plazo (queda el evento plazo_acordado con actor y clave de idempotencia); nunca con instrucciones directas sobre las tablas.
// El plazo se guarda en dias (operacion.pedido.plazo_dias) y el vencimiento de cuentas por cobrar es fecha_envio + plazo_dias: por eso los dias se cuentan DESDE LA FECHA DE ENVIO,
// asi el vencimiento resultante es exactamente la fecha elegida. Idempotente: un pedido que ya tiene plazo no se toca, una segunda corrida no cambia nada.
// Un pedido cuya fecha de envio es igual o posterior a la fecha elegida NO se modifica (plazo <= 0): se lista aparte para decidir a mano.
// Los pedidos a costo del socio de menudeo llevan su propia fecha comprometida y no entran aqui.
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values: a } = parseArgs({ options: { url: { type: 'string' }, fecha: { type: 'string', default: '2026-11-20' }, actor: { type: 'string', default: 'Javier' }, verificar: { type: 'boolean', default: false }, aplicar: { type: 'boolean', default: false }, ayuda: { type: 'boolean', default: false } } });
if (a.ayuda || a.verificar === a.aplicar || !/^\d{4}-\d{2}-\d{2}$/.test(a.fecha)) {
  console.log('Uso: plazo-pendiente.mjs (--verificar | --aplicar) [--fecha 2026-11-20] [--actor Javier] [--url <DATABASE_URL>]');
  process.exit(a.ayuda ? 0 : 2);
}
const url = a.url ?? process.env.DATABASE_URL;
if (!url) { console.error('Falta --url o DATABASE_URL.'); process.exit(2); }

const SQL_CANDIDATOS = `
  select pe.id, pe.folio, pe.fecha_neg::text as fecha_neg, pe.fecha_envio::text as fecha_envio, ($1::date - pe.fecha_envio) as dias
    from operacion.pedido pe
    left join operacion.pedido_ds d on d.pedido_id = pe.id
   where pe.plazo_dias is null and pe.estado = 'enviado' and pe.fecha_envio is not null
     and operacion.pedido_saldo(pe.id) > 0 and coalesce(d.tipo_venta, 'cliente') <> 'socio_a_costo'
   order by pe.fecha_envio, pe.id`;

const client = new pg.Client({ connectionString: url });
await client.connect();
let codigo = 0;
try {
  if (a.verificar) await client.query('begin read only');
  const cand = (await client.query(SQL_CANDIDATOS, [a.fecha])).rows;
  const aplicables = cand.filter((x) => x.dias > 0);
  const noAplicables = cand.filter((x) => x.dias <= 0);
  const distintaFecha = cand.filter((x) => x.fecha_neg !== x.fecha_envio);
  const info = (await client.query(`select
      (select count(*) from operacion.pedido pe left join operacion.pedido_ds d on d.pedido_id = pe.id where pe.plazo_dias is null and pe.estado = 'confirmado' and coalesce(d.tipo_venta, 'cliente') <> 'socio_a_costo') as confirmados_sin_plazo,
      (select count(*) from operacion.pedido pe join operacion.pedido_ds d on d.pedido_id = pe.id where d.tipo_venta = 'socio_a_costo' and pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) > 0
          and not exists (select 1 from operacion.ds_pedido_compromiso c where c.pedido_id = pe.id and c.fecha_compromiso is not null)) as a_costo_sin_fecha`)).rows[0];
  console.log(`Pedidos enviados a credito sin plazo: ${cand.length} (fecha de pago ${a.fecha}).`);
  console.log(`  Aplicables: ${aplicables.length}${aplicables.length ? ` -> ${aplicables.map((x) => `${x.folio} (${x.dias} dias desde el envio)`).join(', ')}` : ''}`);
  console.log(`  NO aplicables (envio igual o posterior a la fecha; plazo <= 0, no se tocan): ${noAplicables.length}${noAplicables.length ? ` -> ${noAplicables.map((x) => x.folio).join(', ')}` : ''}`);
  console.log(`  Con fecha de pedido distinta de la de envio (el plazo se cuenta desde el envio): ${distintaFecha.length}`);
  console.log(`  Informativo, no se tocan: ${info.confirmados_sin_plazo} confirmados sin plazo (aun no enviados); ${info.a_costo_sin_fecha} pedidos a costo del socio de menudeo sin fecha comprometida.`);
  if (a.verificar) {
    console.log('Verificacion: solo lectura, no se escribio nada.');
  } else {
    const uuid = (await client.query("select id from seguridad.usuario where rol = 'socio' and activo and socio_nombre = $1", [a.actor])).rows[0]?.id;
    if (!uuid) throw new Error(`no hay un usuario socio activo para ${a.actor}`);
    let hechos = 0;
    for (const p of aplicables) {
      await client.query('begin');
      try {
        await client.query("select set_config('request.jwt.claim.sub', $1, true)", [uuid]);
        await client.query('select api.acordar_plazo($1, $2, $3)', [`plazo-pendiente:${p.folio}:${a.fecha}`, p.id, p.dias]);
        const v = (await client.query('select (fecha_envio + plazo_dias)::text as vence from operacion.pedido where id = $1', [p.id])).rows[0].vence;
        if (v !== a.fecha) throw new Error(`el vencimiento de ${p.folio} quedo en ${v} y no en ${a.fecha}`);
        await client.query('commit');
        hechos++;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      }
    }
    const pendientes = (await client.query(SQL_CANDIDATOS, [a.fecha])).rows.filter((x) => x.dias > 0).length;
    console.log(`Aplicado: ${hechos} pedido(s) con plazo; vencimiento verificado = ${a.fecha}. Aplicables que siguen sin plazo: ${pendientes}.`);
    if (pendientes > 0) codigo = 1;
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  codigo = 1;
} finally {
  await client.end();
}
process.exit(codigo);
