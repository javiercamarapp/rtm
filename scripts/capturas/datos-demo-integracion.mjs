// Datos ILUSTRATIVOS para las capturas de la integracion con base de datos: un modelo con costo de Karen y existencia propia, un estado del inventario de proveedores (lectura de hace
// 20 minutos, una promocion, un nombre por confirmar y cambios recientes) y cargos de costos del sistema con el caso dorado de Supabase (US$75, 10 de 60 horas, TC 18.50).
// NUNCA datos reales de ventas, compras, pagos ni saldos. Se corre despues de preparar-demo.mjs.
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const url = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = (sql, args = []) => c.query(sql, args);

const ceilDiv = (a, b) => (a >= 0n ? (a + b - 1n) / b : -(-a / b));
const techo = (num, den, paso = 100n) => ceilDiv(ceilDiv(num, den), paso) * paso;
const ppmTecho = (n, d) => ceilDiv(n * 100n, d) * 10000n;

function cargo({ clave, slug, mes, base, pctExacto, pctAplicado, tc, fase = 'mantenimiento', etiqueta, seria = null, deberia = null, nota = '' }) {
  const num = base * pctAplicado * tc;
  const puro = (base * pctExacto * tc) / 10n ** 10n;
  return [clave, slug, mes, new Date().toISOString().slice(0, 10), fase, String(base), 'USD', Number(pctExacto), Number(pctAplicado), String(tc), new Date().toISOString().slice(0, 10), 'manual', String(num / 10n ** 10n), String(puro),
    String(techo(num, 10n ** 16n)), seria === null ? null : String(seria), deberia === null ? null : String(deberia), 'javier', true, etiqueta, 'provisional', 'captura', null, nota];
}

