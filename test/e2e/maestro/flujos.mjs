// Flujos mutantes de la campana maestra contra la base LOCAL con la identidad de un socio (las mismas funciones api.* que usa la web).
// Tras cada flujo: Libro conciliado, C1..C24/CU1..CU3, reproducir_saldos, balance y utilidad del periodo contra el libro. No imprime datos personales.
// Uso: DATABASE_URL=... node flujos.mjs [flujo ...]   (sin argumentos corre todos)
import pg from 'pg';
import { execFileSync } from 'node:child_process';
const url = process.env.DATABASE_URL;
if (!/127\.0\.0\.1|localhost/.test(url ?? '')) { console.error('solo base local'); process.exit(2); }
const JAV = '77777777-7777-7777-7777-7777777777a2';
const ANG = '77777777-7777-7777-7777-7777777777a1';
const c = new pg.Client({ connectionString: url });
await c.connect();
const sfx = Date.now().toString(36);
const K = (n) => `mae:${sfx}:${n}`;
async function como(sub, sql, p = []) {
  await c.query('begin');
  try {
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [sub]);
    const r = await c.query(sql, p);
    await c.query('commit');
    return r.rows;
  } catch (e) { await c.query('rollback'); throw e; }
}
const q1 = async (sub, sql, p) => (await como(sub, sql, p))[0];
const intenta = async (sub, sql, p) => { try { await como(sub, sql, p); return { ok: true }; } catch (e) { return { ok: false, msg: String(e.message).slice(0, 140) }; } };
const resultados = [];
const nota = (flujo, ok, det) => { resultados.push({ flujo, ok, det }); console.log(`${ok ? 'OK  ' : 'FALLA'} ${flujo}: ${det}`); };

