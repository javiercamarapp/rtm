// Datos ILUSTRATIVOS extra del lote A3: nueve semanas anteriores de asientos manuales (ventas cobradas, costo de ventas y un gasto fijo) para que las series de
// Contabilidad y las proyecciones tengan historia que dibujar. Los pedidos con fecha pasada no se pueden registrar (regla del kardex), por eso son asientos manuales.
// Se corre despues de datos-demo-f3b.mjs. NUNCA datos reales: cifras inventadas.
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const url = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = (sql, args = []) => c.query(sql, args);

try {
  await q('begin');
  await q("insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('demo.a3@example.test', 'socio', 'Javier', true) on conflict (correo) do nothing");
  await q("insert into auth.users (id, instance_id, aud, role, email) values ('7bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo.a3@example.test') on conflict do nothing");
  await q("select set_config('request.jwt.claim.sub', '7bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true)");
  const asiento = (clave, dias, motivo, lineas) => q('select contabilidad.registrar_asiento_manual($1, negocio.hoy() - $2::int, $3, $4::jsonb)', [clave, dias, motivo, JSON.stringify(lineas)]);
  for (let sem = 9; sem >= 1; sem--) {
    const base = sem * 7 + 1;
    const venta = 600000 + ((sem * 37) % 9) * 90000;
    await asiento(`demoa3:v${sem}`, base, 'Ventas cobradas ilustrativas de la semana', [{ cuenta: '1101', debe_cent: venta }, { cuenta: '4110', haber_cent: venta }]);
    await asiento(`demoa3:c${sem}`, base - 1, 'Costo de ventas ilustrativo de la semana', [{ cuenta: '5100', debe_cent: Math.round(venta * 0.68) }, { cuenta: '1310', haber_cent: Math.round(venta * 0.68) }]);
    await asiento(`demoa3:g${sem}`, base - 2, 'Gasto fijo ilustrativo de la semana', [{ cuenta: '6210', debe_cent: 45000 + sem * 2500 }, { cuenta: '1101', haber_cent: 45000 + sem * 2500 }]);
  }
  await q('select contabilidad.asentar_pendientes()');
  await q('commit');
  console.log('Datos ilustrativos del lote A3 cargados.');
} catch (e) {
  await q('rollback').catch(() => {});
  console.error(`Fallo la carga de demostracion del lote A3: ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