try {
  await q('begin');
  await q("select set_config('rtm.canal', 'importacion', true)");
  const mes = new Date().toISOString().slice(0, 7);

  // Catalogo propio: un modelo con costo de Karen y existencia propia de dos sabores.
  await q("select catalogo.asegurar_modelo('Marca Demo Karen', 'Demo Karen 20K', 20000, 'ambas')");
  for (const s of ['Sandia', 'Mango', 'Uva', 'Fresa']) await q('select catalogo.asegurar_sku($1, $2)', ['Demo Karen 20K', s]);
  await q("select catalogo.fijar_costo('demoint:k', 'Karen', 'Demo Karen 20K', 9000, current_date - 10, 'demostracion')");
  await q("select operacion.registrar_movimiento('demoint:m1', 'Demo Karen 20K', 'Sandia', 'bodega_omar', 'entrada_compra', 12, 108000, current_date - 3)");
  await q("select operacion.registrar_movimiento('demoint:m2', 'Demo Karen 20K', 'Mango', 'bodega_omar', 'entrada_compra', 9, 81000, current_date - 3)");
  const canonico = (await q("select id::text as id from catalogo.modelo where nombre_canonico = 'Demo Karen 20K'")).rows[0].id;

  // Inventario actual de proveedores: lectura de hace 20 minutos.
  const t = new Date(Date.now() - 20 * 60_000).toISOString();
  const m = (id, titulo, marca, puffs, canon, nuevoSinCosto) => ({ id, handle: titulo.toLowerCase().replace(/\s+/g, '-'), titulo, tituloNorm: titulo.toLowerCase(), aliasTitulos: [], marca, puffs, estado: 'activo', primeraVez: t, ultimaVez: t, ausencias: 0, primeraAusencia: null, sinSabores: false, nuevoSinCosto, mapeo: canon ? 'confirmado' : 'pendiente', canonicoId: canon, gruposCandidatos: [] });
  const v = (id, prod, nombre, disponible, canon = null) => ({ id, productoId: prod, saborOriginal: nombre, saborNorm: nombre.toLowerCase(), disponible, estado: 'activa', ausencias: 0, primeraAusencia: null, mapeo: canon ? 'confirmado' : 'pendiente', saborCanonicoId: canon, cambios: [], inestableHasta: null, primeraVez: t, ultimaVez: t });
  const modelos = [m('9100000000001', 'Demo Karen 20K', 'Marca Demo Karen', 20000, canonico, false), m('9100000000002', 'Demo Nuevo 30K', 'Marca Demo Karen', 30000, null, true), m('9100000000003', 'Demo Otra 8K', 'Marca Demo Dos', 8000, null, true)];
  const variantes = [
    v('9100000000101', '9100000000001', 'Sandia', true), v('9100000000102', '9100000000001', 'Mango', true), v('9100000000103', '9100000000001', 'Uva', false), v('9100000000104', '9100000000001', 'Fresa', true),
    v('9100000000201', '9100000000002', 'Menta helada', true), v('9100000000202', '9100000000002', 'Durazno', true), v('9100000000301', '9100000000003', 'Cereza', true), v('9100000000302', '9100000000003', 'Limon', false),
  ];
  const estado = {
    version: 1, inicializado: true, tarjetasPromo: 1, modelos: Object.fromEntries(modelos.map((x) => [x.id, x])), variantes: Object.fromEntries(variantes.map((x) => [x.id, x])), candidatos: {}, retenida: null,
    promociones: { p1: { clave: 'p1', tipo: 'porcentaje', pct: 15, etiqueta: '15 % en 2 modelos', alcance: ['9100000000001', '9100000000002'], inicio: null, fin: new Date(Date.now() + 3 * 86_400_000).toISOString(), primeraVista: t, ultimaVista: t, lecturasAusente: 0, estado: 'activa', avisoPorTerminar: false, coleccion: null } },
    cola: [{ tipo: 'sabor', textoOriginal: 'Fresa Kiwi Hielo', textoNorm: 'fresa kiwi hielo', sugerenciaId: null, similitud: 0.72, creada: t }],
    historialVariedad: {}, variedad: {}, salud: { ultimaLecturaOk: t, ultimoIntento: t, fallosSeguidos: 0, bloqueada: false, incidente: null }, lecturasProcesadas: [],
  };
  const ev = (k, tipo, prod, despues, min) => ({ clave: `${k}|demo`, tipo, productoId: prod, varianteId: null, lectura: 'demo', en: new Date(Date.now() - min * 60_000).toISOString(), antes: null, despues, datos: {} });
  const eventos = [ev('a', 'modelo_nuevo', '9100000000002', 'Demo Nuevo 30K', 130), ev('b', 'sabor_agotado', '9100000000001', 'Uva', 75), ev('c', 'promocion_nueva', null, '15 % en 2 modelos', 40), ev('d', 'sabor_regreso', '9100000000003', 'Cereza', 25)];
  await q('select proveedores.guardar_estado($1::jsonb, $2::jsonb, $3::text)', [JSON.stringify(estado), JSON.stringify(eventos), 'demoint:prov']);
  await q("select proveedores.guardar_foto_diaria(current_date, '[{\"varianteId\":\"9100000000101\",\"disponible\":true}]')");

  // Costos del sistema (tipo de cambio 18.50 capturado).
  await q("select costos.registrar_tipo_cambio('demoint:tc', current_date, 18500000, 'manual')");
  const TC = 18_500_000n;
  const supabase = { clave: 'demoint:c1', slug: 'supabase', mes, base: 75_000_000n, pctExacto: 166_666n, pctAplicado: ppmTecho(10n, 60n), tc: TC, etiqueta: 'atribuido', nota: 'Participacion por horas de computo 10 de 60' };
  const vercelParticipacion = ppmTecho(5n, 100n);
  const vercel = { clave: 'demoint:c2', slug: 'vercel', mes, base: 20_000_000n, pctExacto: 1_000_000n, pctAplicado: 1_000_000n, tc: TC, etiqueta: 'atribuido', seria: techo(20_000_000n * 1_000_000n * TC, 10n ** 16n), deberia: techo(60_000_000n * vercelParticipacion * TC, 10n ** 16n), nota: 'Se cobra el mayor entre la cuota del documento y el consumo real' };
  const openrouter = { clave: 'demoint:c3', slug: 'openrouter', mes, base: 4_200_000n, pctExacto: 1_000_000n, pctAplicado: 1_000_000n, tc: TC, etiqueta: 'medido', nota: 'Consumo de RTM en el libro propio' };
  const claude = { clave: 'demoint:c4', slug: 'claude_max', mes, base: 36_000_000n, pctExacto: 180_000n, pctAplicado: 180_000n, tc: TC, fase: 'construccion', etiqueta: 'estimado_prorrateado', nota: 'Participacion por tokens, 18 %' };
  for (const x of [supabase, vercel, openrouter, claude]) {
    await q('select costos.registrar_cargo($1,$2,$3,$4::date,$5,$6::bigint,$7,$8::int,$9::int,$10::bigint,$11::date,$12,$13::bigint,$14::bigint,$15::bigint,$16::bigint,$17::bigint,$18,$19,$20,$21,$22,$23,$24)', cargo(x));
  }
  await q("select costos.registrar_reembolso('demoint:r1', 'javier', 'angelo', 10000, current_date, 'transferencia', null)");
  await q('commit');
  console.log('Datos de demostracion de la integracion cargados (todo ilustrativo).');
} catch (e) {
  await q('rollback').catch(() => {});
  console.error(`Fallo la carga de demostracion: ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
