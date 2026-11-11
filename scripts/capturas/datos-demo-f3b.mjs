// Datos ILUSTRATIVOS de F3b para las capturas: un asiento manual de apertura, una compra con faltante asignado a un socio, y el ciclo de una semana terminada
// (preparada y aprobada) con un gasto tardio que cae en el periodo abierto como ajuste del periodo afectado. Se corre despues de datos-demo-f3a.mjs.
// NUNCA datos reales de ventas, compras ni pagos: las cifras son inventadas.
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const url = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = (sql, args = []) => c.query(sql, args);

try {
  await q('begin');
  // Un socio ilustrativo para las funciones que exigen sesion de socio (preparar y aprobar periodos).
  await q("insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('demo.f3b@example.test', 'socio', 'Javier', true) on conflict (correo) do nothing");
  await q("insert into auth.users (id, instance_id, aud, role, email) values ('7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo.f3b@example.test') on conflict do nothing");
  await q("select set_config('request.jwt.claim.sub', '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true)");

  await q("select contabilidad.registrar_asiento_manual('demo3b:ap1', negocio.hoy() - 9, 'Saldo de apertura ilustrativo del cuadre inicial', '[{\"cuenta\":\"1101\",\"debe_cent\":250000},{\"cuenta\":\"3990\",\"haber_cent\":250000}]'::jsonb, true)");
  await q('select contabilidad.asentar_pendientes()');

  // La semana anterior (terminada) se prepara y se aprueba: las comprobaciones bloqueantes deben cuadrar.
  const sem = await q("select p.id from contabilidad.periodo p where p.tipo = 'semana' and p.estado = 'abierto' and p.fin < negocio.hoy() and exists (select 1 from contabilidad.asiento a where a.periodo_semana_id = p.id) order by p.ini desc limit 1");
  if (sem.rows.length === 1) {
    const id = Number(sem.rows[0].id);
    await q('select contabilidad.preparar_periodo($1,$2)', ['demo3b:prep', id]);
    await q('select contabilidad.aprobar_periodo($1,$2)', ['demo3b:aprob', id]);
    // Gasto que se conoce tarde: fecha de la semana aprobada, se registra en el periodo abierto con marca de periodo afectado.
    await q("select operacion.registrar_gasto_socio('demo3b:g1','Javier',25000,'uber','variable',negocio.hoy() - 8,null,'Gasto tardio ilustrativo')");
  }
  await q('commit');
  console.log('Datos ilustrativos de F3b cargados.');
} catch (e) {
  await q('rollback').catch(() => {});
  throw e;
} finally {
  await c.end();
}
