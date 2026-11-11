// Datos ILUSTRATIVOS para las capturas de F1: existencias y un cambio de precio sobre el catalogo importado desde los fixtures.
// Solo para una base recien reiniciada (lo orquesta capturas-f1.mjs). Nunca toca datos reales.
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const url = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query('begin');
  await c.query("select set_config('rtm.canal', 'importacion', true)");
  const entradas = [
    ['Alfa Uno 50K', 'Fresa helada', 120, 20000], ['Alfa Uno 50K', 'Mango', 80, 20000], ['Alfa Uno 50K', 'Menta', 45, 20000],
    ['Beta Tres 15K', 'Uva', 60, 10000], ['Beta Tres 15K', 'Sandia', 40, 10000],
  ];
  let i = 0;
  for (const [modelo, sabor, n, costo] of entradas) {
    i += 1;
    await c.query('select catalogo.asegurar_sku($1,$2)', [modelo, sabor]);
    await c.query("select operacion.registrar_movimiento($1,$2,$3,'bodega_omar','entrada_compra',$4,$5,negocio.hoy(),'Compra ilustrativa')", [`demo:e${i}`, modelo, sabor, n, n * costo]);
  }
  await c.query("select operacion.registrar_movimiento('demo:s1','Alfa Uno 50K','Fresa helada','bodega_omar','salida_pedido',-30,null,negocio.hoy(),'Pedido ilustrativo')");
  // Un cambio de precio para que la ficha tenga historial y la linea se dibuje.
  await c.query("select catalogo.fijar_precio('demo:p1','Cliente Costa','Uno',12000,'2026-11-12','chat','Ajuste ilustrativo')");
  await c.query('commit');
  console.log('Datos ilustrativos de demostracion cargados.');
} catch (e) {
  await c.query('rollback');
  console.error(`Fallo la carga de demostracion: ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
