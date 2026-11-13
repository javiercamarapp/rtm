// Datos ILUSTRATIVOS de F3a para las capturas: aportaciones y gastos de socios, fondos de la sociedad en poder de cada uno, una orden con descuento del proveedor,
// pedidos directos de Isaac con guia, un saldo vencido, renta y tomas de Omar (con una pendiente de autorizacion). Se corre despues de datos-demo-f2.mjs sobre una base reiniciada.
// NUNCA datos reales de ventas, compras ni pagos: las cifras son inventadas.
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const url = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = (sql, args = []) => c.query(sql, args);
const id = async (sql, args) => Number((await q(sql, args)).rows[0].id);

try {
  await q('begin');
  await q("select set_config('rtm.canal', 'importacion', true)");
  const cli = (n) => id('select id from catalogo.cliente where nombre_canonico = $1', [n]);
  const alfa = await cli('Cliente Alfa Completo');
  const beta = await cli('Cliente Beta');

  // Socios: capital, gastos pagados, fondos de la sociedad en poder de cada uno (cifras inventadas parecidas en forma al ejemplo de la adenda 21).
  await q("select operacion.registrar_aportacion('demo3:ap1','Javier',100000,'Capital adicional ilustrativo','capital')");
  await q("select operacion.registrar_gasto_socio('demo3:g1','Angelo',50000,'envio','variable',negocio.hoy(),null,'Guia ilustrativa')");
  await q("select operacion.registrar_gasto_socio('demo3:g2','Javier',122100,'costos del sistema','fijo',negocio.hoy(),null,'Suscripciones ilustrativas')");
  await q("select operacion.registrar_pago('demo3:pg1','Angelo',800000,$1,null,true,'abono',negocio.hoy() - 9,null,'Cobro ilustrativo en cuenta de Angelo')", [alfa]);
  await q("select operacion.registrar_pago('demo3:pg2','Javier',672100,$1,null,true,'abono',negocio.hoy() - 2,null,'Cobro ilustrativo en cuenta de Javier')", [beta]);

  // Pedidos: renta de Omar (bodega), directo de Isaac con guia y uno vencido.
  const ped = async (clave, cliente, lineas, origen, fecha, plazo, guia) => {
    const pid = await id("select (operacion.crear_pedido($1,$2,$3::jsonb,$4,null,0,0,0,$5::date,null,$6)->>'pedido_id')::bigint as id", [clave, cliente, JSON.stringify(lineas), origen, fecha, plazo]);
    await q('select operacion.confirmar_pedido($1,$2)', [`${clave}c`, pid]);
    await q('select operacion.enviar_pedido($1,$2,null,$3::jsonb,$4::date,true)', [`${clave}s`, pid, guia ? JSON.stringify(guia) : null, fecha]);
    return pid;
  };
  await ped('demo3:p1', alfa, [{ modelo: 'Alfa Uno 50K', sabor: 'Fresa helada', piezas: 20 }], 'bodega_omar', (await q('select negocio.hoy()::text h')).rows[0].h, null, null);
  await ped('demo3:p2', beta, [{ modelo: 'Alfa Uno 50K', sabor: 'Mango', piezas: 30, precio_cent: 20000, motivo_precio: 'ilustrativo' }], 'isaac_directo', (await q('select negocio.hoy()::text h')).rows[0].h, null, { paqueteria: 'Castores', numero: 'CAS-ILUSTRATIVA-F3A-1', costo_cent: 30700 });
  await ped('demo3:p3', alfa, [{ modelo: 'Alfa Uno 50K', sabor: 'Menta', piezas: 40, precio_cent: 20000, motivo_precio: 'ilustrativo' }], 'isaac_directo', (await q("select (negocio.hoy() - 1)::text h")).rows[0].h, 0, { paqueteria: 'Castores', numero: 'CAS-ILUSTRATIVA-F3A-2', costo_cent: 67200 });

  // Isaac: descuento del proveedor y pago de un socio a su cuenta.
  await q("select operacion.registrar_ajuste_proveedor('demo3:aj1','Isaac',100000,'descuento_proveedor','Descuento ilustrativo por volumen')");
  await q("select operacion.pago_proveedor_de_socio('demo3:pi1','Isaac',500000,'Javier','dinero_propio',negocio.hoy(),'Pago ilustrativo de un socio')");

  // Omar: una toma a su precio y una pendiente de autorizacion.
  await q("select operacion.registrar_toma_omar('demo3:t1',$1::jsonb,2,15000,negocio.hoy())", [JSON.stringify({ modelo: 'Alfa Uno 50K', sabor: 'Fresa helada' })]);
  await q("select operacion.registrar_toma_omar('demo3:t2',$1::jsonb,1,15000,negocio.hoy(),'telegram_omar')", [JSON.stringify({ modelo: 'Alfa Uno 50K', sabor: 'Mango' })]);

  // Un cierre de reparto propuesto para la semana anterior (firmado por nadie todavia).
  const ini = (await q("select (operacion.semana_omar_ini(negocio.hoy()) - 7)::text a, (operacion.semana_omar_ini(negocio.hoy()) - 1)::text b")).rows[0];
  await q("select operacion.proponer_cierre_reparto('demo3:cr1',$1::date,$2::date)", [ini.a, ini.b]);

  await q('commit');
  console.log('Datos ilustrativos de F3a cargados.');
} catch (e) {
  await q('rollback');
  console.error(`Fallo la carga de demostracion de F3a: ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
