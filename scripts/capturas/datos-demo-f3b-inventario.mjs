// Datos ILUSTRATIVOS de F3b-2 para las capturas: varios modelos con historia (para ver cada estado del semaforo), un conteo con diferencias, dos documentos
// PDF guardados y un par de avisos del latido. Se corre despues de datos-demo-f3b.mjs. NUNCA datos reales de ventas, compras ni pagos.
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const url = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = (sql, args = []) => c.query(sql, args);

try {
  await q('begin');
  await q("select set_config('rtm.canal', 'importacion', true)");
  // Modelos ILUSTRATIVOS propios (nombres inventados) con historia de 40 dias para que se vea cada estado del semaforo.
  const libres = ['Demo Cobertura Urge 50K', 'Demo Cobertura Excelente 50K', 'Demo Cobertura Sobrestock 50K', 'Demo Cobertura Pedir 15K', 'Demo Cobertura Quieto 15K', 'Demo Cobertura Nuevo 15K', 'Demo Cobertura Agotado 15K'];
  for (const m of libres) await q("select catalogo.asegurar_modelo('Marca Demo Cobertura', $1, 15000, 'ambas')", [m]);
  const sabores = ['Fresa helada', 'Mango', 'Menta', 'Uva'];
  const escenarios = [
    // [entrada, salidas de 42 en 4 fechas (0 = ninguna), dias de la entrada]
    { entrada: 200, salidas: 4, dias: 40, valor: 10000 },   // urge
    { entrada: 400, salidas: 4, dias: 40, valor: 9500 },    // excelente
    { entrada: 800, salidas: 4, dias: 40, valor: 11000 },   // sobrestock
    { entrada: 120, salidas: 2, dias: 40, valor: 12000 },   // brevedad o siguiente
    { entrada: 60, salidas: 0, dias: 40, valor: 8000 },     // sin movimiento
    { entrada: 80, salidas: 0, dias: 6, valor: 9000 },      // sin historia
    { entrada: 50, salidas: 1, dias: 40, valor: 7000 },     // agotado
  ];
  let n = 0;
  for (let i = 0; i < Math.min(libres.length, escenarios.length); i += 1) {
    const modelo = libres[i];
    const e = escenarios[i];
    const sabs = sabores.slice(0, i % 2 === 0 ? 3 : 2);
    for (const s of sabs) await q('select catalogo.asegurar_sku($1,$2)', [modelo, s]);
    const porSabor = Math.floor(e.entrada / sabs.length);
    for (const s of sabs) {
      n += 1;
      await q("select operacion.registrar_movimiento($1,$2,$3,'bodega_omar','entrada_compra',$4::int,$5::bigint,negocio.hoy() - $6::int,'Compra ilustrativa')", [`demo3b2:e${n}`, modelo, s, porSabor, porSabor * e.valor, e.dias]);
    }
    const fechas = [20, 15, 10, 5];
    for (let j = 0; j < e.salidas; j += 1) {
      n += 1;
      const total = i === 6 ? 50 : 42;
      const reparte = Math.floor(total / sabs.length);
      for (let k = 0; k < sabs.length; k += 1) {
        const cant = k === sabs.length - 1 ? total - reparte * (sabs.length - 1) : reparte;
        const maxima = (await q("select coalesce(u.piezas,0) as p from catalogo.sku k join catalogo.sabor sa on sa.id = k.sabor_id left join operacion.existencia_sku_ubicacion u on u.sku_id = k.id and u.ubicacion = 'bodega_omar' where k.modelo_id = (select id from catalogo.modelo where nombre_canonico = $1) and sa.nombre_canonico = $2", [modelo, sabs[k]])).rows[0].p;
        if (maxima < cant) continue;
        await q("select operacion.registrar_movimiento($1,$2,$3,'bodega_omar','salida_pedido',$4::int,null,negocio.hoy() - $5::int,'Pedido ilustrativo')", [`demo3b2:s${n}:${k}`, modelo, sabs[k], -cant, i === 6 ? 3 : fechas[j]]);
      }
    }
  }
  await q('commit');

  // Conteo con diferencias, documentos PDF y aviso del latido, con un socio ilustrativo (sesion de socio para las funciones api).
  await q('begin');
  await q("select set_config('request.jwt.claim.sub', '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true)");
  const hoja = (await q('select api.conteo_hoja($1) as j', ['bodega_omar'])).rows[0].j;
  const lineas = hoja.slice(0, 6).map((h, i) => ({ sku_id: h.sku_id, contado: null, i }));
  const esperados = (await q('select sku_id, piezas from operacion.existencia_sku_ubicacion where ubicacion = $1', ['bodega_omar'])).rows;
  const mapa = new Map(esperados.map((r) => [Number(r.sku_id), Number(r.piezas)]));
  const conteo = lineas.map((l, i) => ({ sku_id: l.sku_id, contado: Math.max(0, (mapa.get(l.sku_id) ?? 0) - (i === 1 ? 3 : i === 3 ? 1 : 0)), explicacion_tipo: i === 1 ? 'venta_no_registrada' : null }));
  const abierto = (await q("select api.abrir_conteo('demo3b2:conteo', 'bodega_omar', 'semanal', now() - interval '2 hours') as j")).rows[0].j;
  await q("select api.cerrar_conteo('demo3b2:conteo:c', $1, $2::jsonb)", [abierto.conteo_id, JSON.stringify(conteo)]);
  await q("select api.reservar_documento_inventario('web:demo3b2-doc-1', 'clientes', '{\"solo_disponibles\": true}'::jsonb)");
  await q('commit');
  console.log('Datos ilustrativos de F3b-2 (inventario) cargados.');
} catch (e) {
  await q('rollback').catch(() => {});
  console.error(`Fallo la carga de demostracion: ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
