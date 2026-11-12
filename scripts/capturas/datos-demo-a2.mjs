// Datos ILUSTRATIVOS de la etapa 2 (A2) para las capturas: ~100 dias de compras y ventas en varios modelos y sabores de dos marcas, mermas, libro de dinero
// importado y cobros en cajas de socios. Se corre despues de datos-demo-f3b-inventario.mjs. NUNCA datos reales: nombres y cifras inventados.
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const url = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = (sql, args = []) => c.query(sql, args);
let n = 0;
const mov = (modelo, sabor, tipo, cant, valor, dias, nota = null) => { n += 1; return q("select operacion.registrar_movimiento($1,$2,$3,'bodega_omar',$4,$5::int,$6::bigint,negocio.hoy() - $7::int,$8)", [`a2demo:${n}`, modelo, sabor, tipo, cant, valor, dias, nota]); };

try {
  await q('begin');
  await q("select set_config('rtm.canal', 'importacion', true)");
  await q("insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('demo.a2@example.test', 'socio', 'Javier', true) on conflict (correo) do nothing");
  await q("insert into auth.users (id, instance_id, aud, role, email) values ('7a2aaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo.a2@example.test') on conflict do nothing");
  await q("select set_config('request.jwt.claim.sub', '7a2aaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true)");

  const modelos = [
    ['A2 Nube 25K', 'Marca A2 Alfa', ['Mango', 'Uva', 'Menta', 'Sandia'], 11800],
    ['A2 Brisa 15K', 'Marca A2 Alfa', ['Fresa', 'Durazno'], 8900],
    ['A2 Ola 40K', 'Marca A2 Beta', ['Hielo', 'Cereza', 'Limon'], 12500],
  ];
  for (const [mo, marca, sabores] of modelos) {
    await q("select catalogo.asegurar_modelo($1, $2, 15000, 'ambas')", [marca, mo]);
    for (const s of sabores) await q('select catalogo.asegurar_sku($1,$2)', [mo, s]);
  }
  // Compras semanales (costo unitario cambia) y ventas escalonadas durante ~100 dias.
  for (const [mo, , sabores, costo] of modelos) {
    for (let sem = 14; sem >= 1; sem -= 3) {
      const unit = costo + (sem % 4) * 150;
      for (const s of sabores) await mov(mo, s, 'entrada_compra', 60 + (sem % 3) * 20, unit * (60 + (sem % 3) * 20), sem * 7 - (mo.length % 3), 'Compra ilustrativa');
      for (const [k, d] of [[1, 2], [2, 4]]) {
        for (const s of sabores) {
          const dispon = (await q("select coalesce(u.piezas,0)::int as p from catalogo.sku k join catalogo.sabor sa on sa.id = k.sabor_id left join operacion.existencia_sku_ubicacion u on u.sku_id = k.id and u.ubicacion='bodega_omar' where k.modelo_id = (select id from catalogo.modelo where nombre_canonico=$1) and sa.nombre_canonico=$2", [mo, s])).rows[0].p;
          const v = Math.min(dispon - 1, 14 * k);
          if (v > 0) await mov(mo, s, 'salida_pedido', -v, null, Math.max(0, sem * 7 - d), 'Pedido ilustrativo');
        }
      }
    }
  }
  await mov('A2 Nube 25K', 'Uva', 'merma', -4, null, 5, 'Piezas falladas ilustrativas');
  await mov('A2 Ola 40K', 'Cereza', 'merma', -2, null, 2, 'Daño en traslado ilustrativo');
  await mov('A2 Brisa 15K', 'Fresa', 'merma', -3, null, 7, 'Piezas falladas ilustrativas');
  // Libro de dinero ilustrativo (movimientos crudos): varias semanas, algunos clasificados despues.
  const filas = [];
  for (let i = 0; i < 40; i += 1) {
    const dias = 100 - i * 2;
    filas.push({ fecha: null, d: dias, monto: i % 3 === 2 ? -(180000 + i * 3100) : 250000 + i * 4300, msg: i % 3 === 2 ? `Pago ilustrativo ${i}` : `Cobro ilustrativo ${i}` });
  }
  const json = (await q("select jsonb_agg(jsonb_build_object('fecha', (negocio.hoy() - (x ->> 'd')::int)::text, 'monto_cent', (x ->> 'monto')::bigint, 'cuenta', 'Cuenta ilustrativa', 'origen', 'Importación ilustrativa', 'mensaje', x ->> 'msg')) as j from jsonb_array_elements($1::jsonb) x", [JSON.stringify(filas)])).rows[0].j;
  await q("select api.mov_importar('a2demo:libro', 'pegado', null, null, $1::jsonb)", [JSON.stringify(json)]);
  await q('select contabilidad.asentar_pendientes()');
  await q('commit');
  console.log(`Datos A2 ilustrativos cargados (${n} movimientos de inventario, ${filas.length} renglones de libro).`);
} catch (e) {
  await q('rollback');
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
