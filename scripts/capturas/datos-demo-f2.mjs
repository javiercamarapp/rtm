// Datos ILUSTRATIVOS para las capturas y las pruebas de F2: compras, recepcion con diferencia, pedidos, pagos y paquetes sobre el catalogo importado
// desde los fixtures (Cliente Alfa, Alfa Uno 50K...). Solo para una base recien reiniciada (lo orquesta capturas-f2.mjs). NUNCA datos reales de ventas,
// compras ni pagos: las cifras son inventadas, parecidas en forma a los casos dorados.
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
  const delta = await cli('Cliente Delta');

  // Karen: un cliente le manda 30,500 directo (queda a favor) y se pide una orden de 200 piezas.
  await q("select catalogo.fijar_costo('demo2:ck','Karen','Beta Tres 15K',8000,'2026-11-01','ilustrativo')");
  await q("select operacion.registrar_pago('demo2:pk','Karen',3050000,$1,null,false,'anticipo',negocio.hoy(),null,'Pago ilustrativo redirigido a Karen')", [delta]);
  const ocK = await id("select (operacion.crear_compra('demo2:ock','Karen',$1::jsonb,0,0,negocio.hoy())->>'compra_id')::bigint as id", [JSON.stringify([{ modelo: 'Beta Tres 15K', sabor: 'Uva', pagadas: 200 }])]);
  await q("select operacion.confirmar_compra('demo2:ockc',$1)", [ocK]);
  await q("select operacion.marcar_compra_enviada('demo2:ocke',$1,$2::jsonb,negocio.hoy()+4)", [ocK, JSON.stringify([{ paqueteria: 'Castores', numero: 'CAS-ILUSTRATIVA-1' }])]);

  // Isaac: 1,536 facturadas (1,552 pagadas), contadas 1,524 por sabor; las 12 faltantes se asignan a Angelo.
  const sabores = ['Fresa', 'Mango', 'Uva', 'Menta', 'Sandia', 'Durazno', 'Cereza', 'Limon', 'Pina', 'Coco'];
  await q("select catalogo.asegurar_sku('Nexa Ilustrativo 50K','Sin sabor')");
  for (const s of sabores) await q('select catalogo.asegurar_sku($1,$2)', ['Nexa Ilustrativo 50K', s]);
  const ocI = await id("select (operacion.crear_compra('demo2:oci','Isaac',$1::jsonb,237500,0,negocio.hoy(),'bodega','sociedad','Angelo','Angelo')->>'compra_id')::bigint as id", [JSON.stringify([{ modelo: 'Nexa Ilustrativo 50K', sabor: 'Sin sabor', pagadas: 1552, facturadas: 1536 }])]);
  await q("select operacion.confirmar_compra('demo2:ocic',$1)", [ocI]);
  await q("select operacion.marcar_compra_enviada('demo2:ocie',$1,$2::jsonb,negocio.hoy())", [ocI, JSON.stringify([{ paqueteria: 'Castores', numero: 'CAS-ILUSTRATIVA-2' }])]);
  await q("select operacion.marcar_llego_merida('demo2:ocil',$1)", [ocI]);
  const linea = await id('select id from operacion.compra_linea where compra_id = $1', [ocI]);
  const cuentas = [175, 192, 200, 200, 166, 28, 100, 159, 133, 171];
  await q("select operacion.recibir_compra('demo2:ocir',$1,$2::jsonb)", [ocI, JSON.stringify(sabores.map((s, i) => ({ linea_id: linea, sabor: s, piezas: cuentas[i] })))]);
  const dif = await id('select id from operacion.compra_diferencia order by id desc limit 1');
  await q("select operacion.asignar_diferencia('demo2:difa',$1,'socio','Angelo','Faltante de la recepcion ilustrativa')", [dif]);
  await q("select operacion.pago_proveedor_de_socio('demo2:ppi','Isaac',900000,'Javier','dinero_propio',negocio.hoy(),'Pago ilustrativo de un socio')");

  await q("select catalogo.asegurar_sku('Alfa Dos 50K','Mango')");

  // Pedidos: uno enviado, uno parcial (50 -> 40), uno por empacar con un sabor que falta, un borrador y uno con avisos.
  const ped = async (clave, cliente, lineas, extra = {}) => id("select (operacion.crear_pedido($1,$2,$3::jsonb,$4,null,$5,0,0,negocio.hoy(),null,$6)->>'pedido_id')::bigint as id", [clave, cliente, JSON.stringify(lineas), extra.origen ?? 'bodega_omar', extra.envio ?? 30000, extra.plazo ?? null]);
  const p1 = await ped('demo2:p1', alfa, [{ modelo: 'Alfa Uno 50K', sabor: 'Fresa helada', piezas: 20 }, { modelo: 'Alfa Uno 50K', sabor: 'Mango', piezas: 20 }], { plazo: 7 });
  await q("select operacion.confirmar_pedido('demo2:p1c',$1)", [p1]);
  await q("select operacion.enviar_pedido('demo2:p1s',$1,null,$2::jsonb,negocio.hoy(),true)", [p1, JSON.stringify({ paqueteria: 'Castores', numero: 'CAS-ILUSTRATIVA-3', costo_cent: 18000, pagada_por: 'Javier' })]);
  await q("select operacion.registrar_pago('demo2:pg1','Angelo',900000,$1,null,true,'abono',negocio.hoy(),null,'Pago ilustrativo de 9,000.00')", [alfa]);

  const p2 = await ped('demo2:p2', beta, [{ modelo: 'Nexa Ilustrativo 50K', sabor: 'Fresa', piezas: 50 }], { envio: 0 });
  await q("select operacion.confirmar_pedido('demo2:p2c',$1)", [p2]);
  const l2 = await id('select id from operacion.pedido_linea where pedido_id = $1', [p2]);
  await q("select operacion.enviar_pedido('demo2:p2s',$1,$2::jsonb,null,negocio.hoy(),true)", [p2, JSON.stringify([{ linea_id: l2, piezas: 40 }])]);

  const p3 = await ped('demo2:p3', alfa, [{ modelo: 'Alfa Uno 50K', sabor: 'Menta', piezas: 30 }, { modelo: 'Beta Tres 15K', sabor: 'Sandia', piezas: 100 }]);
  await q("select operacion.confirmar_pedido('demo2:p3c',$1)", [p3]);
  await ped('demo2:p4', beta, [{ modelo: 'Alfa Dos 50K', sabor: 'Mango', piezas: 12, precio_cent: 20000, motivo_precio: 'cierre de inventario' }], { envio: 0 });
  await q("select operacion.registrar_pago('demo2:pg2','Javier',300000,null,null,true,'abono',negocio.hoy(),null,'Pago ilustrativo sin identificar')");

  await q('commit');
  console.log('Datos ilustrativos de F2 cargados.');
} catch (e) {
  await q('rollback');
  console.error(`Fallo la carga de demostracion de F2: ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
