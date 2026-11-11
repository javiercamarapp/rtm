// Datos ILUSTRATIVOS de la apertura y de Movimientos para las capturas: una sesion de apertura con partidas en los pasos 3 a 8 firmada solo por Angelo (queda "Falta la
// firma de Javier") y 14 movimientos crudos, unos clasificados, uno conciliado y uno descartado. Se corre despues de datos-demo-f3b-inventario.mjs.
// NUNCA datos reales de ventas, compras, pagos ni saldos: las cifras son inventadas (aportaciones 84,615.00 y 56,000.00 y 12 piezas del caso dorado).
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const url = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = (sql, args = []) => c.query(sql, args);
const ANGELO = '7bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01';

try {
  await q('begin');
  await q("insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('demo.apertura.angelo@example.test', 'socio', 'Angelo', true) on conflict (correo) do nothing");
  await q("insert into auth.users (id, instance_id, aud, role, email) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo.apertura.angelo@example.test') on conflict do nothing", [ANGELO]);
  await q("select set_config('request.jwt.claim.sub', $1, true)", [ANGELO]);
  await q("select set_config('rtm.canal', 'importacion', true)");

  // Un modelo ilustrativo propio, sin movimientos, con tres sabores: la apertura es su primer movimiento.
  await q("select catalogo.asegurar_modelo('Marca Demo Apertura', 'Demo Apertura 50K', 50000, 'ambas')");
  const skus = [];
  for (const sabor of ['Fresa helada', 'Mango', 'Uva']) skus.push(Number((await q('select catalogo.asegurar_sku($1, $2) as id', ['Demo Apertura 50K', sabor])).rows[0].id));
  const clientes = (await q('select id from catalogo.cliente where activo order by id limit 2')).rows.map((r) => Number(r.id));
  const isaac = Number((await q("select id from catalogo.proveedor where nombre = 'Isaac'")).rows[0].id);
  const karen = Number((await q("select id from catalogo.proveedor where nombre = 'Karen'")).rows[0].id);
  if (skus.length < 3 || clientes.length < 2) throw new Error('faltan sabores sin movimientos o clientes en el catalogo de los fixtures');

  const s = (await q("select api.apertura_crear('demoap:s', negocio.hoy() - 2, 'Sesion ilustrativa para las capturas') as j")).rows[0].j.sesion_id;
  let n = 0;
  const agregar = (cat, datos) => q('select api.apertura_agregar($1, $2, $3, $4::jsonb)', [`demoap:p${(n += 1)}`, s, cat, JSON.stringify(datos)]);
  await agregar('aportacion', { socio: 'Angelo', monto_cent: 8461500 });
  await agregar('aportacion', { socio: 'Javier', monto_cent: 5600000 });
  await agregar('reembolso_socio', { socio: 'Javier', monto_cent: 122100, descripcion: 'Costos del sistema pagados por Javier' });
  await agregar('inventario', { sku_id: skus[0], piezas: 500, costo_unit_cent: 9155 });
  await agregar('inventario', { sku_id: skus[1], piezas: 600, costo_unit_cent: 9155 });
  await agregar('inventario', { sku_id: skus[2], piezas: 424, costo_unit_cent: 9155 });
  await agregar('caja', { socio: 'Angelo', monto_cent: 50000 });
  await agregar('fondos_en_poder', { socio: 'Javier', monto_cent: 900000 });
  const fechas = (await q("select (negocio.hoy() - g)::text as d from generate_series(0, 60) g order by g")).rows.map((r) => r.d);
  const dia = (k) => fechas[k + 2];   // k dias antes del corte (el corte es hoy - 2)
  await agregar('cxc', { cliente_id: clientes[0], monto_cent: 750000, fecha_ref: dia(15) });
  await agregar('cxc', { cliente_id: clientes[1], monto_cent: 325000, fecha_ref: dia(30) });
  await agregar('proveedor_a_favor', { proveedor_id: karen, monto_cent: 3050000, descripcion: 'Anticipo ilustrativo' });
  await agregar('proveedor_debemos', { proveedor_id: isaac, monto_cent: 300000 });
  await agregar('utilidad_no_repartida', { socio: 'Javier', monto_cent: 200000 });
  await agregar('retiro_previo', { socio: 'Angelo', monto_cent: 100000 });
  await agregar('deuda_faltante_socio', { socio: 'Angelo', piezas: 12, monto_cent: 109855 });
  await q("select api.apertura_resolucion('demoap:res', $1, 'capital_50_50', 'Diferencia ilustrativa explicada por el conteo inicial de la prueba')", [s]);
  await q("select api.apertura_firmar('demoap:firma-angelo', $1)", [s]);

  // Movimientos crudos ilustrativos
  const dias = (k) => fechas[k];     // k dias antes de hoy
  const filas = [
    [dias(20), 1000000, 'Cuenta ilustrativa A', 'Cliente uno', 'Cobro del pedido de la semana'],
    [dias(19), 725000, 'Cuenta ilustrativa A', 'Cliente dos', 'Cobro parcial'],
    [dias(18), 380000, 'Cuenta ilustrativa B', 'Cliente tres', 'Abono'],
    [dias(17), -2500000, 'Cuenta ilustrativa A', 'Proveedor Isaac', 'Pago semanal'],
    [dias(16), -1200000, 'Cuenta ilustrativa A', 'Proveedor Karen', 'Pago anticipado'],
    [dias(15), 1500000, 'Cuenta ilustrativa B', 'Socio', 'Deposito de capital'],
    [dias(14), -122100, 'Cuenta ilustrativa B', 'Servicio', 'Costos del sistema del mes'],
    [dias(13), 450000, 'Cuenta ilustrativa A', 'Cliente uno', 'Cobro'],
    [dias(12), 220000, 'Cuenta ilustrativa B', 'Sin nombre', 'Deposito sin nombre'],
    [dias(11), -80000, 'Cuenta ilustrativa B', 'Paqueteria', 'Guias de la semana'],
    [dias(10), 610000, 'Cuenta ilustrativa A', 'Cliente dos', 'Cobro'],
    [dias(9), -300000, 'Cuenta ilustrativa A', 'Socio', 'Retiro ilustrativo'],
    [dias(8), 99900, 'Cuenta ilustrativa A', 'Duplicado', 'Cobro repetido por error'],
    [dias(7), 1500000, 'Cuenta ilustrativa B', 'Socio', 'Fondos de clientes en cuenta personal'],
  ].map(([fecha, monto, cuenta, origen, mensaje]) => ({ fecha, monto_cent: monto, cuenta, origen, mensaje }));
  await q("select api.mov_importar('demoap:imp1', 'archivo', 'movimientos-ilustrativos.csv', repeat('a', 64), $1::jsonb)", [JSON.stringify(filas)]);
  const id = async (msg) => Number((await q('select id from operacion.movimiento_crudo where mensaje_original = $1', [msg])).rows[0].id);
  const clasif = async (clave, msg, tipo, ref, motivo = null) => q('select api.mov_clasificar($1, $2, $3, $4::jsonb, $5)', [`demoap:${clave}`, await id(msg), tipo, JSON.stringify(ref), motivo]);
  await clasif('c1', 'Cobro del pedido de la semana', 'cobro_cliente', { cliente_id: clientes[0] });
  await clasif('c2', 'Cobro parcial', 'cobro_cliente', { cliente_id: clientes[1] });
  await clasif('c3', 'Abono', 'cobro_cliente', { cliente_id: clientes[1] });
  await clasif('c4', 'Pago semanal', 'pago_proveedor', { proveedor_id: isaac });
  await clasif('c5', 'Pago anticipado', 'pago_proveedor', { proveedor_id: karen });
  await clasif('c6', 'Deposito de capital', 'aportacion', { socio: 'Angelo' });
  await clasif('c7', 'Cobro', 'cobro_cliente', { cliente_id: clientes[0] }).catch(() => {});
  await clasif('c8', 'Fondos de clientes en cuenta personal', 'fondos_en_poder_socio', { socio: 'Javier' });
  await q('select api.mov_marcar($1, $2, $3, $4)', ['demoap:d1', await id('Cobro repetido por error'), 'duplicado', 'Es el mismo cobro que ya se cargo']);
  // Una aportacion de la cuenta de socios con la misma suma que el deposito: se concilia
  await q("select operacion.registrar_aportacion('demoap:ap', 'Angelo', 1500000, 'Aportacion ilustrativa', 'capital')");
  const ap = Number((await q("select id from operacion.aportacion_socio where concepto = 'Aportacion ilustrativa'")).rows[0].id);
  await q('select api.mov_conciliar($1, $2, $3, $4)', ['demoap:k1', await id('Deposito de capital'), 'aportacion', ap]);
  await q('commit');
  console.log('Datos ilustrativos de la apertura y de Movimientos cargados.');
} catch (e) {
  await q('rollback').catch(() => {});
  console.error(`Fallo la carga de demostracion: ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