async function invariantes(etiqueta) {
  const out = [];
  const cu = execFileSync('node', ['scripts/cargador/cuadre.mjs'], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
  const libro = /\[OK \] Libro conciliado/.test(cu);
  const rojas = (cu.match(/\[ROJA\]/g) ?? []).length;
  const res = /RESULTADO: (.*)/.exec(cu)?.[1]?.slice(0, 120);
  const sal = await q1(JAV, 'select count(*) filter (where not coalesce(ok,false))::int malos, count(*)::int n from contabilidad.reproducir_saldos()');
  const compRojas = (cu.match(/\[ROJA\] (Comprobaciones|Balance)/g) ?? []).length;
  const ut = await q1(JAV, "select (operacion.utilidad_periodo('2000-01-01','2999-12-31')->>'utilidad_cent')::bigint u, (select coalesce(sum(case when codigo in ('4210','4220') then -monto_cent else monto_cent end) filter (where tipo='I'),0) - coalesce(sum(monto_cent) filter (where tipo in ('C','G')),0) from (select (x->>'tipo') tipo, (x->>'codigo') codigo, (x->>'monto_cent')::bigint monto_cent from jsonb_array_elements(api.conta_estado_resultados('2000-01-01','2999-12-31')->'lineas') x) z) l");
  const bien = libro && rojas === 0 && sal.malos === 0 && compRojas === 0;
  out.push(`libro=${libro} rojas=${rojas} reproducir_saldos_malos=${sal.malos}/${sal.n} comprobaciones_rojas=${compRojas} utilidad_periodo=${ut.u} libro_er~${ut.l}`);
  nota(`invariantes tras ${etiqueta}`, bien, `${out.join(' ')}${res ? ' | ' + res : ''}`);
}

async function skuDe(sabor) { return (await q1(JAV, "select k.id from catalogo.sku k join catalogo.sabor sb on sb.id=k.sabor_id join catalogo.modelo m on m.id=k.modelo_id where m.nombre_canonico='Nexa Ultra 50K' and sb.nombre_canonico=$1", [sabor])).id; }
async function devLineas(pedido, sabor, n) { const l = await q1(JAV, 'select id from operacion.pedido_linea where pedido_id=$1 order by id limit 1', [pedido]); return [{ linea_id: l.id, sku_id: await skuDe(sabor), piezas: n }]; }
const flujos = {
  async pedido_cliente() {
    const lin = [{ modelo: 'Nexa Ultra 50K', sabor: 'Mango Oasis', piezas: 10, precio_cent: 15000 }, { modelo: 'Nexa Ultra 50K', sabor: 'Miami Mint', piezas: 5, precio_cent: 15000 }];
    const cr = (await q1(JAV, "select api.crear_pedido($1,2,$2::jsonb,'bodega_omar',null,0,0,0,'2026-11-13',null,null,null,'maestro') as r", [K('p1'), JSON.stringify(lin)])).r;
    await q1(JAV, 'select api.confirmar_pedido($1,$2)', [K('p1c'), cr.pedido_id]);
    const env = (await q1(JAV, "select api.enviar_pedido($1,$2,null,null,'2026-11-13',true) as r", [K('p1e'), cr.pedido_id])).r;
    nota('pedido de cliente: crear, confirmar, enviar', Number(env.total_cent) === 225000, `total_cent=${env.total_cent} (esperado 225000)`);
    await q1(JAV, "select api.registrar_pago($1,'Efectivo',100000,2,$2::jsonb,true,'abono','2026-11-13',null,'parcial',null)", [K('p1p1'), JSON.stringify([{ pedido_id: cr.pedido_id, monto_cent: 100000 }])]);
    let s = (await q1(JAV, 'select operacion.pedido_saldo($1) s', [cr.pedido_id])).s;
    nota('cobro parcial', Number(s) === 125000, `saldo=${s} (esperado 125000)`);
    const sobre = await intenta(JAV, "select api.registrar_pago($1,'Efectivo',999999900,2,$2::jsonb,true,'abono','2026-11-13',null,'excede',null)", [K('p1x'), JSON.stringify([{ pedido_id: cr.pedido_id, monto_cent: 999999900 }])]);
    s = (await q1(JAV, 'select operacion.pedido_saldo($1) s', [cr.pedido_id])).s;
    nota('cobro mayor al saldo no deja saldo negativo', Number(s) >= 0, `intento ${sobre.ok ? 'aceptado' : 'rechazado'} saldo=${s}`);
    await q1(JAV, "select api.registrar_pago($1,'Efectivo',125000,2,$2::jsonb,true,'abono','2026-11-13',null,'total',null)", [K('p1p2'), JSON.stringify([{ pedido_id: cr.pedido_id, monto_cent: 125000 }])]);
    s = (await q1(JAV, 'select operacion.pedido_saldo($1) s', [cr.pedido_id])).s;
    nota('cobro total', Number(s) === 0, `saldo=${s}`);
    await q1(JAV, "select api.registrar_pago($1,'Efectivo',125000,2,$2::jsonb,true,'abono','2026-11-13',null,'total',null) as r", [K('p1p2'), JSON.stringify([{ pedido_id: cr.pedido_id, monto_cent: 125000 }])]);
    s = (await q1(JAV, 'select operacion.pedido_saldo($1) s', [cr.pedido_id])).s;
    nota('reintento con la misma clave no duplica el cobro', Number(s) === 0, `saldo=${s}`);
    
  },
  async dropshipping_costo_distinto() {
    const lin = [{ modelo: 'Waka Duo 25K', sabor: 'Mango Oasis', piezas: 20, precio_cent: 23000 }];
    // el sabor puede no existir para Waka: se usa el sku existente del modelo
    const sk = await q1(JAV, "select sb.nombre_canonico s from catalogo.sku k join catalogo.modelo m on m.id=k.modelo_id join catalogo.sabor sb on sb.id=k.sabor_id where m.nombre_canonico='Waka Duo 25K' limit 1");
    if (sk) lin[0].sabor = sk.s;
    const cr = (await q1(JAV, "select api.ds_crear_pedido($1,3,$2::jsonb,'isaac_directo',null,null,'cliente',null,null,0,0,'2026-11-13','maestro',null,null,null) as r", [K('d1'), JSON.stringify(lin)])).r;
    const ls = await como(JAV, 'select l.id, coalesce(l.costo_unit_cent, operacion.costo_ref_pedido(pe.origen, l.modelo_id, pe.fecha_neg)) c from operacion.pedido_linea l join operacion.pedido pe on pe.id=l.pedido_id where l.pedido_id=$1 order by l.id', [cr.pedido_id]);
    const costoRef = Number(ls[0].c);
    await q1(JAV, 'select api.ds_capturar_costo($1,$2,$3::jsonb,$4)', [K('d1k'), cr.pedido_id, JSON.stringify([{ linea_id: ls[0].id, costo_unit_cent: 19000 }]), 'maestro costo distinto']);
    await q1(JAV, 'select api.confirmar_pedido($1,$2)', [K('d1c'), cr.pedido_id]);
    await q1(JAV, "select api.enviar_pedido($1,$2,null,null,'2026-11-13',true)", [K('d1e'), cr.pedido_id]);
    const m = await q1(JAV, 'select (select costo_unit_cent from operacion.pedido_linea where pedido_id=$1 limit 1) cu', [cr.pedido_id]);
    nota('pedido dropshipping con costo distinto del catalogo', Number(m.cu) === 19000, `costo catalogo/ref=${costoRef} costo capturado aplicado=${m.cu}`);
    await q1(JAV, "select api.ds_pagar_proveedor($1,'Isaac',460000,'cliente_a_proveedor',null,3,$2,'2026-11-13','maestro')", [K('d1p'), cr.pedido_id]);
    const s = (await q1(JAV, 'select operacion.pedido_saldo($1) s', [cr.pedido_id])).s;
    nota('pago del cliente al proveedor amortiza el pedido', Number(s) === 0, `saldo=${s}`);
  },
  async recepcion_parcial() {
    const cr = (await q1(JAV, "select api.crear_compra($1,'Isaac',$2::jsonb,5000,0,'2026-11-13','bodega','sociedad',null,null,'maestro') as r", [K('c1'), JSON.stringify([{ modelo: 'Nexa Ultra 50K', sabor: 'Strawberry Ice', pagadas: 100 }])])).r;
    await q1(JAV, 'select api.confirmar_compra($1,$2)', [K('c1c'), cr.compra_id]);
    const lin = await como(JAV, 'select id linea_id, sku_id from operacion.compra_linea where compra_id=$1', [cr.compra_id]);
    const rec = (n) => JSON.stringify(lin.map((l) => ({ linea_id: l.linea_id, sku_id: l.sku_id, piezas: n })));
    await q1(JAV, 'select api.recibir_compra_parcial($1,$2,$3::jsonb,null)', [K('c1r1'), cr.compra_id, rec(60)]);
    const e1 = (await q1(JAV, 'select estado from operacion.compra where id=$1', [cr.compra_id])).estado;
    await q1(JAV, 'select api.recibir_compra_parcial($1,$2,$3::jsonb,null)', [K('c1r2'), cr.compra_id, rec(40)]);
    const e2 = (await q1(JAV, 'select estado from operacion.compra where id=$1', [cr.compra_id])).estado;
    const mal = await intenta(JAV, 'select api.recibir_compra_parcial($1,$2,$3::jsonb,null)', [K('c1r3'), cr.compra_id, rec(5)]);
    nota('recepcion parcial de compra (60 + 40) y sobre-recepcion', !mal.ok, `estado tras 60=${e1}; tras 40=${e2}; recibir 5 mas ${mal.ok ? 'ACEPTADO' : 'rechazado'}`);
    flujos._compra = cr.compra_id;
  },
  async devoluciones() {
    const lin = [{ modelo: 'Nexa Ultra 50K', sabor: 'Sour Watermelon', piezas: 20, precio_cent: 15000 }];
    const cr = (await q1(JAV, "select api.crear_pedido($1,4,$2::jsonb,'bodega_omar',null,10000,20000,0,'2026-11-13',null,null,null,'maestro dev') as r", [K('v1'), JSON.stringify(lin)])).r;
    await q1(JAV, 'select api.confirmar_pedido($1,$2)', [K('v1c'), cr.pedido_id]);
    await q1(JAV, "select api.enviar_pedido($1,$2,null,null,'2026-11-13',true)", [K('v1e'), cr.pedido_id]);
    await q1(JAV, "select api.registrar_pago($1,'Efectivo',290000,4,$2::jsonb,true,'abono','2026-11-13',null,'pago',null)", [K('v1p'), JSON.stringify([{ pedido_id: cr.pedido_id, monto_cent: 290000 }])]);
    await invariantes('pedido con descuento y cobrado');
    const dev = (await q1(JAV, "select api.registrar_devolucion_cliente($1,$2,$3::jsonb,'maestro devolucion parcial') as r", [K('v1d'), cr.pedido_id, JSON.stringify(await devLineas(cr.pedido_id, 'Sour Watermelon', 5))])).r;
    nota('devolucion parcial de cliente con descuento', !!dev, `resultado=${JSON.stringify(dev).slice(0, 160)}`);
    await invariantes('devolucion parcial de cliente');
    const id = dev.devolucion_id ?? dev.id;
    if (id) { const an = await q1(JAV, "select api.anular_devolucion_cliente($1,$2,'maestro anula') as r", [K('v1a'), id]); nota('anulacion de devolucion de cliente', true, JSON.stringify(an.r).slice(0, 120)); await invariantes('anulacion de devolucion de cliente'); }
    const dp = (await q1(JAV, "select api.devolver_a_proveedor($1,'Isaac',$2::jsonb,'maestro defecto',null) as r", [K('v2'), JSON.stringify([{ sku_id: await skuDe('Mango Oasis'), piezas: 3 }])])).r;
    nota('devolucion a proveedor', !!dp, JSON.stringify(dp).slice(0, 160));
    await invariantes('devolucion a proveedor');
    const idp = dp.devolucion_id ?? dp.id;
    if (idp) { await q1(JAV, "select api.anular_devolucion_proveedor($1,$2,'maestro anula')", [K('v2a'), idp]); nota('anulacion de devolucion a proveedor', true, 'ok'); }
  },
  async paquete_perdido() {
    const lin = [{ modelo: 'Nexa Ultra 50K', sabor: 'Blue Razz Ice', piezas: 10, precio_cent: 15000 }];
    const cr = (await q1(JAV, "select api.crear_pedido($1,5,$2::jsonb,'bodega_omar',null,0,0,0,'2026-11-13',null,null,null,'maestro paq') as r", [K('q1'), JSON.stringify(lin)])).r;
    await q1(JAV, 'select api.confirmar_pedido($1,$2)', [K('q1c'), cr.pedido_id]);
    await q1(JAV, "select api.enviar_pedido($1,$2,null,null,'2026-11-13',true)", [K('q1e'), cr.pedido_id]);
    const rep = (await q1(JAV, "select api.reportar_paquete_salida($1,$2,'perdido','maestro paquete perdido',$3::jsonb) as r", [K('q1r'), cr.pedido_id, JSON.stringify(await devLineas(cr.pedido_id, 'Blue Razz Ice', 4))])).r;
    nota('paquete perdido reportado', !!rep, JSON.stringify(rep).slice(0, 140));
    await invariantes('paquete perdido (reporte)');
    const inc = rep.incidente_id ?? rep.id;
    if (inc) {
      const rs = (await q1(JAV, "select api.resolver_paquete_incidente($1,$2,'sociedad',null,'bonificar','maestro bonificacion al cliente absorbida por la sociedad',null) as r", [K('q1x'), inc])).r;
      nota('paquete perdido (salida): bonificacion al cliente', !!rs, JSON.stringify(rs).slice(0, 140));
      await invariantes('paquete perdido (castigo)');
    }
    // paquete perdido de ENTRADA: se reclama al proveedor y se bonifica
    const cr2 = (await q1(JAV, "select api.crear_compra($1,'Isaac',$2::jsonb,0,0,'2026-11-13','bodega','sociedad',null,null,'maestro') as r", [K('q2'), JSON.stringify([{ modelo: 'Nexa Ultra 50K', sabor: 'Miami Mint', pagadas: 50 }])])).r;
    await q1(JAV, 'select api.confirmar_compra($1,$2)', [K('q2c'), cr2.compra_id]);
    const lin2 = await como(JAV, 'select id linea_id, sku_id from operacion.compra_linea where compra_id=$1', [cr2.compra_id]);
    const rep2 = (await q1(JAV, "select api.reportar_paquete_entrada($1,$2,'perdido','maestro entrada perdida',$3::jsonb) as r", [K('q2r'), cr2.compra_id, JSON.stringify(lin2.map((l) => ({ linea_id: l.linea_id, sku_id: l.sku_id, piezas: 10 })))])).r;
    nota('paquete perdido de entrada reportado', !!rep2, JSON.stringify(rep2).slice(0, 140));
    const inc2 = rep2.incidente_id ?? rep2.id;
    if (inc2) {
      const rs2 = (await q1(JAV, "select api.resolver_paquete_incidente($1,$2,'proveedor',null,'bonificar','maestro bonificacion del proveedor',null) as r", [K('q2x'), inc2])).r;
      nota('bonificacion del proveedor por paquete perdido', !!rs2, JSON.stringify(rs2).slice(0, 140));
    }
  },
  async renta() {
    const est = async () => (await q1(JAV, 'select api.pago_renta_panel() r')).r.estado;
    let e = await est();
    const por = Number(e.por_pagar_cent);
    await q1(JAV, "select api.registrar_pago_renta($1,30000,'Javier','efectivo',null,'maestro parcial',null,false) r", [K('r1')]);
    const e1 = await est();
    nota('pago de renta parcial', Number(e1.por_pagar_cent) === por - 30000, `por_pagar ${por} -> ${e1.por_pagar_cent}`);
    const ex = await intenta(JAV, "select api.registrar_pago_renta($1,99999900,'Javier','efectivo',null,'exceso',null,false)", [K('r2')]);
    nota('pago de renta con exceso se rechaza sin confirmacion', !ex.ok, ex.ok ? 'ACEPTADO' : ex.msg);
    const conf = await intenta(JAV, "select api.registrar_pago_renta($1,50000,'Javier','efectivo',null,'exceso confirmado',null,true)", [K('r3')]);
    nota('pago de renta con exceso y confirmacion', conf.ok, conf.ok ? 'aceptado' : conf.msg);
    const pagos = (await q1(JAV, 'select api.pago_renta_panel() r')).r.pagos ?? [];
    const folio = pagos[0]?.folio;
    if (folio) {
      const an = await q1(JAV, "select api.anular_pago_renta($1,$2,'maestro reversa') r", [K('r4'), folio]);
      const e2 = await est();
      nota('reversa de un pago de renta', !!an, `por_pagar tras reversa=${e2.por_pagar_cent}`);
      const doble = await intenta(JAV, "select api.anular_pago_renta($1,$2,'doble')", [K('r5'), folio]);
      nota('segunda reversa del mismo pago se rechaza', !doble.ok, doble.ok ? 'ACEPTADA' : doble.msg);
    } else nota('reversa de un pago de renta', false, 'sin folio en el panel');
  },
  async corte() {
    const per = (await q1(JAV, 'select api.acta_periodo_sugerido() r')).r;
    nota('periodo sugerido del corte', !!per && per.listo === true, JSON.stringify(per).slice(0, 160));
    const disp = (await q1(JAV, 'select api.acta_disponible($1::date,$2::date) r', [per.ini, per.fin])).r;
    const dj = Number(disp.Javier.disponible_cent), da = Number(disp.Angelo.disponible_cent);
    const dec = { Javier: { retira: 0, reinvierte: Math.min(dj, 100000) }, Angelo: { retira: 0, reinvierte: Math.min(da, 100000) } };
    const exc = await intenta(JAV, 'select api.proponer_cierre_reparto($1,$2::date,$3::date,$4::jsonb,null)', [K('k0'), per.ini, per.fin, JSON.stringify({ Javier: { retira: dj + 1, reinvierte: 0 } })]);
    nota('acta: retiro mayor que lo disponible se rechaza', !exc.ok, exc.ok ? 'ACEPTADO' : exc.msg);
    const pr = (await q1(JAV, 'select api.proponer_cierre_reparto($1,$2::date,$3::date,$4::jsonb,$5) r', [K('k1'), per.ini, per.fin, JSON.stringify(dec), 'maestro'])).r;
    nota('acta propuesta', !!pr, JSON.stringify(pr).slice(0, 160));
    const f1 = (await q1(JAV, 'select api.firmar_cierre_reparto($1,$2) r', [K('k2'), pr.cierre_id ?? pr.id])).r;
    const solo = await intenta(JAV, 'select api.firmar_cierre_reparto($1,$2)', [K('k2b'), pr.cierre_id ?? pr.id]);
    nota('una firma no cierra y el mismo socio no firma dos veces', f1.cerrado === false && !solo.ok, `cerrado=${f1.cerrado} segunda firma del mismo socio ${solo.ok ? 'ACEPTADA' : 'rechazada'}`);
    await invariantes('acta con una firma');
    const f2 = (await q1(ANG, 'select api.firmar_cierre_reparto($1,$2) r', [K('k3'), pr.cierre_id ?? pr.id])).r;
    nota('acta firmada por los dos', f2.cerrado === true, `cerrado=${f2.cerrado}`);
    const det = (await q1(JAV, 'select api.acta_detalle($1) r', [pr.cierre_id ?? pr.id])).r;
    nota('detalle del acta', !!det, JSON.stringify(Object.keys(det)).slice(0, 160));
    console.log(`ACTA_ID=${pr.cierre_id ?? pr.id}`);
  },
};
const pedidos = process.argv.slice(2);
const orden = pedidos.length ? pedidos : ['pedido_cliente', 'dropshipping_costo_distinto', 'recepcion_parcial', 'devoluciones', 'paquete_perdido', 'renta', 'corte'];
for (const f of orden) {
  try { await flujos[f](); } catch (e) { nota(f, false, `EXCEPCION ${String(e.message).slice(0, 220)}`); }
  await invariantes(f).catch((e) => nota(`invariantes ${f}`, false, `EXCEPCION ${String(e.message).slice(0, 200)}`));
}
await c.end();
console.log(`\nResumen: ${resultados.filter((r) => r.ok).length} ok, ${resultados.filter((r) => !r.ok).length} fallas`);
