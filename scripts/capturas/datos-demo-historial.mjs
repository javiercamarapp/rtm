// Datos ILUSTRATIVOS para las capturas y la prueba e2e del Historial personal y el acta de corte: capital de los dos socios, pedidos de agosto a octubre de 2026 con
// clientes y cifras inventadas, pagos, gastos y dos actas firmadas (agosto y septiembre; octubre queda abierto para proponerlo desde la web). NUNCA datos reales.
// Uso: node scripts/capturas/datos-demo-historial.mjs   (contra la base local del proyecto; si ya hay actas, no hace nada)
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const url = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = (sql, args = []) => c.query(sql, args);
const UID = { Angelo: '7b1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', Javier: '7b1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2' };
const como = (s) => q('select set_config($1, $2, false)', ['request.jwt.claim.sub', UID[s]]);
let n = 0;
const k = (p) => `${p}:${(n += 1)}`;
const cid = async (nombre) => (await q('select id from catalogo.cliente where nombre_canonico = $1', [nombre])).rows[0].id;

try {
  const hay = await q("select count(*)::int as n from operacion.cierre_reparto where folio is not null");
  if (hay.rows[0].n > 0) { console.log('Ya hay actas: no se siembra nada.'); process.exit(0); }
  for (const [s, id] of Object.entries(UID)) {
    await q("insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ($1, 'socio', $2, true) on conflict (correo) do nothing", [`demo.hist.${s.toLowerCase()}@demo-historial.invalid`, s]);
    await q("insert into auth.users (id, instance_id, aud, role, email) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2) on conflict (id) do nothing", [id, `demo.hist.${s.toLowerCase()}@demo-historial.invalid`]);
  }
  await como('Angelo');

  // Catalogo ilustrativo.
  await q("select catalogo.asegurar_cliente('Demo Cliente Alfa', 'Angelo')");
  await q("select catalogo.asegurar_cliente('Demo Cliente Beta', 'Javier')");
  await q("select catalogo.asegurar_cliente('Demo Cliente Gama', 'Javier')");
  const modelos = [['Demo Marca Uno', 'Demo Nube 25K', 'Mango', 9000, 17000], ['Demo Marca Uno', 'Demo Brisa 15K', 'Fresa', 6500, 12500], ['Demo Marca Dos', 'Demo Ola 40K', 'Hielo', 11000, 21000]];
  for (const [marca, mo, sa, costo, precio] of modelos) {
    await q("select catalogo.asegurar_modelo($1, $2, 15000, 'ambas')", [marca, mo]);
    await q('select catalogo.asegurar_sku($1, $2)', [mo, sa]);
    await q("select catalogo.fijar_costo($1, 'Isaac', $2, $3, '2026-01-01', 'prueba')", [k('hc'), mo, costo]);
    for (const cl of ['Demo Cliente Alfa', 'Demo Cliente Beta', 'Demo Cliente Gama']) await q("select catalogo.fijar_precio($1, $2, $3, $4, '2026-01-01', 'chat')", [k('hp'), cl, mo, precio]);
  }
  // Capital que cada socio declara (invertido) y reembolso de caja.
  await q("select operacion.registrar_aportacion($1, 'Angelo', 4000000, 'Inversion inicial de Angelo (demo)', 'capital', '2026-07-20')", [k('ap')]);
  await q("select operacion.registrar_aportacion($1, 'Javier', 3000000, 'Inversion inicial de Javier (demo)', 'capital', '2026-07-21')", [k('ap')]);

  const ventas = async (mes, lista, pagaSocio) => {
    for (const [dia, cli, mo, sa, pz] of lista) {
      const fecha = `2026-${mes}-${String(dia).padStart(2, '0')}`;
      const clave = k('pe');
      await q('select operacion.crear_pedido($1, $2, $3::jsonb, $4, null, 0, 0, 0, $5::date)', [clave, await cid(cli), JSON.stringify([{ modelo: mo, sabor: sa, piezas: pz }]), 'isaac_directo', fecha]);
      const pid = (await q("select (resultado->>'pedido_id')::bigint as id from seguridad.operacion where clave = $1", [clave])).rows[0].id;
      await q('select operacion.confirmar_pedido($1, $2)', [k('pc'), pid]);
      await q("select operacion.enviar_pedido($1, $2, null, $3::jsonb, $4::date, true)", [k('ps'), pid, JSON.stringify({ paqueteria: 'Castores', numero: `DEMO-${n}`, costo_cent: 0 }), fecha]);
      const precio = modelos.find((m) => m[1] === mo)[4];
      await q("select operacion.registrar_pago($1, $2, $3, $4, null, true, 'abono', $5::date)", [k('pg'), pagaSocio(n), precio * pz, await cid(cli), fecha]);
    }
  };
  const alterna = () => 'Efectivo';
  await ventas('08', [[4, 'Demo Cliente Alfa', 'Demo Nube 25K', 'Mango', 60], [18, 'Demo Cliente Beta', 'Demo Ola 40K', 'Hielo', 40]], alterna);
  await q("select operacion.registrar_gasto_socio($1, 'Angelo', 150000, 'envio', 'variable', '2026-08-12', null, 'Guias del mes (demo)')", [k('gs')]);
  await q("select operacion.registrar_gasto_socio($1, 'Javier', 120000, 'costos del sistema', 'fijo', '2026-08-15', null, 'Suscripciones (demo)')", [k('gs')]);
  await ventas('09', [[2, 'Demo Cliente Gama', 'Demo Brisa 15K', 'Fresa', 120], [9, 'Demo Cliente Alfa', 'Demo Nube 25K', 'Mango', 90], [17, 'Demo Cliente Beta', 'Demo Ola 40K', 'Hielo', 70], [26, 'Demo Cliente Gama', 'Demo Nube 25K', 'Mango', 50]], alterna);
  await q("select operacion.registrar_gasto_socio($1, 'Javier', 200000, 'envio', 'variable', '2026-09-10', null, 'Guias del mes (demo)')", [k('gs')]);

  // Acta de agosto: Angelo retira todo lo suyo, Javier reinvierte la mitad.
  const acta = async (ini, fin, dec) => {
    await como('Angelo');
    const r = await q('select operacion.proponer_cierre_reparto($1, $2::date, $3::date, $4::jsonb) as r', [k('cr'), ini, fin, JSON.stringify(dec)]);
    const id = r.rows[0].r.cierre_id;
    await q('select operacion.firmar_cierre_reparto($1, $2)', [k('cf'), id]);
    await como('Javier');
    await q('select operacion.firmar_cierre_reparto($1, $2)', [k('cf'), id]);
    return id;
  };
  const disp = async (ini, fin, s) => { const r = (await q('select operacion.cascada_periodo($1::date, $2::date) as c', [ini, fin])).rows[0].c.por_socio[s]; return Math.max(r.utilidad_cent - r.anticipo_cent, 0); };
  await como('Angelo');
  let aA = await disp('2026-08-01', '2026-08-31', 'Angelo'); let aJ = await disp('2026-08-01', '2026-08-31', 'Javier');
  await acta('2026-08-01', '2026-08-31', { Angelo: { retira: aA, reinvierte: 0 }, Javier: { retira: Math.floor(aJ / 2), reinvierte: aJ - Math.floor(aJ / 2) } });
  // Retiros efectivos de agosto (salen de la caja de la empresa).
  await como('Angelo');
  await q("select operacion.registrar_pago_a_socio($1, 'Angelo', $2, 'retiro', 'efectivo', '2026-09-05')", [k('rt'), Math.min(aA, 300000)]);
  aA = await disp('2026-09-01', '2026-09-30', 'Angelo'); aJ = await disp('2026-09-01', '2026-09-30', 'Javier');
  await acta('2026-09-01', '2026-09-30', { Angelo: { retira: Math.floor(aA / 2), reinvierte: Math.floor(aA / 4) }, Javier: { retira: 0, reinvierte: aJ } });
  await ventas('10', [[1, 'Demo Cliente Beta', 'Demo Ola 40K', 'Hielo', 80], [6, 'Demo Cliente Alfa', 'Demo Brisa 15K', 'Fresa', 150], [13, 'Demo Cliente Gama', 'Demo Nube 25K', 'Mango', 110], [21, 'Demo Cliente Alfa', 'Demo Ola 40K', 'Hielo', 60], [28, 'Demo Cliente Beta', 'Demo Nube 25K', 'Mango', 100]], alterna);
  await q("select operacion.registrar_gasto_socio($1, 'Angelo', 250000, 'envio', 'variable', '2026-10-20', null, 'Guias del mes (demo)')", [k('gs')]);
  console.log('Demo del historial sembrada: actas de agosto y septiembre firmadas; octubre abierto.');
} finally {
  await c.end();
}
